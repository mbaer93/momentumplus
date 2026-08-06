/* App Store / Google Play badge buttons, drawn in code so no external
   artwork is needed. Renders nothing until the listing URL is set in the
   admin box on /start. */

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
      <path d="M99.6 21.1c-8.2 4.7-13.6 13.4-13.6 24.1v421.6c0 10.7 5.4 19.4 13.6 24.1l238.6-234.9L99.6 21.1zm272.9 200.9-56.5 55.6 56.5 55.6 69.6-40.1c19.9-11.5 19.9-19.6 0-31.1l-69.6-39.9zm-25.1-14.5L134.2 79.9l186.4 183.5 26.8-26.4-.1-29.5zm-186.4 224.6 213.2-127.6-26.8-26.4-186.4 154z" />
    </svg>
  );
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  background: "#000",
  color: "#fff",
  borderRadius: 8,
  border: "1px solid #3a3a3a",
  padding: "7px 14px",
  textDecoration: "none",
  lineHeight: 1.15,
};

function Badge({
  href,
  glyph,
  small,
  big,
}: {
  href: string;
  glyph: React.ReactNode;
  small: string;
  big: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={badgeStyle}>
      {glyph}
      <span style={{ textAlign: "left" }}>
        <span style={{ display: "block", fontSize: 9, letterSpacing: 0.4 }}>
          {small}
        </span>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>
          {big}
        </span>
      </span>
    </a>
  );
}

export function StoreBadges({
  appStoreUrl,
  playUrl,
}: {
  appStoreUrl: string;
  playUrl: string;
}) {
  if (!appStoreUrl && !playUrl) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        justifyContent: "center",
        flexWrap: "wrap",
        marginTop: 12,
      }}
    >
      {appStoreUrl && (
        <Badge
          href={appStoreUrl}
          glyph={<AppleGlyph />}
          small="Download on the"
          big="App Store"
        />
      )}
      {playUrl && (
        <Badge
          href={playUrl}
          glyph={<PlayGlyph />}
          small="GET IT ON"
          big="Google Play"
        />
      )}
    </div>
  );
}
