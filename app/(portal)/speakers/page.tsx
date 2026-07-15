import Link from "next/link";
import { requireMember } from "@/lib/current-member";
import { listSpeakers } from "@/lib/directory-queries";

export const dynamic = "force-dynamic";

export default async function SpeakersPage() {
  await requireMember();
  const speakers = await listSpeakers();

  return (
    <div className="speakers-pad">
      <div className="section-header">
        <div>
          <h2>Our Speakers</h2>
          <p>World-class coaches and thought leaders</p>
        </div>
      </div>
      {speakers.length === 0 && (
        <div className="sessions-empty" style={{ marginTop: 20 }}>
          Speaker profiles will appear here as they&apos;re added.
        </div>
      )}
      <div className="speakers-grid">
        {speakers.map((s) => (
          <Link key={s.id} href={`/speakers/${s.id}`} className="speaker-card">
            <div
              className="speaker-card-banner"
              style={{ background: s.bannerGradient }}
            >
              <div
                className="speaker-card-av"
                style={{ background: s.avatarBg, color: s.avatarColor }}
              >
                {s.initials}
              </div>
            </div>
            <div className="speaker-card-body">
              <div className="speaker-card-name">{s.name}</div>
              <div className="speaker-card-title">{s.title}</div>
              <div className="speaker-card-tags">
                {s.industries.map((tag) => (
                  <span className="tag-pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="speaker-card-footer">
              <div className="speaker-stat">
                Member since <strong>{s.memberSince}</strong>
              </div>
              <div className="speaker-stat">
                <strong>{s.sessionCount}</strong> sessions
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
