import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is exposed through a cloudflared quick tunnel for office
  // access; Next blocks cross-origin dev requests by default, which left the
  // page stuck on its loading spinner when opened via the tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
