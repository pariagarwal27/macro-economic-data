import fs from "fs";
import path from "path";
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.investing.com/economic-calendar/", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(4000);
  for (const label of ["Accept All", "I Agree", "Accept"]) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")]
      .map((b) => (b.textContent || "").trim())
      .filter(Boolean);
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      value: (i as HTMLInputElement).value,
      class: i.className?.toString?.().slice(0, 100),
    }));
    return { buttons: buttons.slice(0, 40), inputs };
  });

  const outDir = path.join(process.cwd(), "data", "investing");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "debug-dom.json"), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(outDir, "debug-calendar.png"), fullPage: true });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
