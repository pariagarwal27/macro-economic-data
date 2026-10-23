import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // Keep the Turbopack dev output separate from the Webpack production build.
  // Sharing .next lets stale server chunks from one compiler leak into the other.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  // Keep Turbopack scoped to this app. A second lockfile exists in the parent
  // Downloads directory, so automatic workspace-root detection picks the
  // wrong directory when this project is started locally.
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: [
    "@libsql/client",
    "@libsql/isomorphic-ws",
  ],
  outputFileTracingIncludes: {
  "/*": [
    "./node_modules/@libsql/isomorphic-ws/web.mjs",
    "./node_modules/@libsql/isomorphic-ws/web.cjs",
    "./node_modules/@libsql/isomorphic-ws/package.json"
  ]
}
});

export default nextConfig;
