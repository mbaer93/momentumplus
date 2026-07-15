/* eslint-disable @next/next/no-img-element */
import { Wordmark } from "./Wordmark";
import type { SponsorItem } from "@/lib/directory-data";

/**
 * A sponsor's visual mark: the uploaded logo graphic when one exists,
 * otherwise the styled text wordmark stand-in. Plain <img> keeps external
 * storage URLs out of next/image domain config.
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
  return <Wordmark kind={wordmark} />;
}
