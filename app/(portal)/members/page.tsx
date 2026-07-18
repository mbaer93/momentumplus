import Link from "next/link";
import { requireMember } from "@/lib/current-member";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { tierLabel } from "@/lib/access";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Members | Momentum+" };

/*
 * Member directory. Everyone with an active membership is listed by name,
 * title, and company (the same identity they already show in community
 * chat). Email and phone appear ONLY for members who flipped on "Share my
 * contact info" in their profile — strictly opt-in, off by default.
 */

interface DirectoryRow {
  id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  tier: string;
  email: string | null;
  phone: string | null;
}

const PREVIEW_ROWS: DirectoryRow[] = [
  {
    id: "p1",
    name: "Sarah Johnson",
    title: "VP of Operations",
    company: "Hartline Logistics",
    industry: "Logistics",
    tier: "Momentum+ Pro User",
    email: "sarah@example.com",
    phone: null,
  },
  {
    id: "p2",
    name: "Marcus Chen",
    title: "Founder",
    company: "Chen Creative",
    industry: "Marketing",
    tier: "Momentum+ Member",
    email: null,
    phone: null,
  },
];

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  await requireMember();
  const q = (searchParams?.q ?? "").trim().toLowerCase().slice(0, 80);

  // Preview fixtures appear ONLY with no Supabase at all — a configured
  // deployment missing its service key shows an empty directory, never
  // fake members presented as real ones.
  let rows: DirectoryRow[] = isSupabaseConfigured() ? [] : PREVIEW_ROWS;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    // Active members only; admin/system rows stay out of the directory.
    const { data: memberships } = await admin
      .from("memberships")
      .select("profile_id, tier")
      .in("status", ["active", "past_due"])
      .neq("tier", "admin");
    const tierByProfile = new Map<string, string>();
    for (const m of memberships ?? []) {
      if (!tierByProfile.has(m.profile_id)) {
        tierByProfile.set(m.profile_id, m.tier as string);
      }
    }
    const ids = Array.from(tierByProfile.keys());
    rows = [];
    // Page through profiles (PostgREST caps responses at 1,000 rows).
    for (let from = 0; from < ids.length; from += 1000) {
      const batch = ids.slice(from, from + 1000);
      let profiles = (
        await admin
          .from("profiles")
          .select(
            "id, full_name, title, company, industry, email, phone, share_contact",
          )
          .in("id", batch)
      ).data as
        | {
            id: string;
            full_name: string | null;
            title: string | null;
            company: string | null;
            industry: string | null;
            email: string | null;
            phone: string | null;
            share_contact?: boolean;
          }[]
        | null;
      if (!profiles) {
        // Pre-migration fallback: share_contact arrives with 0034 —
        // contact info stays hidden for everyone until then.
        profiles = (
          await admin
            .from("profiles")
            .select("id, full_name, title, company, industry, email, phone")
            .in("id", batch)
        ).data as typeof profiles;
      }
      for (const p of profiles ?? []) {
        if (!p.full_name) continue;
        const shared = Boolean(
          (p as { share_contact?: boolean }).share_contact,
        );
        rows.push({
          id: p.id as string,
          name: p.full_name as string,
          title: (p.title as string) ?? "",
          company: (p.company as string) ?? "",
          industry: (p.industry as string) ?? "",
          tier: tierLabel((tierByProfile.get(p.id as string) ?? "basic") as Tier),
          // Contact info is opt-in only — never leaks otherwise.
          email: shared ? ((p.email as string) ?? null) : null,
          phone: shared ? ((p.phone as string) ?? null) : null,
        });
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  const visible = q
    ? rows.filter((r) =>
        [r.name, r.title, r.company, r.industry]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : rows;

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Member Directory</h2>
          <p>
            The leaders in this community — connect over DM, or directly when
            a member shares their contact info
          </p>
        </div>
      </div>

      <form method="get" className="admin-form-actions" style={{ marginBottom: 16 }}>
        <input
          type="search"
          name="q"
          defaultValue={searchParams?.q ?? ""}
          placeholder="Search by name, company, or industry…"
          aria-label="Search members"
          style={{ minWidth: "min(320px, 100%)" }}
        />
        <button type="submit" className="btn-mini">
          Search
        </button>
        <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
          {visible.length} member{visible.length === 1 ? "" : "s"}
        </span>
      </form>

      <div
        style={{
          fontSize: 12.5,
          color: "var(--mid-gray)",
          marginBottom: 14,
        }}
      >
        Want members to be able to reach you directly? Turn on{" "}
        <Link href="/profile" style={{ color: "var(--gold)" }}>
          &ldquo;Share my contact info&rdquo; in your profile
        </Link>
        . Until then, only your name, title, and company are shown.
      </div>

      <BodyAd variant="tile" />

      {visible.length === 0 ? (
        <div className="sessions-empty">No members match that search.</div>
      ) : (
        <div className="resources-grid">
          {visible.map((m) => (
            <div className="resource-card" key={m.id}>
              <div
                className="resource-icon"
                style={{
                  background: "var(--navy)",
                  color: "var(--gold-light)",
                  fontWeight: 700,
                  fontSize: 15,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {initialsOf(m.name)}
              </div>
              <div className="resource-body">
                <div className="resource-type" style={{ color: "var(--gold)" }}>
                  {m.tier}
                </div>
                <div className="resource-title">{m.name}</div>
                <div className="resource-desc">
                  {[m.title, m.company].filter(Boolean).join(" · ") ||
                    "Momentum+ Member"}
                  {m.industry ? ` · ${m.industry}` : ""}
                </div>
                <div className="resource-meta">
                  {m.email ? (
                    <a className="resource-link" href={`mailto:${m.email}`}>
                      {m.email}
                    </a>
                  ) : (
                    <Link
                      className="resource-link"
                      href="/community"
                      title="This member hasn't shared contact info — say hello in the community"
                    >
                      Message in Community
                    </Link>
                  )}
                  {m.phone && <span className="resource-tag">{m.phone}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
