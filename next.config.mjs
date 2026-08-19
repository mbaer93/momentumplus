/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No reason to name the framework and its version to a scanner.
  poweredByHeader: false,
  images: {
    // Uploaded assets (sponsor ads/logos, headshots, resource art) live in
    // Supabase Storage; video thumbnails come from Mux. next/image resizes
    // them per-device instead of shipping multi-MB originals to phones.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "image.mux.com" },
    ],
  },
  experimental: {
    serverActions: {
      // Sponsor logos, headshots and card art still arrive as FormData; the
      // default 1 MB rejects a phone photo before our own validation runs.
      //
      // This is NOT a ceiling we control. Vercel caps a serverless request
      // body at ~4.5 MB whatever this says, and enforces it before any of
      // our code executes — so a bigger number here is a promise the
      // platform breaks silently. Anything that can exceed it (session
      // resources, speaker attachments, lesson documents) now uploads
      // straight to Supabase Storage from the browser; see
      // lib/upload-client.ts. 5mb leaves headroom over the largest
      // remaining FormData path (4 MB) without claiming more than Vercel
      // will actually accept.
      bodySizeLimit: "5mb",
    },
  },
  async headers() {
    return [
      {
        // Baseline security headers (audit 2026-08-06 P1-10: external probe
        // confirmed none of these were sent). Safe everywhere.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera/microphone stay open to `self` on purpose: the live room
          // (components/sessions/LiveRoom.tsx) runs the Zoom Web SDK in this
          // page, so a blanket camera=() would take the video sessions down.
          // `self` still refuses both to any cross-origin frame we embed.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // Clickjacking protection for the whole app EXCEPT /start, which is
        // designed to be embedded on sierralearnership.com (both are SLC).
        source: "/((?!start$).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        // /start may be framed by the SLC site only (no X-Frame-Options —
        // it can't express an allow-list; CSP frame-ancestors does).
        source: "/start",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://sierralearnership.com https://*.sierralearnership.com",
          },
        ],
      },
      {
        // Cross-origin isolation on the live room ONLY: it unlocks
        // SharedArrayBuffer, which the Zoom Web SDK uses for its fast video
        // pipeline — without it decoding falls back to a much slower path
        // (choppy/lagging video, high CPU). COEP "credentialless" (instead
        // of "require-corp") keeps cross-origin images/assets on the page
        // working. Scoped to this route so the rest of the portal (Mux
        // player, Stream chat) is untouched.
        source: "/sessions/:id/live",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  // Next 16 builds with Turbopack by default, so the Zoom alias below has to
  // exist for both bundlers. Turbopack's resolveAlias can't map to `false`,
  // so it points at an empty stub module instead.
  turbopack: {
    resolveAlias: {
      "@zoom/download-manager": "./lib/empty-module.js",
    },
  },
  webpack: (config) => {
    // The Zoom Meeting SDK references an optional runtime module
    // (@zoom/download-manager) that isn't published to npm — it is only used
    // in code paths we don't hit. Alias it to an empty module so bundling
    // succeeds. jszip is installed as a real dependency for the SDK.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@zoom/download-manager": false,
    };
    return config;
  },
};

export default nextConfig;
