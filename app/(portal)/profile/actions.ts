"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PREF_KEYS, type PrefRow } from "@/lib/notifications";

export interface ProfileResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

/** Member changes their own password (Profile → Preferences). */
export async function changePassword(
  newPassword: string,
): Promise<ProfileResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Changed (preview mode)" };
  }
  if (newPassword.length < 8) {
    return { ok: false, message: "Use at least 8 characters." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return {
      ok: false,
      message: error.message.includes("different from the old")
        ? "That's already your password — pick a new one."
        : `Couldn't change the password: ${error.message}`,
    };
  }
  return { ok: true, message: "Password changed." };
}

export async function updateProfile(input: {
  full_name: string;
  phone: string;
  company: string;
  title: string;
  industry: string;
  bio: string;
  /** Only persisted when the caller is an admin (chat badge title). */
  admin_title?: string;
}): Promise<ProfileResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)" };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const update: Record<string, string | null> = {
    full_name: input.full_name.trim(),
    phone: input.phone.trim() || null,
    company: input.company.trim() || null,
    title: input.title.trim() || null,
    industry: input.industry.trim() || null,
    bio: input.bio.trim() || null,
  };
  if (input.admin_title !== undefined) {
    const member = await getCurrentMember();
    if (member?.isAdmin) {
      update.admin_title = input.admin_title.trim() || null;
    }
  }

  // RLS: members can only update their own profile row.
  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/profile");
  revalidatePath("/community");
  return { ok: true, message: "Profile saved" };
}

export async function saveNotificationPrefs(
  prefs: PrefRow[],
): Promise<ProfileResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)" };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const rows = prefs
    .filter((p) => (PREF_KEYS as readonly string[]).includes(p.key))
    .map((p) => ({
      profile_id: user.id,
      key: p.key,
      // Platform email is locked on server-side too.
      email: p.key === "platform" ? true : p.email,
      sms: p.sms,
      in_app: p.in_app,
    }));

  const { error } = await supabase
    .from("notification_prefs")
    .upsert(rows, { onConflict: "profile_id,key" });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/profile");
  return { ok: true, message: "Preferences saved" };
}
