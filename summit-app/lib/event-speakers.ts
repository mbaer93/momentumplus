import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * The event's own speaker lineup, managed in /admin — not synced from
 * Momentum+ or anywhere else. RLS: members read active rows; admin CRUD
 * goes through the service role in the admin actions.
 */

export interface EventSpeaker {
  id: string;
  name: string;
  title: string;
  bio: string;
  headshotUrl: string | null;
  website: string | null;
  tags: string[];
  initials: string;
  avatarBg: string;
  avatarColor: string;
}

const AV_BGS = ["#1C3050", "#3A6B96", "#3A7055", "#5C3D7A", "#A04040"];

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "S"
  );
}

function hashIndex(id: string, mod: number): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h % mod;
}

function decorate(row: {
  id: string;
  name: string;
  title?: string | null;
  bio?: string | null;
  headshot_url?: string | null;
  website?: string | null;
  tags?: string | null;
}): EventSpeaker {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    bio: row.bio ?? "",
    headshotUrl: row.headshot_url ?? null,
    website: row.website ?? null,
    tags: (row.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    initials: initialsOf(row.name),
    avatarBg: AV_BGS[hashIndex(row.id, AV_BGS.length)],
    avatarColor: "#D4AE75",
  };
}

// Preview-mode lineup (local dev without a database) — the two hosts named
// on the public event listings.
const PLACEHOLDER_SPEAKERS: EventSpeaker[] = [
  {
    id: "speaker-1",
    name: "Jay Foreman",
    title: "10 Rounds of Leadership — Co-host",
    bio: "Audience-driven leadership challenges met with real-time solutions.",
    tags: ["Leadership"],
  },
  {
    id: "speaker-2",
    name: "Sierra Collins",
    title: "10 Rounds of Leadership — Co-host",
    bio: "Two perspectives on every leadership question, live on stage.",
    tags: ["Leadership"],
  },
].map((s) => ({
  headshotUrl: null,
  website: null,
  initials: initialsOf(s.name),
  avatarBg: AV_BGS[hashIndex(s.id, AV_BGS.length)],
  avatarColor: "#D4AE75",
  ...s,
}));

export async function listEventSpeakers(): Promise<EventSpeaker[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_SPEAKERS;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_speakers")
    .select("id, name, title, bio, headshot_url, website, tags")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error || !data) return [];
  return data.map(decorate);
}

export async function getEventSpeaker(id: string): Promise<EventSpeaker | null> {
  if (!isSupabaseConfigured()) {
    return PLACEHOLDER_SPEAKERS.find((s) => s.id === id) ?? null;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_speakers")
    .select("id, name, title, bio, headshot_url, website, tags")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (error || !data) return null;
  return decorate(data);
}
