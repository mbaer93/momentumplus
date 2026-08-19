import Link from "next/link";
import { requireMember } from "@/lib/current-member";
import { requireFeature } from "@/lib/entitlements";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { tierLabel } from "@/lib/access";
import { LevelChip } from "@/components/badges/LevelChip";
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
  /** Overall engagement level, or null when unearned or opted out. */
  level: { key: string; label: string } | null;
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
    level: { key: "committed", label: "Committed" },
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
    level: null,
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

const PAGE_SIZE = 60;

export default async function MembersPage(
  props: {
    searchParams?: Promise<{ q?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const member = await requireMember();
  await requireFeature("members");
  // Strip PostgREST filter syntax so the search string can ride in .or()
  // safely; it's a human name/company either way.
  const q = (searchParams?.q ?? "").trim().slice(0, 80).replace(/[,%()*\\]/g, "");
  const page = Math.max(1, Number(searchParams?.page) || 1);

  // Preview fixtures appear ONLY with no Supabase at all — a configured
  // deployment missing its service key shows an empty directory, never
  // fake members presented as real ones.
  let rows: DirectoryRow[] = isSupabaseConfigured() ? [] : PREVIEW_ROWS;
  let total = rows.length;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    /*
     * One DB-side query: filter, search, sort, and paginate in Postgres.
     * The old shape pulled EVERY membership row and every profile on every
     * view — at 2,500 members that was ~5,000 rows per view, and the
     * unbounded membership read silently truncated at PostgREST's
     * 1,000-row cap, so the directory was wrong as well as slow.
     * memberships!inner keeps only active members; admin rows stay out.
     */
    const buildQuery = (hideTesters: boolean) => {
      let query = admin
        .from("profiles")
        .select(
          "id, full_name, title, company, industry, email, phone, share_contact, memberships!inner(tier, status)",
          { count: "exact" },
        )
        .in("memberships.status", ["active", "past_due"])
        .neq("memberships.tier", "admin")
        .not("full_name", "is", null);
      // Test accounts are real members in every other respect, so nothing
      // else here excludes them. Admins see them (flagged in the row).
      if (hideTesters) query = query.eq("tester", false);
      if (q) {
        query = query.or(
          `full_name.ilike.%${q}%,company.ilike.%${q}%,industry.ilike.%${q}%,title.ilike.%${q}%`,
        );
      }
      return query
        .order("full_name", { ascending: true })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    };

    interface ProfileHit {
      id: string;
      full_name: string | null;
      title: string | null;
      company: string | null;
      industry: string | null;
      email: string | null;
      phone: string | null;
      share_contact?: boolean;
      memberships: { tier: string; status: string }[];
    }
    let profiles: ProfileHit[] | null = null;
    let count: number | null = null;
    {
      let res = await buildQuery(!member.isAdmin);
      /*
       * `tester` arrives with migration 0089. Between deploy and migration
       * the filtered query errors, and an errored directory renders as an
       * EMPTY one — the whole membership apparently vanished. Fall back to
       * the unfiltered read: a pre-launch window where a tester might show
       * up beats a directory that looks like data loss.
       */
      if (res.error && /tester/i.test(res.error.message)) {
        res = await buildQuery(false);
      }
      profiles = res.data as ProfileHit[] | null;
      count = res.count;
    }

    // Pre-season speakers are hidden until October 1 of the year they
    // join — they hold a Speaker membership for portal access, but the
    // community doesn't see them yet. Only this page's speaker rows need
    // checking (≤ PAGE_SIZE), not the whole roster.
    const hidden = new Set<string>();
    const speakerIds = (profiles ?? [])
      .filter((p) => p.memberships.some((m) => m.tier === "speaker"))
      .map((p) => p.id);
    if (speakerIds.length > 0) {
      const { speakerLive } = await import("@/lib/sponsor-lifecycle");
      const { data: speakerRows } = await admin
        .from("speakers")
        .select("profile_id, expires_at, archived_at")
        .in("profile_id", speakerIds);
      for (const s of speakerRows ?? []) {
        if (
          s.profile_id &&
          !speakerLive({
            archivedAt: (s.archived_at as string | null) ?? null,
            expiresAt: (s.expires_at as string | null) ?? null,
          })
        ) {
          hidden.add(s.profile_id as string);
        }
      }
    }

    rows = (profiles ?? [])
      .filter((p) => p.full_name && !hidden.has(p.id))
      .map((p) => {
        const shared = Boolean(p.share_contact);
        return {
          id: p.id,
          name: p.full_name as string,
          title: p.title ?? "",
          company: p.company ?? "",
          industry: p.industry ?? "",
          tier: tierLabel((p.memberships[0]?.tier ?? "basic") as Tier),
          // Contact info is opt-in only — never leaks otherwise.
          email: shared ? (p.email ?? null) : null,
          phone: shared ? (p.phone ?? null) : null,
          level: null as DirectoryRow["level"],
        };
      });
    /*
     * Badges for everyone on this page, in one batch. Per-member queries
     * would be six round trips per row — 144 for a full page.
     * badgesForOthers omits anyone who opted out, so a member who hid their
     * level is simply absent from the map rather than present-and-empty.
     */
    const { badgesForOthers } = await import("@/lib/badge-queries");
    const badges = await badgesForOthers(rows.map((r) => r.id));
    rows = rows.map((r) => {
      const b = badges.get(r.id);
      return {
        ...r,
        level: b ? { key: b.level.key, label: b.level.label } : null,
      };
    });
    total = count ?? rows.length;
  }

  const visible = rows;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) =>
    `/members?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

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
        <span style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>
          {total} member{total === 1 ? "" : "s"}
          {totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}
        </span>
      </form>

      <div
        style={{
          fontSize: 12.5,
          color: "var(--ink-secondary)",
          marginBottom: 14,
        }}
      >
        Want members to be able to reach you directly? Turn on{" "}
        <Link href="/profile" style={{ color: "var(--gold-text)" }}>
          &ldquo;Share my contact info&rdquo; in your profile
        </Link>
        . Until then, only your name, title, and company are shown.
      </div>

      <BodyAd variant="tile" />

      {visible.length === 0 ? (
        <div className="sessions-empty">
          {q ? (
            <>
              No members match &ldquo;{q}&rdquo;.{" "}
              <Link href="/members" style={{ color: "var(--gold-text)" }}>
                Show all members
              </Link>
            </>
          ) : (
            "The directory is filling up — check back soon."
          )}
        </div>
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
                <div className="resource-type" style={{ color: "var(--gold-text)" }}>
                  {m.tier}
                </div>
                <div className="resource-title">
                  {m.name}
                  {m.level && (
                    <>
                      {" "}
                      <LevelChip label={m.level.label} levelKey={m.level.key} size="xs" />
                    </>
                  )}
                </div>
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
                      href={`/community?dm=${m.id}`}
                      title="Opens a direct message with this member"
                    >
                      Message
                    </Link>
                  )}
                  {m.phone && <span className="resource-tag">{m.phone}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div
          className="admin-form-actions"
          style={{ marginTop: 18, justifyContent: "center" }}
        >
          {page > 1 && (
            <Link className="btn-mini" href={pageHref(page - 1)}>
              ← Previous
            </Link>
          )}
          {page < totalPages && (
            <Link className="btn-mini" href={pageHref(page + 1)}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
