import type { SponsorItem } from "@/lib/directory-data";

/*
 * Styled text stand-ins for sponsor logos (per the mockup) until real logo
 * files are uploaded to storage. Stroke/typography only — no images needed.
 */
export function Wordmark({
  kind,
}: {
  kind: NonNullable<SponsorItem["wordmark"]>;
}) {
  switch (kind) {
    case "newstalk":
      return (
        <div className="wm">
          <div className="wm-newstalk-top">NewsTalk</div>
          <div className="wm-newstalk-num">103.7</div>
        </div>
      );
    case "bank":
      return (
        <div className="wm">
          <div className="wm-main" style={{ fontSize: 13 }}>
            Cumberland Valley
          </div>
          <div className="wm-sub">Bank · Est. 1924</div>
        </div>
      );
    case "summit":
      return (
        <div className="wm">
          <div className="wm-tri" />
          <div className="wm-main">Summit</div>
          <div className="wm-sub">Growth Partners</div>
        </div>
      );
    case "clarity":
      return (
        <div className="wm">
          <div className="wm-sans">Clarity</div>
          <div className="wm-sub" style={{ color: "var(--accent-blue)" }}>
            HR Solutions
          </div>
        </div>
      );
    case "wellness":
      return (
        <div className="wm">
          <div
            className="wm-main wm-italic"
            style={{ color: "var(--accent-green)", fontSize: 14 }}
          >
            Peak Wellness
          </div>
          <div className="wm-sub" style={{ color: "var(--accent-green)" }}>
            Collective
          </div>
        </div>
      );
    case "photo":
      return (
        <div className="wm">
          <div className="wm-main">Demple</div>
          <div className="wm-sub" style={{ color: "var(--mid-gray)" }}>
            Photography
          </div>
        </div>
      );
  }
}
