# Free survey consensus

The release diary fetches economic calendar events and consensus forecasts from the public ShowMyTrades calendar endpoint. No provider API key is needed. The current event mapping covers matching US, UK, and Euro Area metrics; events without an unambiguous metric match stay blank. Euro Area rows tagged with an individual country are excluded.

The production worker refreshes the feed daily at 05:23 UTC. The local calendar worker also refreshes it once daily; run `npm run refresh:free-consensus` for a manual refresh. The sidebar only displays forecasts imported in the last 48 hours.

The endpoint may return an event without a consensus. Those cells remain blank until a forecast is published. Review the provider's terms before exposing the feed beyond this dashboard.
