"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { logAdminAction } from "@/lib/admin-audit";
import { requireRealAdmin } from "@/lib/auth-helpers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAccessMatrix, findTier } from "@/lib/tiers";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

export interface ViewAsResult {
  ok: boolean;
  message?: string;
}

/*
 * Entering and leaving a preview both go through requireRealAdmin(), not
 * requireAdmin(): once the cookie is set the ordinary admin check refuses,
 * which is the point — but it must still be possible to get back out.
 */

export async function startViewAs(tier: string): Promise<ViewAsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Not available in preview mode." };
  }
  const auth = await requireRealAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  // Any admin may preview (Matt, 2026-08-05) — View As only ever narrows
  // what the signer already sees, so it's safe beyond Super Admins. The
  // Control Center itself stays Super Admin only.

  const known = findTier(await getAccessMatrix(), tier);
  if (!known) return { ok: false, message: "No such member type." };

  const jar = await cookies();
  jar.set(VIEW_AS_COOKIE, known.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Deliberately short. A preview left open is an admin who thinks they
    // have no access; four hours is a long working session and no more.
    maxAge: 60 * 60 * 4,
  });

  await logAdminAction({
    actorId: auth.userId,
    actorEmail: auth.userEmail,
    action: "view_as.start",
    detail: `${known.label} (${known.slug})`,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Now viewing as ${known.label}.` };
}

export async function stopViewAs(): Promise<ViewAsResult> {
  const auth = await requireRealAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE);

  await logAdminAction({
    actorId: auth.userId,
    actorEmail: auth.userEmail,
    action: "view_as.stop",
    detail: "",
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Back to your own view." };
}
