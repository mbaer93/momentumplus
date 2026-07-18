import { unstable_cache } from "next/cache";

/*
 * Testimonials: members submit, an admin approves, approved quotes render
 * on the public landing page. Reads are cached 5 minutes and busted by the
 * admin actions (tag "testimonials").
 */

export interface PublicTestimonial {
  id: string;
  name: string;
  roleCompany: string;
  quote: string;
}

export const listApprovedTestimonials = unstable_cache(
  async (): Promise<PublicTestimonial[]> => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createServiceClient()
      .from("testimonials")
      .select("id, name, role_company, quote")
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(9);
    if (error || !data) return []; // pre-migration (0035) → section hides
    return data.map((t) => ({
      id: t.id as string,
      name: t.name as string,
      roleCompany: (t.role_company as string) ?? "",
      quote: t.quote as string,
    }));
  },
  ["testimonials-approved"],
  { revalidate: 300, tags: ["testimonials"] },
);
