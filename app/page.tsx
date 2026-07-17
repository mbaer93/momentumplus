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
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Momentum+ | The Year-Round Leadership Community",
  description:
    "Live leadership sessions, a full session library, self-paced courses with certificates of completion, and a private community of leaders nationwide. By the team behind the Tri-State Leadership Summit.",
  alternates: { canonical: "/" },
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
    title: "Courses & Certificates",
    desc: "Self-paced learning tracks with lessons and tests, earning certificates of completion that show your educational hours.",
  },
  {
    icon: CommunityIcon,
    title: "Private Community",
    desc: "A members-only space to trade wins, questions, and introductions with leaders across the country.",
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

const HOW_IT_WORKS: { step: string; title: string; desc: string }[] = [
  {
    step: "1",
    title: "Join in two minutes",
    desc: "Pick your level, pay securely through Stripe, and your welcome email signs you straight into the portal.",
  },
  {
    step: "2",
    title: "Show up — live or later",
    desc: "Enroll in the monthly Zoom session with one click, add it to your calendar, and catch the recording with AI takeaways if life gets in the way.",
  },
  {
    step: "3",
    title: "Build your record",
    desc: "Work through courses, pass the tests, print your certificates — your profile tracks everything you've attended and earned.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Who is Momentum+ for?",
    a: "Leaders everywhere. Momentum+ was born at the Tri-State Leadership Summit and is now a national community — if you lead a team, a business, or an organization, wherever you are, you belong here.",
  },
  {
    q: "What exactly do I get each month?",
    a: "A live online session (via Zoom) with a featured speaker (plus Pro-only sessions on the Pro plan), the full recording library with AI-generated takeaways, self-paced courses, the private member community, and member-only tools and offers.",
  },
  {
    q: "What are the certificates?",
    a: "Courses award a certificate of completion showing the educational hours you put in, earned by finishing the lessons and passing the course tests. Whether a certificate counts toward a specific continuing-education requirement is determined by your employer, licensing body, or professional association.",
  },
  {
    q: "How does billing work? Can I cancel?",
    a: "Memberships renew automatically on the schedule you pick at checkout, and the price is always shown before you pay. You can cancel anytime from your profile's billing settings — you keep access through the end of the period you've paid for. Full details are in our Terms of Service.",
  },
  {
    q: "Do I have to attend live? Is anything in person?",
    a: "Everything in Momentum+ happens online — live sessions are on Zoom, so you can join from anywhere (the in-person experience is the annual summit itself). And you never have to attend live: every session is recorded and lands in the library with AI takeaways and action items, usually within a couple of days.",
  },
  {
    q: "What's the difference between Member and Pro?",
    a: "Momentum+ Member includes everything most leaders need: live sessions, the library, core courses, and the community. Pro adds Pro-only sessions and recordings, advanced course tracks, premium resources, and first access to new programs.",
  },
];

/** Next few scheduled session titles — real proof for the landing page. */
async function upcomingPublicSessions(): Promise<
  { id: string; title: string; when: string; speaker: string }[]
> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  try {
    const { data } = await createServiceClient()
      .from("sessions")
      .select("id, title, starts_at, speakers(name)")
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(3);
    return (data ?? []).map((row) => {
      const speakers = row.speakers as
        | { name: string }
        | { name: string }[]
        | null;
      const speaker = Array.isArray(speakers)
        ? speakers[0]?.name
        : speakers?.name;
      return {
        id: row.id as string,
        title: row.title as string,
        when: new Date(row.starts_at as string).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        }),
        speaker: speaker ?? "Featured speaker",
      };
    });
  } catch {
    return [];
  }
}

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
  const sessions = await upcomingPublicSessions();

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
          <a href="#faq">FAQ</a>
          <Link href="/login" className="land-login-btn">
            Member Login
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="land-hero">
        <div className="land-badge">
          From the team behind the Tri-State Leadership Summit
        </div>
        <h1>
          Leadership doesn&apos;t stop
          <br />
          when the summit ends.
        </h1>
        <p>
          Momentum+ is the year-round leadership community and learning
          platform — live monthly online sessions with nationally recognized
          speakers, a full recording library, self-paced courses with
          certificates, and a private community of leaders across the
          country. All from wherever you are.
        </p>
        <div className="land-hero-actions">
          <a href="#pricing" className="btn-gold land-cta">
            {live ? "Become a Member" : "See Membership"}
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

      {/* Proof: inside the portal */}
      <section className="land-section" id="inside">
        <div className="land-kicker">See what&apos;s inside</div>
        <h2 className="land-h2">A real platform, not a promise</h2>
        <div className="land-shots">
          {/* eslint-disable @next/next/no-img-element */}
          <figure className="land-shot wide">
            <img
              src="/marketing/portal-dashboard.png"
              alt="The Momentum+ member dashboard: upcoming sessions, learning record, and community activity"
              width={1440}
              height={900}
              loading="lazy"
            />
            <figcaption>
              Your dashboard — next session, learning record, and what the
              community is talking about.
            </figcaption>
          </figure>
          <figure className="land-shot">
            <img
              src="/marketing/portal-education.png"
              alt="Momentum+ courses with progress tracking on a phone"
              width={780}
              height={1688}
              loading="lazy"
            />
            <figcaption>Courses with progress and certificates.</figcaption>
          </figure>
          <figure className="land-shot">
            <img
              src="/marketing/portal-community.png"
              alt="The private Momentum+ member community on a phone"
              width={780}
              height={1688}
              loading="lazy"
            />
            <figcaption>The private community — on any device.</figcaption>
          </figure>
          {/* eslint-enable @next/next/no-img-element */}
        </div>
      </section>

      {/* Proof: upcoming sessions (renders only when there are some) */}
      {sessions.length > 0 && (
        <section className="land-section land-upcoming">
          <div className="land-kicker">On the calendar</div>
          <h2 className="land-h2">Upcoming live sessions</h2>
          <div className="land-sessions">
            {sessions.map((s) => (
              <div key={s.id} className="land-session">
                <div className="land-session-when">{s.when} ET</div>
                <div className="land-session-title">{s.title}</div>
                <div className="land-session-speaker">with {s.speaker}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="land-section" id="how">
        <div className="land-kicker">How it works</div>
        <h2 className="land-h2">From signup to certificate</h2>
        <div className="land-steps">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="land-step">
              <div className="land-step-num">{s.step}</div>
              <div className="land-perk-title">{s.title}</div>
              <div className="land-perk-desc">{s.desc}</div>
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
            <div className="land-price-name">Momentum+ Member</div>
            <div className="land-price-amount">
              {basicPrice ? `$${basicPrice}/mo` : "Membership"}
            </div>
            <ul className="land-price-list">
              <li>Live monthly leadership session (online, via Zoom)</li>
              <li>Full recording library with AI takeaways</li>
              <li>Core courses with certificates of completion</li>
              <li>Private member community</li>
              <li>Member tools, resources, and offers</li>
            </ul>
            {live ? (
              <Link href="/join?plan=basic" className="btn-gold land-cta">
                Join Momentum+
              </Link>
            ) : (
              <a
                className="btn-gold land-cta"
                href="mailto:hello@momentumplus.co?subject=Reserve%20my%20Momentum%2B%20membership"
              >
                Reserve my spot
              </a>
            )}
          </div>
          <div className="land-price-card best">
            <span className="pricing-best-tag">Most Access</span>
            <div className="land-price-name">Momentum+ Pro</div>
            <div className="land-price-amount">
              {proPrice ? `$${proPrice}/mo` : "Membership"}
            </div>
            <ul className="land-price-list">
              <li>Everything in Momentum+ Member</li>
              <li>Pro-only live sessions and workshops</li>
              <li>Pro-only recordings in the library</li>
              <li>Advanced course tracks and premium resources</li>
              <li>First access to new programs</li>
            </ul>
            {live ? (
              <Link href="/join?plan=pro" className="btn-gold land-cta">
                Join Momentum+ Pro
              </Link>
            ) : (
              <a
                className="btn-gold land-cta"
                href="mailto:hello@momentumplus.co?subject=Reserve%20my%20Momentum%2B%20Pro%20membership"
              >
                Reserve my spot
              </a>
            )}
          </div>
        </div>
        {live ? (
          <p className="land-price-note">
            Memberships renew automatically; cancel anytime from your profile.
            See the{" "}
            <Link href="/terms" style={{ color: "var(--gold)" }}>
              Terms of Service
            </Link>{" "}
            for billing and refund details.
          </p>
        ) : (
          <p className="land-price-note">
            Online signup is opening soon — reserve your spot and we&apos;ll
            email you the moment it&apos;s live.
          </p>
        )}
      </section>

      {/* FAQ */}
      <section className="land-section" id="faq">
        <div className="land-kicker">Questions</div>
        <h2 className="land-h2">Frequently asked</h2>
        <div className="land-faq">
          {FAQS.map((f) => (
            <details key={f.q} className="land-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="land-section land-final-cta">
        <h2 className="land-h2">Start building momentum</h2>
        <div className="land-hero-actions">
          <a href="#pricing" className="btn-gold land-cta">
            {live ? "Become a Member" : "Reserve My Spot"}
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="land-footer">
        <div className="land-wordmark" style={{ fontSize: 20 }}>
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <div className="land-footer-note">
          From the team behind the Tri-State Leadership Summit · Sierra
          Learnership Collaborative
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Link href="/terms" className="land-footer-login">
            Terms
          </Link>
          <Link href="/privacy" className="land-footer-login">
            Privacy
          </Link>
          <Link href="/login" className="land-footer-login">
            Member Login
          </Link>
        </div>
      </footer>
    </div>
  );
}
