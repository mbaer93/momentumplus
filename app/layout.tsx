import type { Metadata, Viewport } from "next";
// Fonts are self-hosted (app/fonts.css). next/font/google downloaded them
// from Google at BUILD time, which put an outside service on the critical
// path of every build and every deploy.
import "./fonts.css";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Momentum+ | Premium Member Portal",
  description:
    "The members-only, year-round leadership community and learning platform.",
  openGraph: {
    type: "website",
    siteName: "Momentum+",
    title: "Momentum+ | The Year-Round Leadership Community",
    description:
      "Live leadership sessions, a full recording library, courses with certificates, and a private community of leaders nationwide.",
    url: SITE,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Momentum+" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Momentum+ | The Year-Round Leadership Community",
    description:
      "Live leadership sessions, a full recording library, courses with certificates, and a private community of leaders nationwide.",
    images: ["/og.png"],
  },
  // Installed-app behavior on iOS: opens full-screen from the home-screen
  // icon instead of in Safari. Android/Chrome reads the same from the
  // manifest (app/manifest.ts).
  appleWebApp: {
    capable: true,
    title: "Momentum+",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1622",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* The two faces above the fold on every page. Preloaded because a
            hand-written @font-face is only discovered after the CSS parses,
            where next/font used to inject the hint for us. latin-ext is
            deliberately NOT preloaded — most pages never need it. */}
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/playfair-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
