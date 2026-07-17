import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";

/*
 * Crawlers may index the public marketing/legal pages; the member portal,
 * auth flows, and APIs are private and excluded.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/join", "/privacy", "/terms", "/login"],
        disallow: [
          "/api/",
          "/auth/",
          "/dashboard",
          "/sessions",
          "/library",
          "/education",
          "/community",
          "/speakers",
          "/resources",
          "/sponsors",
          "/calendar",
          "/profile",
          "/admin",
          "/welcome",
          "/expired",
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
