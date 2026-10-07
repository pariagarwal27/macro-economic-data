import { fetchEurostatSeries } from "../src/ingest/eurostat";

async function main() {
  console.log("Testing ei_isrr_m with EA21...");
  try {
    const points21 = await fetchEurostatSeries("ei_isrr_m", {
      geo: "EA21",
      unit: "RT12-CA",
      nace_r2: "G47",
      indic_bt: "VOL_SLS",
    });
    console.log("EA21 points count:", points21.length, "latest:", points21.slice(-3));
  } catch (e) {
    console.error("EA21 error:", e);
  }

  console.log("Testing ei_isrr_m with EA20...");
  try {
    const points20 = await fetchEurostatSeries("ei_isrr_m", {
      geo: "EA20",
      unit: "RT12-CA",
      nace_r2: "G47",
      indic_bt: "VOL_SLS",
    });
    console.log("EA20 points count:", points20.length, "latest:", points20.slice(-3));
  } catch (e) {
    console.error("EA20 error:", e);
  }
}

main().catch(console.error);
