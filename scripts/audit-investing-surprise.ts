/**
 * Read-only: compare Investing calendar prints to official observations.
 * Writes reports under data/investing/surprise/ — never mutates month dumps or calendar_events.
 */
import "dotenv/config";
import { ensureSchema } from "../src/ingest/pipeline";
import {
  runSurpriseAudit,
  writeSurpriseAuditArtifacts,
} from "../src/ingest/investing-surprise-audit";

async function main() {
  await ensureSchema();
  const since = process.argv[2] || undefined;
  console.log("Running Investing surprise audit (read-only)…");
  const report = await runSurpriseAudit(since ? { since } : undefined);
  const paths = writeSurpriseAuditArtifacts(report);

  console.log(
    JSON.stringify(
      {
        since: report.since,
        rows: report.rows.length,
        allow: report.allowlistSuggested,
        review: report.reviewSuggested,
        deny: report.denylistSuggested,
        wrote: paths,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
