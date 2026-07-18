"use server";

import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Member testimonial submission (the dashboard "share your experience"
 * card). Lands as status=pending; nothing reaches the public page until an
 * admin approves it in Admin → Testimonials.
 */

export async function submitTestimonial(input: {
  quote: string;
  name: string;
  roleCompany: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Thanks! (Preview mode — not saved.)" };
  }
  const quote = input.quote.trim().slice(0, 1200);
  const name = input.name.trim().slice(0, 120);
  if (quote.length < 20) {
    return { ok: false, message: "Tell us a little more — a sentence or two." };
  }
  if (!name) {
    return { ok: false, message: "Add the name you'd like shown." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const admin = createServiceClient();
  // One live submission per member — resubmitting replaces their pending one.
  const { data: existing, error: readError } = await admin
    .from("testimonials")
    .select("id, status")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (readError) {
    return { ok: false, message: "Testimonials aren't set up yet — run migration 0035." };
  }
  if (existing?.status === "approved") {
    return { ok: true, message: "You already have a published testimonial — thank you!" };
  }
  const row = {
    profile_id: user.id,
    name,
    role_company: input.roleCompany.trim().slice(0, 160) || null,
    quote,
    status: "pending",
  };
  const { error } = existing
    ? await admin.from("testimonials").update(row).eq("id", existing.id)
    : await admin.from("testimonials").insert(row);
  if (error) return { ok: false, message: error.message };

  // Tell the admins there's a testimonial waiting.
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .not("admin_role", "is", null);
  if (admins?.length) {
    await admin.from("notifications").insert(
      admins.map((a) => ({
        profile_id: a.id,
        kind: "platform",
        title: "New testimonial to review",
        body: `${name}: “${quote.slice(0, 100)}${quote.length > 100 ? "…" : ""}”`,
        link: "/admin/testimonials",
      })),
    );
  }
  return {
    ok: true,
    message: "Thank you! The team reviews every testimonial before it's published.",
  };
}

/** Whether the member already has a testimonial on file (hides the ask). */
export async function hasTestimonial(): Promise<boolean> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await createServiceClient()
    .from("testimonials")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  return !error && Boolean(data);
}
