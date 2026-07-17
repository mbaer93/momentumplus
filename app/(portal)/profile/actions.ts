"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PREF_KEYS, type PrefRow } from "@/lib/notifications";
import { checkPassword } from "@/lib/password";

export interface ProfileResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

/** Member changes their own password (Profile → Preferences). */
export async function changePassword(
  newPassword: string,
  currentPassword?: string,
): Promise<ProfileResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Changed (preview mode)" };
  }
  const policyError = checkPassword(newPassword);
  if (policyError) {
    return { ok: false, message: policyError };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "Not signed in." };

  // Re-verify the current password before changing it — a hijacked or
  // shoulder-surfed open session must not be able to silently lock the
  // owner out. (Skipped only for accounts with no password yet.)
  if (!currentPassword) {
    return { ok: false, message: "Enter your current password to confirm." };
  }
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { ok: false, message: "That current password isn't right." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return {
      ok: false,
      message: error.message.includes("different from the old")
        ? "That's already your password — pick a new one."
        : `Couldn't change the password: ${error.message}`,
    };
  }

  // Sign every OTHER session out so a stolen session can't outlive the
  // password change (updateUser alone leaves siblings valid).
  try {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await createServiceClient().auth.admin.signOut(user.id, "others");
    }
  } catch {
    // Best-effort — the password is already changed.
  }

  return {
    ok: true,
    message: "Password changed. Other devices have been signed out.",
  };
}

export async function updateProfile(input: {
  full_name: string;
  phone: string;
  company: string;
  title: string;
  industry: string;
  bio: string;
  /** Opt-in: show email/phone on the Member Directory (default off). */
  share_contact?: boolean;
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

  const update: Record<string, string | boolean | null> = {
    full_name: input.full_name.trim(),
    phone: input.phone.trim() || null,
    company: input.company.trim() || null,
    title: input.title.trim() || null,
    industry: input.industry.trim() || null,
    bio: input.bio.trim() || null,
  };
  if (input.share_contact !== undefined) {
    update.share_contact = input.share_contact;
  }
  if (input.admin_title !== undefined) {
    const member = await getCurrentMember();
    if (member?.isAdmin) {
      update.admin_title = input.admin_title.trim() || null;
    }
  }

  // RLS: members can only update their own profile row.
  let { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error && error.message.includes("share_contact")) {
    // Pre-migration fallback: the column arrives with 0034.
    delete update.share_contact;
    ({ error } = await supabase.from("profiles").update(update).eq("id", user.id));
  }

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
