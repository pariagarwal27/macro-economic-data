import assert from "node:assert/strict";
import { publicApiCacheMaxAge } from "../src/lib/worker-cache-policy.ts";

assert.equal(publicApiCacheMaxAge(new Response("calendar", { headers: { "Cache-Control": "no-store" } }), true), null);
assert.equal(publicApiCacheMaxAge(new Response("data", { headers: { "Cache-Control": "public, max-age=0" } }), true), 300);
assert.equal(publicApiCacheMaxAge(new Response("data"), false), 1800);
console.log("worker cache policy checks passed");
