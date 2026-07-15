/* eslint-disable @next/next/no-img-element */
import { Wordmark } from "./Wordmark";
import type { SponsorItem } from "@/lib/directory-data";

/**
 * A sponsor's visual mark: the uploaded logo graphic when one exists. Without
 * a logo, preview placeholders show their mockup wordmark stand-in; real
 * sponsors show their name as a styled text mark (never demo art). Plain
 * <img> keeps external storage URLs out of next/image domain config.
 */
export function SponsorMark({
  name,
  logoUrl,
  wordmark,
  maxHeight = 48,
}: {
  name: string;
  logoUrl: string | null;
  wordmark: SponsorItem["wordmark"];
  maxHeight?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        style={{ maxHeight, maxWidth: "100%", objectFit: "contain" }}
      />
    );
  }
  if (wordmark) {
    return <Wordmark kind={wordmark} />;
  }
  return (
    <div className="wm">
      <div className="wm-main" style={{ fontSize: 13 }}>
        {name}
      </div>
    </div>
  );
}
