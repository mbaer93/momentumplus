import Link from "next/link";
import { AgendaManager } from "@/components/summit/AgendaManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { isoToEasternInput } from "@/lib/eastern-time";
import { listSpeakersForAdmin } from "@/lib/directory-queries";
import { AGENDA_KIND_LABELS, agendaTimeLabel, type AgendaKind } from "@/lib/summit";
import { getSummitSettings } from "@/lib/summit-queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** "2026-10-14T09:00" (ET wall) → { date, time12 } for the edit form. */
function splitEastern(iso: string | null): { date: string; time: string } {
  const local = iso ? isoToEasternInput(iso) : "";
  if (!local) return { date: "", time: "" };
  const [date, hm] = local.split("T");
  const [h, m] = hm.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { date, time: `${h12}:${String(m).padStart(2, "0")} ${mer}` };
}

export default async function SummitAdminAgendaPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  const settings = await getSummitSettings();
  let rows: EntityRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("agenda_items")
      .select(
        "id, title, description, kind, location, track, speaker_id, starts_at, ends_at, vip_only, published",
      )
      .eq("event_year", settings.eventYear)
      .order("starts_at");
    rows = (data ?? []).map((a) => {
      const start = splitEastern(a.starts_at as string);
      const end = splitEastern((a.ends_at as string) ?? null);
      const kindLabel =
        AGENDA_KIND_LABELS[(a.kind as AgendaKind) ?? "session"] || "Item";
      return {
        id: a.id as string,
        title: a.title as string,
        subtitle: `${kindLabel} · ${agendaTimeLabel(a.starts_at as string)}${
          a.location ? ` · ${a.location}` : ""
        }`,
        badge: a.published ? undefined : "Hidden",
        values: {
          title: a.title as string,
          kind: (a.kind as string) ?? "session",
          date: start.date,
          startTime: start.time,
          endTime: end.time,
          location: (a.location as string) ?? "",
          track: (a.track as string) ?? "",
          speakerId: (a.speaker_id as string) ?? "",
          description: (a.description as string) ?? "",
          vipOnly: Boolean(a.vip_only),
          published: Boolean(a.published),
        },
      };
    });
  }

  const speakers = (await listSpeakersForAdmin()).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return (
    <div className="tsls-pad">
      <Link href="/summit/admin" className="tsls-back">
        ← Summit Admin
      </Link>
      <div className="tsls-page-header">
        <h2>Agenda · {settings.eventYear}</h2>
        <p>All times Eastern. Unpublished items stay hidden from attendees.</p>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: changes persist once Supabase is connected.
        </div>
      )}
      <AgendaManager
        rows={rows}
        speakers={speakers}
        eventYear={settings.eventYear}
        defaultDate={settings.startDate}
      />
    </div>
  );
}
