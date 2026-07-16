import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarIcon,
  CommunityIcon,
  EducationIcon,
  LibraryIcon,
  ResourcesIcon,
  SessionsIcon,
} from "@/components/icons";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Momentum+ | The Tri-State Leadership Community",
  description:
    "Live leadership sessions, a full session library, self-paced courses with CE certificates, and a private community of Tri-State leaders. By the Tri-State Leadership Summit.",
};

const PERKS: { icon: typeof SessionsIcon; title: string; desc: string }[] = [
  {
    icon: SessionsIcon,
    title: "Live Monthly Sessions",
    desc: "Nationally recognized speakers, live on Zoom — with enrollment, reminders, and your own private session notes.",
  },
  {
    icon: LibraryIcon,
    title: "Full Session Library",
    desc: "Every past session, recorded and searchable, with AI-generated key takeaways and action items for each one.",
  },
  {
    icon: EducationIcon,
    title: "Courses & CE Certificates",
    desc: "Self-paced learning tracks with lessons, tests, and printable certificates showing continuing-education hours.",
  },
  {
    icon: CommunityIcon,
    title: "Private Community",
    desc: "A members-only space to trade wins, questions, and introductions with leaders across MD, PA, and WV.",
  },
  {
    icon: ResourcesIcon,
    title: "Tools & Member Offers",
    desc: "Downloadable frameworks, partner resources, and exclusive offers from sponsors who back the community.",
  },
  {
    icon: CalendarIcon,
    title: "Your Learning Record",
    desc: "Sessions attended, courses completed, certificates earned — tracked automatically on your member profile.",
  },
];

export default async function HomePage() {
  // Signed-in members skip the marketing page.
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  const stripe = await getStripeSettings();
  const live = stripeReady(stripe);
  const basicPrice = stripe?.displayPrices?.basic ?? null;
  const proPrice = stripe?.displayPrices?.pro ?? null;

  return (
    <div className="land-screen">
      {/* Top nav */}
      <header className="land-nav">
        <div className="land-wordmark">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <nav className="land-nav-links">
          <a href="#perks">Membership</a>
          <a href="#pricing">Pricing</a>
          <Link href="/login" className="land-login-btn">
            Member Login
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="land-hero">
        <div className="land-badge">
          By the Tri-State Leadership Summit
        </div>
        <h1>
          Leadership doesn&apos;t stop
          <br />
          when the summit ends.
        </h1>
        <p>
          Momentum+ is the members-only community and learning platform for
          leaders in Maryland, Pennsylvania, and West Virginia — live monthly
          sessions, a full recording library, self-paced courses with CE
          certificates, and a private community that keeps you moving.
        </p>
        <div className="land-hero-actions">
          <a href="#pricing" className="btn-gold land-cta">
            Become a Member
          </a>
          <Link href="/login" className="land-ghost-btn">
            I&apos;m already a member
          </Link>
        </div>
      </section>

      {/* Perks */}
      <section className="land-section" id="perks">
        <div className="land-kicker">What you get</div>
        <h2 className="land-h2">Everything a growing leader needs</h2>
        <div className="land-perks">
          {PERKS.map((p) => (
            <div key={p.title} className="land-perk">
              <div className="land-perk-icon">
                <p.icon size={20} />
              </div>
              <div className="land-perk-title">{p.title}</div>
              <div className="land-perk-desc">{p.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="land-section land-pricing" id="pricing">
        <div className="land-kicker">Membership</div>
        <h2 className="land-h2">Pick your level</h2>
        <div className="land-price-grid">
          <div className="land-price-card">
            <div className="land-price-name">Momentum+ User</div>
            <div className="land-price-amount">
              {basicPrice ?? "Join today"}
            </div>
            <ul className="land-price-list">
              <li>Live monthly sessions</li>
              <li>Full session library with AI takeaways</li>
              <li>Courses and CE certificates</li>
              <li>Private community and member offers</li>
            </ul>
            <Link href="/join?plan=basic" className="btn-gold land-cta">
              Join Momentum+
            </Link>
          </div>
          <div className="land-price-card best">
            <span className="pricing-best-tag">Most Access</span>
            <div className="land-price-name">Momentum+ Pro</div>
            <div className="land-price-amount">{proPrice ?? "Join today"}</div>
            <ul className="land-price-list">
              <li>Everything in Momentum+ User</li>
              <li>Pro-only sessions and recordings</li>
              <li>Pro-only courses and resources</li>
              <li>First access to new programs</li>
            </ul>
            <Link href="/join?plan=pro" className="btn-gold land-cta">
              Join Momentum+ Pro
            </Link>
          </div>
        </div>
        {!live && (
          <p className="land-price-note">
            Online signup is opening soon — reach out to the TSLS team and
            we&apos;ll reserve your spot.
          </p>
        )}
      </section>

      {/* Footer */}
      <footer className="land-footer">
        <div className="land-wordmark" style={{ fontSize: 20 }}>
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <div className="land-footer-note">
          A Tri-State Leadership Summit community · Sierra Learnership
          Collaborative
        </div>
        <Link href="/login" className="land-footer-login">
          Member Login
        </Link>
      </footer>
    </div>
  );
}
