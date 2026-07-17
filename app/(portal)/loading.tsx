/*
 * Route-level loading skeleton for every portal page. Before this existed,
 * clicking a sidebar link froze the old page until the whole RSC payload
 * arrived — the single biggest perceived-slowness issue on mobile.
 */
export default function PortalLoading() {
  return (
    <div className="dash-pad">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-sub" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-block" />
    </div>
  );
}
