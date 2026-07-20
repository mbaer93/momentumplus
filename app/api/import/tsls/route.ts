import { bearerAuthorized, emailPattern, redactEmail } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { addMonths, mapTslsRegistration } from "@/lib/membership";
import {
  columnLetter,
  getSheetsAccessToken,
  isSheetsConfigured,
  parseRegistrationSheet,
  readSheetRange,
  writeSheetCell,
} from "@/lib/sheets";

/*
 * TSLS registration import (SPEC.md §4). Cron every 30 min:
 *   sheet row (name, email, registration type)
 *     → map type → tier + months (VIP spec-fixed; others via TSLS_TYPE_MAP)
 *     → invite the member (Supabase magic-link invite) / find existing profile
 *     → insert membership (source tsls_import)
 *     → record in import_log (idempotent by email + event year)
 *     → mark the sheet row processed.
 * Unmapped registration types are skipped and reported — tier rules are
 * configured, never guessed.
 */
// Long-running under load — allow the full function window (Vercel Pro).
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!isSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets not configured" },
      { status: 503 },
    );
  }

  const range = process.env.TSLS_SHEET_RANGE ?? "Sheet1!A1:Z";
  const sheetPrefix = range.includes("!") ? range.split("!")[0] : "";
  const eventYear = Number(
    process.env.TSLS_EVENT_YEAR ?? new Date().getUTCFullYear(),
  );

  const token = await getSheetsAccessToken();
  const values = await readSheetRange(token, range);
  const { rows, processedCol } = parseRegistrationSheet(values);

  const admin = createServiceClient();
  const summary = {
    imported: 0,
    alreadyImported: 0,
    skippedUnmappedTypes: [] as string[],
    errors: [] as string[],
    /** Rows left for the next run — the per-run cap keeps one run inside
        the function limit and Supabase's invite-email rate; the 30-minute
        cadence drains the rest (350 October registrants ≈ a few hours). */
    deferredToNextRun: 0,
  };

  // Cap ATTEMPTED rows per run (already-imported skips are free).
  const MAX_IMPORTS_PER_RUN = 40;
  let attempted = 0;

  for (const row of rows) {
    if (row.processed) continue;
    if (attempted >= MAX_IMPORTS_PER_RUN) {
      summary.deferredToNextRun++;
      continue;
    }

    try {
      // Idempotency ledger: one import per email per event year.
      const { data: logged } = await admin
        .from("import_log")
        .select("id")
        .eq("email", row.email)
        .eq("event_year", eventYear)
        .maybeSingle();
      if (logged) {
        summary.alreadyImported++;
        await markProcessed(token, sheetPrefix, processedCol, row.rowNumber);
        continue;
      }

      const mapping = mapTslsRegistration(
        row.registrationType,
        process.env.TSLS_TYPE_MAP,
      );
      if (!mapping) {
        if (!summary.skippedUnmappedTypes.includes(row.registrationType)) {
          summary.skippedUnmappedTypes.push(row.registrationType);
        }
        continue; // leave unprocessed so it imports once the type is mapped
      }

      // Invite (magic-link) or find the existing member.
      attempted++;
      let profileId: string | null = null;
      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(row.email, {
          data: { full_name: row.name },
          redirectTo: process.env.NEXT_PUBLIC_SITE_URL
            ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=/welcome`
            : undefined,
        });
      if (invited?.user) {
        profileId = invited.user.id;
      } else if (inviteError) {
        const { data: profile } = await admin
          .from("profiles")
          .select("id")
          .ilike("email", emailPattern(row.email))
          .maybeSingle();
        profileId = profile?.id ?? null;
        if (!profileId) {
          // Same email-outage ladder as the shared provisioning path: when
          // Supabase throttles invite emails (exactly what happens during a
          // 350-person burst), the account still gets created and the
          // welcome email can be re-sent later — the member is never lost.
          const { findAuthUserIdByEmail, createAccountWithoutEmail } =
            await import("@/lib/onboarding");
          profileId = await findAuthUserIdByEmail(row.email);
          if (!profileId) {
            try {
              const created = await createAccountWithoutEmail(
                row.email,
                row.name,
              );
              profileId = created.profileId;
            } catch {
              profileId = null;
            }
          }
        }
      }
      if (!profileId) {
        summary.errors.push(`${redactEmail(row.email)}: could not invite or find profile`);
        continue;
      }

      // Ensure the profile row exists with a name (signup trigger races the
      // invite, so upsert is the safe move).
      await admin.from("profiles").upsert(
        { id: profileId, email: row.email, full_name: row.name },
        { onConflict: "id" },
      );

      const now = new Date();
      const { error: memberError } = await admin.from("memberships").insert({
        profile_id: profileId,
        tier: mapping.tier,
        status: "active",
        access_starts_at: now.toISOString(),
        access_expires_at: addMonths(now, mapping.months).toISOString(),
        source: "tsls_import",
      });
      if (memberError) {
        summary.errors.push(`${redactEmail(row.email)}: ${memberError.message}`);
        continue;
      }

      await admin.from("import_log").insert({
        email: row.email,
        event_year: eventYear,
        registration_type: row.registrationType,
        tier: mapping.tier,
        months: mapping.months,
        profile_id: profileId,
      });

      await markProcessed(token, sheetPrefix, processedCol, row.rowNumber);
      summary.imported++;
    } catch (e) {
      summary.errors.push(`${redactEmail(row.email)}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, eventYear, ...summary });
}

async function markProcessed(
  token: string,
  sheetPrefix: string,
  processedCol: number,
  rowNumber: number,
): Promise<void> {
  const cell = `${columnLetter(processedCol)}${rowNumber}`;
  const a1 = sheetPrefix ? `${sheetPrefix}!${cell}` : cell;
  try {
    await writeSheetCell(token, a1, `processed ${new Date().toISOString()}`);
  } catch {
    // Non-fatal: import_log is the idempotency source of truth.
  }
}
