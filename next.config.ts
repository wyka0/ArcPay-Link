import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon; keep it as a runtime require instead of
  // bundling it into the server build.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
