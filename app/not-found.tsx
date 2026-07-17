import Link from "next/link";

/*
 * Branded 404 — stale links (an old session email, a deleted recording)
 * used to hit Next's default black-and-white page with no way back, which
 * is especially jarring inside the installed app where there's no URL bar.
 */
export default function NotFound() {
  return (
    <div className="error-screen">
      <div className="error-card">
        <div className="error-logo">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <h1>That page isn&apos;t here</h1>
        <p>
          The link may be old, or the content may have been moved or removed.
        </p>
        <div className="error-actions">
          <Link className="btn-gold" href="/dashboard">
            Go to dashboard
          </Link>
          <Link className="btn-ghost" href="/sessions">
            Browse sessions
          </Link>
        </div>
      </div>
    </div>
  );
}
