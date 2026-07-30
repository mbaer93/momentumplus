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
  available: number | null;
  soldOut: boolean;
  vipTickets: number;
  highlights: string[];
  active: boolean;
}

const mPlus = SPONSOR_PACKAGES_2026.find((p) => p.tier === "momentum_plus");
const PLATFORM_TIERS: CatalogTier[] = [
  {
    value: "host",
    label: "Host Sponsor",
    price: 0,
    inKind: false,
    available: 1,
    soldOut: false,
    vipTickets: 0,
    highlights: ["The platform's own headline sponsor"],
    active: true,
  },
  {
    value: "momentum_plus",
    label: "Momentum+ Sponsor",
    price: mPlus?.price ?? 10000,
    inKind: false,
    available: mPlus?.available ?? 1,
    soldOut: mPlus?.soldOut ?? false,
    vipTickets: mPlus?.vipTickets ?? 2,
    highlights: mPlus?.highlights ?? [],
    active: true,
  },
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
    available: p?.available ?? null,
    soldOut: p?.soldOut ?? false,
    vipTickets: p?.vipTickets ?? 0,
    highlights: p?.highlights ?? [],
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
        .select(
          "value, label, price, in_kind, available, sold_out, vip_tickets, highlights, active, sort",
        )
        .order("sort");
      if (!error && data?.length) {
        event = data.map((r) => ({
          value: String(r.value),
          label: String(r.label),
          price: Number(r.price ?? 0),
          inKind: Boolean(r.in_kind),
          available: r.available === null ? null : Number(r.available),
          soldOut: Boolean(r.sold_out),
          vipTickets: Number(r.vip_tickets ?? 0),
          highlights: Array.isArray(r.highlights)
            ? r.highlights.map(String)
            : [],
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
