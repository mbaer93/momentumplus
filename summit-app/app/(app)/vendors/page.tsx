import Image from "next/image";
import { getSummitSettings, listVendors } from "@/lib/summit-queries";

export const dynamic = "force-dynamic";

export default async function SummitVendorsPage() {
  const settings = await getSummitSettings();
  const vendors = await listVendors(settings.eventYear);

  return (
    <div className="tsls-pad">
      <div className="tsls-page-header">
        <h2>Vendors</h2>
        <p>Visit the booths — many have attendee-only offers</p>
      </div>

      {vendors.length === 0 && (
        <div className="tsls-empty">
          Vendor booths will be listed here as they&apos;re confirmed.
        </div>
      )}

      <div className="tsls-vendor-grid">
        {vendors.map((v) => (
          <div key={v.id} className="tsls-vendor-card">
            <div className="tsls-vendor-head">
              {v.logoUrl ? (
                <Image
                  src={v.logoUrl}
                  alt={`${v.name} logo`}
                  width={44}
                  height={44}
                  className="tsls-vendor-logo"
                  style={{ objectFit: "contain" }}
                />
              ) : (
                <div className="tsls-vendor-mark">{v.name.slice(0, 2)}</div>
              )}
              <div>
                <div className="tsls-vendor-name">{v.name}</div>
                {v.tagline && <div className="tsls-vendor-tagline">{v.tagline}</div>}
              </div>
              {v.booth && <span className="tsls-booth-badge">{v.booth}</span>}
            </div>
            {v.description && <p className="tsls-vendor-desc">{v.description}</p>}
            {v.offer && (
              <div className="tsls-vendor-offer">
                <span>Attendee offer</span>
                {v.offer}
              </div>
            )}
            <div className="tsls-vendor-foot">
              {v.category && <span className="tsls-track-label">{v.category}</span>}
              {v.website && (
                <a
                  href={v.website}
                  target="_blank"
                  rel="noreferrer"
                  className="tsls-vendor-link"
                >
                  Website
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
