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

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.thetsls.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "TSLS Summit Companion",
  description:
    "Your in-person companion for the Tri-State Leadership Summit — agenda, speakers, vendors, community, and your ticket.",
  // Installed-app behavior on iOS: opens full-screen from the home-screen
  // icon instead of in Safari.
  appleWebApp: {
    capable: true,
    title: "TSLS Summit",
    statusBarStyle: "black-translucent",
  },
  robots: { index: false, follow: false }, // members-only companion
};

export const viewport: Viewport = {
  themeColor: "#0B1622",
  width: "device-width",
  initialScale: 1,
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
