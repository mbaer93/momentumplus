"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface AdminResult {
  ok: boolean;
  message?: string;
}

async function guard(): Promise<AdminResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  return null;
}

function bust() {
  revalidatePath("/admin/testimonials");
  revalidatePath("/");
  revalidateTag("testimonials");
}

export async function setTestimonialStatus(
  id: string,
  status: "approved" | "hidden" | "pending",
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("testimonials")
    .update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return {
    ok: true,
    message:
      status === "approved"
        ? "Approved — it's on the landing page."
        : "Hidden from the landing page.",
  };
}

export async function deleteTestimonial(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("testimonials")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Testimonial deleted." };
}
