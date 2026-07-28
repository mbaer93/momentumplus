/*
 * Content topics (migration 0055) — Sierra's browse-by-subject taxonomy for
 * the Library.
 *
 * Distinct from `category` on a session, which is its FORMAT ("Monthly
 * Educational Session", "Productivity Session"). A member browsing the
 * Library is looking for a subject, not a format, so topics are what the
 * filter row is built from. Both stay, because both answer a real question.
 *
 * Each item has at most one primary topic and any number of secondary ones.
 */

import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { requestCache } from "./request-cache";

export interface Topic {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort: number;
}

/** A topic as attached to one piece of content. */
export interface TopicRef {
  id: string;
  name: string;
  slug: string;
  isPrimary: boolean;
}

/* Mirrors the seed in 0055 so preview mode and the e2e suite have a taxonomy. */
const PREVIEW_TOPICS: Topic[] = [
  ["Business Strategy, Systems & Growth", "business-strategy", 10],
  ["Communication & Difficult Conversations", "communication", 20],
  ["Emotional Intelligence", "emotional-intelligence", 30],
  ["Health, Wellness & Sustainable Leadership", "health-wellness", 40],
  ["Leadership Foundations & Reflection", "leadership-foundations", 50],
  ["Networks, Relationships & Connection", "networks-relationships", 60],
  ["Purpose, Values & Identity", "purpose-values", 70],
  ["Resilience, Pivots & Adversity", "resilience-pivots", 80],
  ["Self Leadership & Personal Growth", "self-leadership", 90],
  ["Service, Community & Civic Leadership", "service-community", 100],
  ["Team Culture & Environments", "team-culture", 110],
].map(([name, slug, sort]) => ({
  id: slug as string,
  name: name as string,
  slug: slug as string,
  description: "",
  sort: sort as number,
}));

export const listTopics = requestCache(async (): Promise<Topic[]> => {
  if (!isSupabaseConfigured()) return PREVIEW_TOPICS;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_topics")
    .select("id, name, slug, description, sort")
    .is("archived_at", null)
    .order("sort")
    .order("name");
  // Pre-migration: the filter row falls back to the seed rather than vanishing.
  if (error) return PREVIEW_TOPICS;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: String(r.description ?? ""),
    sort: Number(r.sort ?? 100),
  }));
});

/**
 * Shape the nested `content_topics` join PostgREST returns into TopicRefs,
 * primary first so a card can show it without sorting again.
 */
export function mapTopicRows(rows: unknown): TopicRef[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as {
        is_primary?: boolean;
        content_topics?: { id?: string; name?: string; slug?: string } | null;
      };
      const t = r.content_topics;
      if (!t?.id || !t.name || !t.slug) return null;
      return {
        id: String(t.id),
        name: String(t.name),
        slug: String(t.slug),
        isPrimary: Boolean(r.is_primary),
      };
    })
    .filter((t): t is TopicRef => t !== null)
    .sort((a, b) =>
      a.isPrimary === b.isPrimary ? a.name.localeCompare(b.name) : a.isPrimary ? -1 : 1,
    );
}

export function primaryTopic(topics: TopicRef[]): TopicRef | null {
  return topics.find((t) => t.isPrimary) ?? null;
}
