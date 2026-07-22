import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email Delivery | Momentum+ Admin",
};

const EVENT_LABEL: Record<string, string> = {
  delivered: "Delivered",
  open: "Opened",
  bounce: "Bounced",
  blocked: "Blocked",
  dropped: "Dropped",
  spamreport: "Marked spam",
};
const FAILURE_EVENTS = new Set(["bounce", "blocked", "dropped", "spamreport"]);

/*
 * Per-address delivery history for account emails (invites, password
 * resets, login links) — fed by the SendGrid Event Webhook into
 * email_events (migration 0050). Emails sent through GHL (announcements,
 * reminders) are tracked in the GHL contact's Conversations tab instead.
 */
export default async function EmailActivityPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  if (isSupabaseConfigured() && !canAccessArea(await getAdminAccess(), "members")) {
    redirect("/admin");
  }
  const q = (searchParams?.q ?? "").trim();

  let rows: {
    id: string;
    email: string;
    event: string;
    reason: string | null;
    occurred_at: string;
  }[] = [];
  let tableMissing = false;
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    let query = createServiceClient()
      .from("email_events")
      .select("id, email, event, reason, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (q) query = query.ilike("email", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      tableMissing = true;
    } else {
      rows = (data ?? []) as typeof rows;
    }
  }

  return (
    <div className="admin-pad">
      <Link href="/admin/members" className="sess-back">
        <ArrowLeftIcon size={12} /> Back to members
      </Link>
      <div className="section-header">
        <div>
          <h2>Email Delivery</h2>
          <p>
            Account emails (invites, password resets, login links) — what
            SendGrid reports for each address
          </p>
        </div>
      </div>

      {tableMissing && (
        <div className="admin-hint">
          The email delivery journal isn&apos;t set up yet — run database
          migration <strong>0050_email_events.sql</strong>, and make sure the
          SendGrid Event Webhook is configured with the Delivered and Opened
          events ticked.
        </div>
      )}

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Filter by email…"
          aria-label="Filter by email"
          style={{ maxWidth: 320 }}
        />
        <button type="submit" className="btn-mini">
          Search
        </button>
        {q && (
          <Link href="/admin/email-activity" className="btn-mini">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 && !tableMissing ? (
        <div className="admin-hint">
          No events{q ? ` for “${q}”` : ""} yet. Events appear here as
          SendGrid delivers (and members open) account emails. Opens require
          Open Tracking to be enabled in SendGrid.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="prefs-table">
            <thead>
              <tr>
                <th>When (ET)</th>
                <th>Email</th>
                <th>Event</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(r.occurred_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/New_York",
                    })}
                  </td>
                  <td>{r.email}</td>
                  <td
                    style={{
                      color: FAILURE_EVENTS.has(r.event)
                        ? "#c0392b"
                        : r.event === "open"
                          ? "var(--gold)"
                          : undefined,
                      fontWeight: FAILURE_EVENTS.has(r.event) ? 600 : undefined,
                    }}
                  >
                    {EVENT_LABEL[r.event] ?? r.event}
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                    {r.reason ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 12 }}>
        Kept for 90 days. &ldquo;Opened&rdquo; is approximate — some mail apps
        (notably Apple Mail) preload or hide opens. Announcements and
        reminders travel via GHL instead; their history lives on the
        contact&apos;s Conversations tab in the CRM.
      </p>
    </div>
  );
}
