import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise actual page navigation after long in-place disclosures.
export default async function verifyNavigation({ taskSpace, spaceId = 2 }) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sample = pathToFileURL(resolve(root, "docs/examples/forecastcompass/reading-flow-pilot.html")).href;
  const task = await taskSpace(spaceId);
  const page = task.page("p1");
  const cases = [];
  const check = (name, pass, details) => cases.push({ name, pass: Boolean(pass), details });
  const current = () => page.evaluate(() => document.querySelector('[aria-current="step"]')?.dataset.navId);
  const expectCurrent = async id => {
    try {
      await page.waitForFunction(expected => document.querySelector('[aria-current="step"]')?.dataset.navId === expected, id, { timeout: 2500 });
      return true;
    } catch { return false; }
  };

  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(sample);
  await page.waitForSelector("#step-update");
  for (const id of ["update", "two-memories", "evidence", "probability", "reproduction", "inference", "signal-confidence", "memory-problem"]) {
    await page.click(`[data-nav-id="${id}"]`);
    check(`Outline follows jump to ${id}`, await expectCurrent(id), { actual: await current() });
  }
  await page.click('[data-nav-id="evidence"]');
  await page.click('#research-evidence > summary');
  await page.selectOption('#ablation-metric', 'ece');
  await page.evaluate(() => document.getElementById('ablation-metric').scrollIntoView({ block: 'center', behavior: 'instant' }));
  check("Deep expanded evidence retains its active step", await expectCurrent('evidence'), { actual: await current() });
  await page.screenshot({ path: resolve(root, "docs/evidence/reading-flow-evidence-20261003.png") });
  await page.click('#research-evidence > summary');
  check("Collapsing evidence resynchronizes the outline", await expectCurrent('evidence'), { actual: await current() });

  for (const width of [900, 390]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 760 });
    await page.click('[data-nav-id="update"]');
    check(`Outline follows responsive jump at ${width}`, await expectCurrent('update'), { actual: await current() });
  }
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.click('[data-nav-id="two-memories"]');
  await page.evaluate(() => window.scrollBy(0, 90));
  check("Desktop restoration follows the visible memory step", await expectCurrent('two-memories'), { actual: await current() });
  await page.screenshot({ path: resolve(root, "docs/evidence/reading-flow-memory-20261003.png") });

  await page.cdp("Emulation.clearDeviceMetricsOverride");
  await page.goto(sample);
  const result = { date: "2026-10-03", passed: cases.filter(c => c.pass).length, total: cases.length, cases, limitation: "验证目录状态与浏览器操作，不证明真人理解。" };
  await writeFile(resolve(root, "docs/evidence/reading-flow-navigation-acceptance-20261003.json"), JSON.stringify(result, null, 2));
  return result;
}
