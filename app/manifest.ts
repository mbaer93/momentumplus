import type { MetadataRoute } from "next";

/*
 * Web app manifest — makes Momentum+ installable on phones ("Add to Home
 * Screen" on iOS, install prompt on Android/Chrome). Members get a real app
 * icon and a full-screen portal with no browser chrome. Served at
 * /manifest.webmanifest and linked automatically by Next.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Momentum+ | Premium Member Portal",
    short_name: "Momentum+",
    description:
      "The members-only community and learning platform for the Tri-State Leadership Summit.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B1622",
    theme_color: "#0B1622",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
