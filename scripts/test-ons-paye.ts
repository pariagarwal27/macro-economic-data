import { fetchOnsPayeEmploymentChange } from "../src/ingest/ons-paye-rti";

async function main() {
  const pts = await fetchOnsPayeEmploymentChange();
  console.log("count", pts.length);
  console.log("latest", pts.slice(-6));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
