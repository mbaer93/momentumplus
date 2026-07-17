import { AdminAddChip } from "@/components/admin/AdminChips";
import { BriefcaseIcon, ExternalIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { listServices } from "@/lib/services-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Additional Services | Momentum+" };

/*
 * Additional Services: everything Sierra Learnership Collaborative offers
 * beyond the membership, each with details and a sign-up link.
 */
export default async function ServicesPage() {
  const member = await requireMember();
  const services = await listServices();

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Additional Services</h2>
          <p>
            Work with the Sierra Learnership Collaborative team beyond your
            membership
          </p>
        </div>
        {member.isAdmin && (
          <AdminAddChip href="/admin/services" label="Manage services" />
        )}
      </div>

      {services.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          Services will appear here as they&apos;re published.
        </div>
      )}

      <div className="resources-grid">
        {services.map((s) => (
          <div className="resource-card" key={s.id}>
            <div
              className="resource-icon"
              style={{ background: "var(--gold-pale)" }}
            >
              <span style={{ color: "var(--gold)" }}>
                <BriefcaseIcon size={20} />
              </span>
            </div>
            <div className="resource-body">
              <div className="resource-type" style={{ color: "var(--gold)" }}>
                {s.tagline || "SLC Service"}
              </div>
              <div className="resource-title">{s.name}</div>
              <div className="resource-desc">{s.description}</div>
              <div className="resource-meta">
                {s.priceLabel && (
                  <span className="resource-tag">{s.priceLabel}</span>
                )}
                {s.url && s.url !== "#" ? (
                  <a
                    className="resource-link"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Sign up <ExternalIcon size={12} />
                  </a>
                ) : (
                  <span
                    className="resource-link"
                    style={{ color: "var(--mid-gray)", cursor: "default" }}
                  >
                    Details coming soon
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
