import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  getSheetsAccessToken,
  isSheetsConfigured,
  parseRegistrationSheet,
  readSheetRange,
} from "@/lib/sheets";

/*
 * Read-only registration import (cron, every 30 min):
 *   live Google Sheet row (name, email, registration type)
 *     → invite the attendee into THIS app's Supabase (magic-link invite)
 *     → record the ticket in the attendees table
 *
 * Deliberately one-way: the readonly Sheets scope cannot write, the sheet's
 * "processed" column (Momentum+'s marker) is ignored, and idempotency lives
 * in the attendees table's unique (email, event_year). Nothing here can
 * disturb the existing intake or the Momentum+ importer.
 */

function bearerAuthorized(header: string | null, secret?: string): boolean {
  return Boolean(secret) && header === `Bearer ${secret}`;
}

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
  const eventYear = Number(
    process.env.TSLS_EVENT_YEAR ?? new Date().getUTCFullYear(),
  );

  const token = await getSheetsAccessToken();
  const rows = parseRegistrationSheet(await readSheetRange(token, range));

  const admin = createServiceClient();
  const summary = {
    imported: 0,
    alreadyImported: 0,
    errors: [] as string[],
  };
  const redact = (email: string) => {
    const [user, domain] = email.split("@");
    return `${user.slice(0, 2)}…@${domain ?? ""}`;
  };

  for (const row of rows) {
    try {
      // Idempotency: one attendee row per email per event year.
      const { data: existing } = await admin
        .from("attendees")
        .select("id")
        .eq("email", row.email)
        .eq("event_year", eventYear)
        .maybeSingle();
      if (existing) {
        summary.alreadyImported++;
        continue;
      }

      // Invite (magic-link, lands on this app's domain) or find the
      // already-invited account.
      let profileId: string | null = null;
      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(row.email, {
          data: { full_name: row.name },
          redirectTo: process.env.NEXT_PUBLIC_SITE_URL
            ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=/ticket`
            : undefined,
        });
      if (invited?.user) {
        profileId = invited.user.id;
      } else if (inviteError) {
        const { data: profile } = await admin
          .from("profiles")
          .select("id")
          .ilike("email", row.email.replace(/([%_\\])/g, "\\$1"))
          .maybeSingle();
        profileId = profile?.id ?? null;
      }
      if (!profileId) {
        summary.errors.push(`${redact(row.email)}: could not invite or find profile`);
        continue;
      }

      // The signup trigger races the invite — upsert keeps the name.
      await admin.from("profiles").upsert(
        { id: profileId, email: row.email, full_name: row.name },
        { onConflict: "id" },
      );

      const { error: attendeeError } = await admin.from("attendees").insert({
        profile_id: profileId,
        email: row.email,
        name: row.name,
        registration_type: row.registrationType,
        event_year: eventYear,
        source: "sheet_import",
      });
      if (attendeeError) {
        summary.errors.push(`${redact(row.email)}: ${attendeeError.message}`);
        continue;
      }
      summary.imported++;
    } catch (e) {
      summary.errors.push(`${redact(row.email)}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, eventYear, ...summary });
}
