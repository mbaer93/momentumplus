import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

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
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
