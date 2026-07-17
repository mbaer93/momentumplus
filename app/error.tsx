"use client";

/*
 * Route-level error boundary — a transient Supabase/network failure used to
 * surface Next's unbranded "Application error" screen with no way forward.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-screen">
      <div className="error-card">
        <div className="error-logo">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <h1>Something hiccuped</h1>
        <p>
          That page didn&apos;t load — usually a brief connection blip, not
          anything you did. Your data is safe.
        </p>
        <div className="error-actions">
          <button type="button" className="btn-gold" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn-ghost" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
