import {
  TestimonialsManager,
  type AdminTestimonialRow,
} from "@/components/admin/TestimonialsManager";
import {} from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { formatAt } from "@/lib/time-format";

export const dynamic = "force-dynamic";

export default async function AdminTestimonialsPage() {
  let rows: AdminTestimonialRow[] = [];
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("testimonials")
      .select("id, name, role_company, quote, status, created_at")
      .order("created_at", { ascending: false });
    rows = (data ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      roleCompany: (t.role_company as string) ?? "",
      quote: t.quote as string,
      status: t.status as AdminTestimonialRow["status"],
      dateLabel: formatAt(t.created_at as string, "date"),
    }));
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Testimonials</h2>
          <p>
            Member-submitted reviews — approved ones appear on the public
            landing page
          </p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: testimonials appear once Supabase is connected.
        </div>
      )}
      <TestimonialsManager rows={rows} />
    </div>
  );
}
