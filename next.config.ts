import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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