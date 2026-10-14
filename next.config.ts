import type { NextConfig } from "next";
import { writeFileSync } from "fs";
// Build id baked into the client and published at /version.json so open tabs can detect a newer deploy.
const BUILD = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12) || process.env.GITHUB_SHA?.slice(0, 12) || `b${Date.now().toString(36)}`;
try { writeFileSync("public/version.json", JSON.stringify({ build: BUILD, at: new Date().toISOString() })); } catch { /* read-only fs */ }
const nextConfig: NextConfig = { output: "export", trailingSlash: true, images: { unoptimized: true }, env: { NEXT_PUBLIC_BUILD_ID: BUILD } };
export default nextConfig;
