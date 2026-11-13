# Local Investing.com consensus refresh

The dashboard, database, and refresh workers run locally. `npm run dev` starts the Next.js dashboard, release worker, and calendar worker. The calendar worker checks the consensus refresh schedule and invokes `scripts/refresh-free-consensus.ts`; successful forecasts are written to the local database for the dashboard to display.

The collector uses Playwright to read the public economic calendar, set London time and current-day filters, and extract forecast cells. It does not use a hosted collector, edge worker, remote database binding, or Cloudflare schedule.

The live fetch has not succeeded in this environment: on Nov 13, 2026, Investing.com returned HTTP 403 to both the local Playwright collector and the separate GitHub MCP method. The refresh avoids writing blocked or incomplete results, so new consensus values will not appear until Investing.com accepts the source request.
