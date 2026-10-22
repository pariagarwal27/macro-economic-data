import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
