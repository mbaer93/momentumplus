"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { easternInputToIso } from "@/lib/eastern-time";
import { agendaLocalInput, type SummitSettings } from "@/lib/summit";
import { saveSummitSettings } from "@/lib/summit-queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function bust() {
  for (const path of [
    "/",
    "/agenda",
    "/vendors",
    "/speakers",
    "/ticket",
    "/admin",
    "/admin/agenda",
    "/admin/vendors",
  ]) {
    revalidatePath(path);
  }
}

// ---------------------------------------------------------------------------
// Event settings
// ---------------------------------------------------------------------------

export async function updateSummitSettings(
  input: Partial<SummitSettings>,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
    return { ok: false, message: "Start date must be YYYY-MM-DD." };
  }
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return { ok: false, message: "End date must be YYYY-MM-DD." };
  }
  await saveSummitSettings(input);
  bust();
  return { ok: true, message: "Event settings saved." };
}

// ---------------------------------------------------------------------------
// Agenda items
// ---------------------------------------------------------------------------

export interface AgendaInput {
  title: string;
  kind: string;
  date: string; // YYYY-MM-DD (ET)
  startTime: string; // "9:00 AM"
  endTime: string; // optional
  location: string;
  track: string;
  speakerId: string;
  description: string;
  vipOnly: boolean;
  published: boolean;
  eventYear: number;
}

function agendaRow(input: AgendaInput):
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; message: string } {
  if (!input.title.trim()) return { ok: false, message: "The item needs a title." };
  const startLocal = agendaLocalInput(input.date, input.startTime);
  const startsAt = startLocal ? easternInputToIso(startLocal) : null;
  if (!startsAt) {
    return {
      ok: false,
      message: "Start needs a date (YYYY-MM-DD) and a time like 9:00 AM.",
    };
  }
  let endsAt: string | null = null;
  if (input.endTime.trim()) {
    const endLocal = agendaLocalInput(input.date, input.endTime);
    endsAt = endLocal ? easternInputToIso(endLocal) : null;
    if (!endsAt) return { ok: false, message: "End time looks off — try 10:15 AM." };
  }
  return {
    ok: true,
    row: {
      title: input.title.trim(),
      kind: input.kind || "session",
      starts_at: startsAt,
      ends_at: endsAt,
      location: input.location.trim() || null,
      track: input.track.trim() || null,
      speaker_id: input.speakerId || null,
      description: input.description.trim() || null,
      vip_only: input.vipOnly,
      published: input.published,
      event_year: input.eventYear,
    },
  };
}

export async function createAgendaItem(input: AgendaInput): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = agendaRow(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { error } = await createServiceClient()
    .from("agenda_items")
    .insert(parsed.row);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Agenda item added." };
}

export async function updateAgendaItem(
  id: string,
  input: AgendaInput,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = agendaRow(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { error } = await createServiceClient()
    .from("agenda_items")
    .update(parsed.row)
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Agenda item saved." };
}

export async function deleteAgendaItem(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { error } = await createServiceClient()
    .from("agenda_items")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Agenda item deleted." };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export interface VendorInput {
  name: string;
  tagline: string;
  category: string;
  booth: string;
  website: string;
  logoUrl: string;
  offer: string;
  description: string;
  sortOrder: string;
  active: boolean;
  eventYear: number;
}

function vendorRow(input: VendorInput) {
  const sort = Number.parseInt(input.sortOrder, 10);
  return {
    name: input.name.trim(),
    tagline: input.tagline.trim() || null,
    category: input.category.trim() || null,
    booth: input.booth.trim() || null,
    website: input.website.trim() || null,
    logo_url: input.logoUrl.trim() || null,
    offer: input.offer.trim() || null,
    description: input.description.trim() || null,
    sort_order: Number.isFinite(sort) ? sort : 0,
    active: input.active,
    event_year: input.eventYear,
  };
}

export async function createVendor(input: VendorInput): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.name.trim()) return { ok: false, message: "The vendor needs a name." };

  const { error } = await createServiceClient().from("vendors").insert(vendorRow(input));
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Vendor added." };
}

export async function updateVendor(
  id: string,
  input: VendorInput,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.name.trim()) return { ok: false, message: "The vendor needs a name." };

  const { error } = await createServiceClient()
    .from("vendors")
    .update(vendorRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Vendor saved." };
}

export async function deleteVendor(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { error } = await createServiceClient().from("vendors").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Vendor deleted." };
}
