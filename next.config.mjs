/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      // Sponsor logo/ad uploads go through a server action as FormData; the
      // default 1 MB body limit rejected anything bigger before our own
      // 2 MB validation could run.
      bodySizeLimit: "21mb",
    },
  },
  async headers() {
    return [
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
