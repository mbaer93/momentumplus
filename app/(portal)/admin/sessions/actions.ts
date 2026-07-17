"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { easternInputToIso } from "@/lib/eastern-time";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AccessLevel, SessionStatus } from "@/lib/types";

export interface SessionFormValues {
  title: string;
  description: string;
  category: string;
  startsAt: string; // "YYYY-MM-DDTHH:mm" Eastern wall time, or ""
  durationMin: number;
  capacity: number | null;
  minAccess: AccessLevel;
  status: SessionStatus;
  /** Speaker record this session links to ("" = none yet). */
  speakerId: string;
  /** Rooted Focus lives on its own member tab. */
  program: "standard" | "rooted_focus";
  /** Recurring series cadence ("" = one-time). */
  recurrence: "" | "weekly" | "biweekly" | "monthly";
  /** Optional series end, "YYYY-MM-DD" (ET) — blank = open-ended. */
  recurrenceUntil: string;
  /** Non-speaker host (e.g. an SLC admin) shown when no speaker is linked. */
  hostName: string;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  id?: string;
  /** Saved, but something needs the admin's attention (styled as a warning,
      not green success — e.g. the Zoom meeting couldn't be rescheduled). */
  warning?: boolean;
}

function toRow(values: SessionFormValues) {
  return {
    title: values.title,
    description: values.description || null,
    category: values.category || null,
    // datetime-local values are Eastern wall time by definition (the whole
    // product pins ET); parsing with new Date() here would use the SERVER's
    // timezone and shift every session by hours on each save.
    starts_at: values.startsAt ? easternInputToIso(values.startsAt) : null,
    duration_min: values.durationMin || null,
    capacity: values.capacity,
    min_access: values.minAccess,
    status: values.status,
    speaker_id: values.speakerId || null,
    program: values.program === "rooted_focus" ? "rooted_focus" : "standard",
    recurrence: values.recurrence || null,
    // End of day ET so the final occurrence on that date still counts.
    recurrence_until: values.recurrenceUntil
      ? easternInputToIso(`${values.recurrenceUntil}T23:59`)
      : null,
    host_name: values.hostName.trim() || null,
  };
}

/** Friendly hint when the Rooted Focus columns aren't deployed yet. */
function migrationHint(message: string): string {
  return /program|recurrence|host_name/.test(message)
    ? "The database doesn't have the Rooted Focus columns yet — run migration 0030 first."
    : message;
}

export async function createSession(
  values: SessionFormValues,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      preview: true,
      message: "Session would be created (preview mode — no database).",
    };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("sessions")
    .insert(toRow(values))
    .select("id")
    .single();

  if (error) return { ok: false, message: migrationHint(error.message) };
  revalidatePath("/admin/sessions");
  revalidatePath("/sessions");
  revalidatePath("/rooted-focus");
  return { ok: true, id: data.id, message: "Session created." };
}

export async function updateSession(
  id: string,
  values: SessionFormValues,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const row = toRow(values);
  const { data: updated, error } = await admin
    .from("sessions")
    .update(row)
    .eq("id", id)
    .select("zoom_meeting_id")
    .maybeSingle();
  if (error) return { ok: false, message: migrationHint(error.message) };

  // A published session already has a Zoom meeting — keep it in lockstep,
  // or members join a meeting whose schedule disagrees with the portal.
  let zoomNote = "";
  if (updated?.zoom_meeting_id) {
    try {
      const { isZoomReady } = await import("@/lib/service-config");
      if (await isZoomReady()) {
        const { updateZoomMeeting } = await import("@/lib/zoom");
        await updateZoomMeeting(updated.zoom_meeting_id, {
          topic: row.title,
          startTime: row.starts_at ?? undefined,
          durationMin: row.duration_min ?? undefined,
          agenda: row.description ?? undefined,
        });
      }
    } catch (e) {
      zoomNote = ` WARNING: the Zoom meeting could NOT be rescheduled (${(e as Error).message}). Members' Zoom invite still has the OLD time — fix it in Zoom or re-save this session.`;
    }
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/sessions");
  revalidatePath("/rooted-focus");
  return {
    ok: true,
    id,
    warning: Boolean(zoomNote),
    message: `Session saved.${zoomNote}`,
  };
}

/**
 * Cancel a session without deleting it: members see an honest "Cancelled"
 * state (and can no longer enroll) while notes/enrollment history survive.
 * Members are NOT auto-notified — announce the cancellation separately.
 */
export async function cancelSession(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Cancelled (preview mode)." };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sessions")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) {
    if (/invalid input value for enum/i.test(error.message)) {
      return {
        ok: false,
        message:
          "The database doesn't have the 'cancelled' status yet — run migration 0026 first.",
      };
    }
    return { ok: false, message: error.message };
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/sessions");
  return {
    ok: true,
    message:
      "Session cancelled — members now see it as Cancelled. Consider sending an announcement.",
  };
}

export async function deleteSession(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.from("sessions").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sessions");
  revalidatePath("/sessions");
  return { ok: true, message: "Session deleted." };
}
