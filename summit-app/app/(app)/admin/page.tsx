import Link from "next/link";
import { SummitSettingsForm } from "@/components/summit/SummitSettingsForm";
import { getSummitSettings } from "@/lib/summit-queries";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function SummitAdminPage() {
  const settings = await getSummitSettings();

  return (
    <div className="tsls-pad">
      <div className="tsls-page-header">
        <h2>Summit Admin</h2>
        <p>Event settings, agenda, and vendors for the companion app</p>
      </div>

      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: changes persist once Supabase is connected.
        </div>
      )}

      <div className="tsls-admin-links">
        <Link href="/admin/agenda" className="tsls-tile">
          <span className="tsls-tile-body">
            <span className="tsls-tile-title">Agenda</span>
            <span className="tsls-tile-desc">
              The day-of schedule attendees see, with live &quot;happening now&quot;
            </span>
          </span>
        </Link>
        <Link href="/admin/speakers" className="tsls-tile">
          <span className="tsls-tile-body">
            <span className="tsls-tile-title">Speakers</span>
            <span className="tsls-tile-desc">
              The event lineup — bios, headshots, and topic tags
            </span>
          </span>
        </Link>
        <Link href="/admin/vendors" className="tsls-tile">
          <span className="tsls-tile-body">
            <span className="tsls-tile-title">Vendors</span>
            <span className="tsls-tile-desc">
              Booths, categories, and attendee offers
            </span>
          </span>
        </Link>
      </div>

      <section className="tsls-card" style={{ marginTop: 20 }}>
        <h3>Event settings</h3>
        <p className="tsls-admin-note">
          Registration itself stays in your current pipeline (registration
          platform → Google Sheet → automatic import). These settings only
          control what the companion app displays and where the register /
          upgrade buttons point.
        </p>
        <SummitSettingsForm initial={settings} />
      </section>
    </div>
  );
}
