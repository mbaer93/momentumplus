import type { MetadataRoute } from "next";

/*
 * Installable on phones ("Add to Home Screen") — attendees get a real app
 * icon and a full-screen companion with no browser chrome. Icon PNGs still
 * need to be added under public/icons/ (see README); until then browsers
 * fall back to a screenshot/letter tile.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TSLS Summit Companion",
    short_name: "TSLS",
    description:
      "Your in-person companion for the Tri-State Leadership Summit — agenda, speakers, vendors, community, and your ticket.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B1622",
    theme_color: "#0B1622",
  };
}
