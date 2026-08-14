import Link from "next/link";
import { requireMember } from "@/lib/current-member";
import { listCourses } from "@/lib/education";
import {
  listResources,
  listSpeakers,
  listSponsors,
  resourceUnlocked,
} from "@/lib/directory-queries";
import { hasFeature } from "@/lib/entitlements";
import { listEpisodes } from "@/lib/podcast";
import { listServices } from "@/lib/services-queries";
import { listSessions } from "@/lib/sessions/queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listVideos } from "@/lib/videos/queries";
import { dateLabel } from "@/lib/sessions/view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search | Momentum+" };

/*
 * Portal-wide search (the topbar box submits here). Everything is fetched
 * through the existing member-scoped queries, so RLS and tier gating hold —
 * search can never surface something the member couldn't browse to.
 */

interface Hit {
  title: string;
  detail: string;
  href: string;
}

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export default async function SearchPage(
  props: {
    searchParams?: Promise<{ q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const member = await requireMember();
  const q = (searchParams?.q ?? "").trim().toLowerCase().slice(0, 80);

  const groups: { label: string; hits: Hit[] }[] = [];

  if (q.length >= 2) {
    // Podcast + member directory ride the same entitlement gates as their
    // tabs (audit P2-22: both were missing from search entirely).
    const [podcastOk, membersOk] = await Promise.all([
      hasFeature("branching_out"),
      hasFeature("members"),
    ]);
    const [
      sessions,
      videos,
      courses,
      speakers,
      resources,
      sponsors,
      services,
      episodes,
      memberHits,
    ] = await Promise.all([
      listSessions(),
      listVideos(member.tier),
      listCourses(),
      listSpeakers(),
      listResources(member.tier),
      listSponsors(),
      listServices(),
      podcastOk ? listEpisodes() : Promise.resolve([]),
      membersOk &&
      isSupabaseConfigured() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ? (async () => {
            // Mirrors the /members directory filter exactly: active members
            // only, admin rows out, test accounts hidden from everyone but
            // admins. Search is the other way a hidden member becomes
            // visible, so the two filters have to stay identical.
            const run = (hideTesters: boolean) => {
              let query = createServiceClient()
                .from("profiles")
                .select(
                  "id, full_name, title, company, industry, memberships!inner(tier, status)",
                )
                .in("memberships.status", ["active", "past_due"])
                .neq("memberships.tier", "admin")
                .not("full_name", "is", null);
              if (hideTesters) query = query.eq("tester", false);
              return query
                .or(
                  `full_name.ilike.%${q}%,company.ilike.%${q}%,industry.ilike.%${q}%,title.ilike.%${q}%`,
                )
                .order("full_name", { ascending: true })
                .limit(8);
            };
            // Pre-migration 0089 fallback, as on /members.
            let res = await run(!member.isAdmin);
            if (res.error && /tester/i.test(res.error.message)) {
              res = await run(false);
            }
            const { data } = res;
            return (data ?? []) as {
              id: string;
              full_name: string | null;
              title: string | null;
              company: string | null;
              industry: string | null;
            }[];
          })()
        : Promise.resolve([]),
    ]);

    groups.push({
      label: "Sessions",
      hits: sessions
        .filter(
          (s) =>
            (s.status !== "draft" && s.status !== "archived") &&
            matches(q, s.title, s.description, s.speaker.name, s.category),
        )
        .map((s) => ({
          title: s.title,
          detail: `${dateLabel(s.startsAt)} · ${s.speaker.name}`,
          href:
            s.program === "rooted_focus"
              ? `/sessions/${s.slug}`
              : `/sessions/${s.slug}`,
        })),
    });
    groups.push({
      label: "Library",
      hits: videos
        .filter((v) => matches(q, v.title, v.speakerName, v.category))
        .map((v) => ({
          title: v.title,
          detail: `${v.speakerName}${v.durationLabel ? ` · ${v.durationLabel}` : ""}`,
          href: `/library/${v.id}`,
        })),
    });
    groups.push({
      label: "Education",
      hits: courses
        .filter(
          (c) =>
            c.published &&
            (matches(q, c.title, c.description, c.category) ||
              c.lessons.some((l) => matches(q, l.title))),
        )
        .map((c) => ({
          title: c.title,
          detail: `${c.lessonCount ?? c.lessons.length} lessons · ${c.category}`,
          href: `/education/${c.id}`,
        })),
    });
    groups.push({
      label: "Speakers",
      hits: speakers
        .filter((s) => matches(q, s.name, s.title, s.bio, s.industries.join(" ")))
        .map((s) => ({
          title: s.name,
          detail: s.title,
          href: `/speakers/${s.id}`,
        })),
    });
    groups.push({
      label: "Resources",
      hits: resources
        .filter(
          (r) =>
            resourceUnlocked(r, member.tier) &&
            matches(q, r.title, r.description, r.tags.join(" ")),
        )
        .map((r) => ({
          title: r.title,
          detail: r.type,
          href: "/resources",
        })),
    });
    groups.push({
      label: "Sponsors",
      hits: sponsors
        .filter((s) => matches(q, s.name, s.tagline, s.description))
        .map((s) => ({
          title: s.name,
          detail: s.tagline,
          href: `/sponsors/${s.id}`,
        })),
    });
    groups.push({
      label: "Additional Services",
      hits: services
        .filter((s) => matches(q, s.name, s.tagline, s.description))
        .map((s) => ({
          title: s.name,
          detail: s.tagline || "SLC service",
          href: "/services",
        })),
    });
    groups.push({
      label: "Branching Out podcast",
      hits: episodes
        .filter((e) => matches(q, e.title, e.showNotes))
        .map((e) => ({
          title: e.title,
          detail: e.season ? `Season ${e.season}` : "Episode",
          href: "/branching-out",
        })),
    });
    groups.push({
      label: "Member directory",
      hits: memberHits.map((m) => ({
        title: m.full_name ?? "Member",
        detail:
          [m.title, m.company].filter(Boolean).join(" · ") ||
          m.industry ||
          "Momentum+ member",
        href: "/members",
      })),
    });
  }

  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Search</h2>
          <p>
            {q.length < 2
              ? "Search sessions, recordings, speakers, resources, sponsors, podcast episodes, and members"
              : `${total} result${total === 1 ? "" : "s"} for “${searchParams?.q?.trim()}”`}
          </p>
        </div>
      </div>

      <form method="get" className="admin-form-actions" style={{ marginBottom: 18 }}>
        <input
          type="search"
          name="q"
          defaultValue={searchParams?.q ?? ""}
          placeholder="Search Momentum+…"
          aria-label="Search"
          autoFocus
          style={{ minWidth: "min(360px, 100%)" }}
        />
        <button type="submit" className="btn-primary">
          Search
        </button>
      </form>

      {q.length >= 2 && total === 0 && (
        <div className="sessions-empty">
          Nothing matched — try a shorter or different phrase.
        </div>
      )}

      {groups
        .filter((g) => g.hits.length > 0)
        .map((g) => (
          <div key={g.label} style={{ marginBottom: 22 }}>
            <div className="spk-section-title">{g.label}</div>
            <div className="upcoming-list">
              {g.hits.slice(0, 8).map((h, i) => (
                <Link key={`${g.label}-${i}`} href={h.href} className="upcoming-item">
                  <div className="upcoming-info">
                    <div className="upcoming-title">{h.title}</div>
                    <div className="upcoming-speaker">{h.detail}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
