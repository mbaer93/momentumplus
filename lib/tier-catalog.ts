import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { requestCache } from "./request-cache";
import { SPONSOR_TIERS } from "./sponsor-tiers";
import { SPONSOR_PACKAGES_2026 } from "./sponsor-packages";

/*
 * The display catalog of sponsor tiers — synced from TSLS (sponsor_tiers,
 * migration 0067, pushed by TSLS Admin → Event Planning) with the
 * code-defined 2026 catalog as the pre-sync fallback. The two
 * platform-only tiers (Host, Momentum+ Sponsor) belong to Momentum+ and
 * always lead the list; the event tiers follow in TSLS's order.
 */

export interface CatalogTier {
  value: string;
  label: string;
  price: number;
  inKind: boolean;
  soldOut: boolean;
  active: boolean;
}

const PLATFORM_TIERS: CatalogTier[] = [
  { value: "host", label: "Host Sponsor", price: 0, inKind: false, soldOut: false, active: true },
  { value: "momentum_plus", label: "Momentum+ Sponsor", price: 10000, inKind: false, soldOut: false, active: true },
];

const FALLBACK_EVENT_TIERS: CatalogTier[] = SPONSOR_TIERS.filter(
  (t) => t.value !== "host" && t.value !== "momentum_plus",
).map((t) => {
  const p = SPONSOR_PACKAGES_2026.find((x) => x.tier === t.value);
  return {
    value: t.value,
    label: t.label,
    price: p?.price ?? 0,
    inKind: p?.inKind ?? false,
    soldOut: p?.soldOut ?? false,
    active: true,
  };
});

/** Full ordered catalog: platform tiers first, then event tiers. */
export const listTierCatalog = requestCache(
  async (): Promise<CatalogTier[]> => {
    let event: CatalogTier[] = FALLBACK_EVENT_TIERS;
    if (isSupabaseConfigured()) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("sponsor_tiers")
        .select("value, label, price, in_kind, sold_out, active, sort")
        .order("sort");
      if (!error && data?.length) {
        event = data.map((r) => ({
          value: String(r.value),
          label: String(r.label),
          price: Number(r.price ?? 0),
          inKind: Boolean(r.in_kind),
          soldOut: Boolean(r.sold_out),
          active: r.active !== false,
        }));
      }
    }
    // TSLS never carries the platform tiers; keep them leading regardless.
    return [
      ...PLATFORM_TIERS,
      ...event.filter((t) => t.value !== "host" && t.value !== "momentum_plus"),
    ];
  },
);
