/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
