import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  mergeSummitSettings,
  type AgendaItem,
  type AgendaKind,
  type SummitSettings,
  type SummitTicket,
  type VendorItem,
} from "@/lib/summit";

/*
 * Server queries for the Summit companion. Members read agenda/vendors via
 * RLS; event settings live in app_settings (service role) with sensible
 * defaults so the section renders before anything is configured.
 */

export async function getSummitSettings(): Promise<SummitSettings> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return mergeSummitSettings(null);
  }
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", "summit")
      .maybeSingle();
    return mergeSummitSettings(
      (data?.value as Partial<SummitSettings> | undefined) ?? null,
    );
  } catch {
    return mergeSummitSettings(null);
  }
}

export async function saveSummitSettings(
  value: Partial<SummitSettings>,
): Promise<void> {
  await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: "summit", value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

// Preview-mode agenda mirrors the published thetsls.com schedule shape so the
// section is explorable without a database.
type AgendaSeed = Partial<AgendaItem> &
  Pick<AgendaItem, "kind" | "title" | "startsAt">;

const AGENDA_SEEDS: AgendaSeed[] = [
  {
    kind: "registration",
    title: "Registration & Coffee",
    description: "Check in at the lobby, grab your badge and a coffee.",
    startsAt: "2026-10-14T12:00:00.000Z", // 8:00 AM ET
    endsAt: "2026-10-14T12:45:00.000Z",
    location: "Main Lobby",
  },
  {
    kind: "keynote",
    title: "Opening Keynote: Servant Leadership",
    description:
      "Trust, empowerment, and meaningful connection as the foundation of impactful leadership.",
    startsAt: "2026-10-14T13:00:00.000Z",
    endsAt: "2026-10-14T14:15:00.000Z",
    location: "Main Stage",
  },
  {
    kind: "panel",
    title: "Leadership Panel: Momentum+ Advisors",
    description:
      "Real conversations with practical, tactical takeaways in leadership, marketing, and technology.",
    startsAt: "2026-10-14T15:30:00.000Z",
    endsAt: "2026-10-14T16:30:00.000Z",
    location: "Main Stage",
  },
  {
    kind: "meal",
    title: "Lunch Break — Badge Specials Downtown",
    description:
      "Show your badge for exclusive specials at participating Hagerstown restaurants.",
    startsAt: "2026-10-14T16:30:00.000Z",
    endsAt: "2026-10-14T18:00:00.000Z",
    location: "Downtown Hagerstown",
  },
  {
    kind: "keynote",
    title: "10 Rounds of Leadership",
    description:
      "Audience-driven challenges meet real-time solutions — two perspectives on your toughest leadership questions.",
    startsAt: "2026-10-14T18:00:00.000Z",
    endsAt: "2026-10-14T19:30:00.000Z",
    location: "Main Stage",
  },
  {
    kind: "networking",
    title: "Networking Happy Hour",
    description:
      "Build real relationships with fellow leaders, speakers, and sponsors.",
    startsAt: "2026-10-14T21:00:00.000Z",
    endsAt: "2026-10-14T22:00:00.000Z",
    location: "Lobby Bar",
  },
];

const PLACEHOLDER_AGENDA: AgendaItem[] = AGENDA_SEEDS.map((seed, i) => ({
  id: `agenda-${i + 1}`,
  description: "",
  location: "",
  track: "",
  speakerId: null,
  speakerName: "",
  endsAt: null,
  vipOnly: false,
  published: true,
  ...seed,
}));

export async function listAgendaItems(eventYear: number): Promise<AgendaItem[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_AGENDA;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("agenda_items")
    .select(
      "id, title, description, kind, location, track, speaker_id, starts_at, ends_at, vip_only, published, speakers ( name )",
    )
    .eq("event_year", eventYear)
    .eq("published", true)
    .order("starts_at");
  // Pre-migration (0043 not applied yet): empty state, not a crash.
  if (error || !data) return [];
  return data.map((row) => {
    const speaker = row.speakers as unknown as { name?: string } | { name?: string }[] | null;
    const speakerName = Array.isArray(speaker)
      ? speaker[0]?.name ?? ""
      : speaker?.name ?? "";
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) ?? "",
      kind: (row.kind as AgendaKind) ?? "session",
      location: (row.location as string) ?? "",
      track: (row.track as string) ?? "",
      speakerId: (row.speaker_id as string) ?? null,
      speakerName,
      startsAt: row.starts_at as string,
      endsAt: (row.ends_at as string) ?? null,
      vipOnly: Boolean(row.vip_only),
      published: Boolean(row.published),
    };
  });
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

const PLACEHOLDER_VENDORS: VendorItem[] = [
  {
    id: "vendor-1",
    name: "Cumberland Valley Coffee Co.",
    tagline: "Local roaster, event coffee bar",
    description: "Pour-overs and cold brew all day in the lobby.",
    category: "Food & Drink",
    booth: "Lobby 1",
    website: null,
    logoUrl: null,
    offer: "Free refill with your summit badge",
  },
  {
    id: "vendor-2",
    name: "Tri-State Print & Promo",
    tagline: "Branded merch and print",
    description: "Business printing, promo products, and same-week turnaround.",
    category: "Marketing",
    booth: "Lobby 2",
    website: null,
    logoUrl: null,
    offer: "10% off orders placed at the booth",
  },
  {
    id: "vendor-3",
    name: "Hagerstown IT Partners",
    tagline: "Managed IT for growing teams",
    description: "Security assessments and managed services for small business.",
    category: "Technology",
    booth: "Mezzanine 1",
    website: null,
    logoUrl: null,
    offer: "Free security checkup for attendees",
  },
];

export async function listVendors(eventYear: number): Promise<VendorItem[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_VENDORS;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(
      "id, name, tagline, description, category, booth, website, logo_url, offer",
    )
    .eq("event_year", eventYear)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    tagline: (row.tagline as string) ?? "",
    description: (row.description as string) ?? "",
    category: (row.category as string) ?? "",
    booth: (row.booth as string) ?? "",
    website: (row.website as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    offer: (row.offer as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// My ticket — the attendee's own row in the import ledger (RLS own-read).
// Registration stays in the live Google Sheet + import cron; this only reads
// what that pipeline already recorded.
// ---------------------------------------------------------------------------

export async function getMyTicket(): Promise<SummitTicket | null> {
  if (!isSupabaseConfigured()) {
    return {
      eventYear: 2026,
      registrationType: "VIP Leadership Experience",
      registeredAt: "2026-05-02T15:00:00.000Z",
    };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("import_log")
    .select("event_year, registration_type, processed_at")
    .eq("profile_id", user.id)
    .order("event_year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    eventYear: data.event_year as number,
    registrationType: (data.registration_type as string) ?? "",
    registeredAt: data.processed_at as string,
  };
}
