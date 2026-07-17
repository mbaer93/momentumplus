import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Additional Services: SLC's own service offerings, listed for members with
 * an external sign-up link. RLS lets members read active rows; admin CRUD
 * goes through the service role in the admin actions.
 */

export interface ServiceItem {
  id: string;
  name: string;
  tagline: string;
  description: string;
  url: string | null;
  priceLabel: string | null;
}

// Preview-mode sample so the page is explorable without a database.
const PLACEHOLDER_SERVICES: ServiceItem[] = [
  {
    id: "svc-1",
    name: "Leadership Coaching",
    tagline: "1-on-1 executive coaching",
    description:
      "Private coaching engagements with the SLC team — goal mapping, accountability, and a growth plan built around your role.",
    url: "#",
    priceLabel: null,
  },
  {
    id: "svc-2",
    name: "Team Workshops",
    tagline: "On-site and virtual training",
    description:
      "Half-day and full-day workshops for your leadership team, tailored to your organization.",
    url: "#",
    priceLabel: null,
  },
];

export async function listServices(): Promise<ServiceItem[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_SERVICES;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, tagline, description, url, price_label")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  // Pre-migration (0029 not applied yet): show an empty state, not a crash.
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    tagline: (row.tagline as string) ?? "",
    description: (row.description as string) ?? "",
    url: (row.url as string) ?? null,
    priceLabel: (row.price_label as string) ?? null,
  }));
}
