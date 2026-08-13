/**
 * End-to-end smoke test against the real production build.
 *
 * Unit tests prove the rules and the AI are correct; this proves the thing
 * actually boots, renders and can be played with a finger. It drives the
 * canvas by tapping real pixel coordinates, exactly as a player would.
 *
 * Run: node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('dist');
const PORT = 4317;
const SHOTS = resolve('.smoke');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let path = join(DIST, decodeURIComponent(url.pathname));
      if (url.pathname === '/' || !existsSync(path)) path = join(DIST, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

/** True if the canvas is not a flat single colour, i.e. something was drawn. */
async function canvasHasContent(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.board-canvas');
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      if (seen.size > 24) break;
    }
    return { ok: seen.size > 12, colours: seen.size };
  });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = await serve();
  // Prefer the preinstalled browser; fall back to whatever Playwright resolves.
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  console.log('\n1. Boot');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  check('page boots without errors', errors.length === 0, errors.join(' | '));
  check('loading veil removed', !(await page.evaluate(() => document.body.classList.contains('loading'))));
  check('canvas present', (await page.locator('canvas.board-canvas').count()) === 1);

  const drawn = await canvasHasContent(page);
  check('board renders real pixels', drawn.ok, `distinct colours: ${drawn.colours}`);
  await page.screenshot({ path: join(SHOTS, '01-first-run.png') });

  console.log('\n2. First run drops into the tutorial match');
  check('HUD is present', (await page.locator('.hud').count()) === 1);
  check('a number is queued to place', (await page.locator('.number-chip').textContent()) === '1');

  console.log('\n3. Play a full match by tapping the board');
  const box = await page.locator('canvas.board-canvas').boundingBox();
  // Cell centres in the same normalised layout the renderer uses.
  const size = Math.min(box.width * 0.92, box.height * 0.66);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.44;
  const cellPoint = (row, col) => ({
    x: cx + (0.5 - row / 12 + col / 6 - 0.5) * size,
    y: cy + (1 / 12 + row / 6 - 0.5) * size * 0.94,
  });

  // Taps on an occupied cell, or during the opponent's turn, are correctly
  // ignored — so sweep the whole pyramid repeatedly rather than assuming a
  // click lands. This also exercises the reject path a real player will hit.
  const cells = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col <= row; col++) cells.push(cellPoint(row, col));
  }

  let clicks = 0;
  for (let pass = 0; pass < 14; pass++) {
    if (await page.locator('.results').count()) break;
    for (const { x, y } of cells) {
      if (await page.locator('.results').count()) break;
      // Only tap while it is actually our turn; otherwise wait for the AI.
      const ready = await page.evaluate(() => {
        const label = document.querySelector('.turn-label');
        return Boolean(label && !label.classList.contains('is-waiting'));
      });
      if (!ready) {
        await page.waitForTimeout(250);
        continue;
      }
      await page.mouse.click(x, y);
      clicks++;
      await page.waitForTimeout(260);
    }
  }
  check('taps were accepted by the board', clicks > 0);

  console.log('\n4. Match resolves and the results screen appears');
  await page.waitForSelector('.results', { timeout: 45000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(SHOTS, '02-results.png') });

  const title = (await page.locator('.results-title').textContent())?.trim();
  check('a result was declared', ['Victory', 'Defeat', 'Dead heat'].includes(title), `got "${title}"`);
  check('scoreboard shows both scores', (await page.locator('.score-value').count()) === 2);
  check('reward breakdown is shown', (await page.locator('.reward-row').count()) > 0);

  const xpText = (await page.locator('.reward-xp').textContent()) ?? '';
  check('xp was awarded', /\+\s*\d+/.test(xpText), `got "${xpText}"`);

  console.log('\n5. Progress persists across a reload');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('bhp.profile.v1') ?? '{}'));
  check('profile saved to storage', typeof before.totalXp === 'number' && before.totalXp > 0,
    `totalXp=${before.totalXp}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('bhp.profile.v1') ?? '{}'));
  check('xp survived the reload', after.totalXp === before.totalXp);
  check('returning player lands on the menu', (await page.locator('.menu').count()) === 1);
  await page.screenshot({ path: join(SHOTS, '03-menu.png') });

  console.log('\n6. Menu navigation');
  check('every mode is listed', (await page.locator('.mode-card').count()) === 7);
  check('difficulty picker present', (await page.locator('.difficulty-pill').count()) === 4);

  await page.locator('button:has-text("Collection")').click();
  await page.waitForTimeout(600);
  check('collection opens', (await page.locator('.collection').count()) === 1);
  check('cosmetics are listed', (await page.locator('.cosmetic-card').count()) > 4);
  check('cosmetic previews rendered', (await page.locator('canvas.card-preview').count()) > 4);
  await page.screenshot({ path: join(SHOTS, '04-collection.png') });

  for (const [tab, selector] of [
    ['Charges', '.charge-card'],
    ['Quests', '.quest-row'],
    ['Achievements', '.achievement-row'],
    ['Stats', '.stat-list'],
  ]) {
    await page.locator(`.tab:has-text("${tab}")`).click();
    await page.waitForTimeout(320);
    check(`${tab} tab renders`, (await page.locator(selector).count()) > 0);
  }
  await page.screenshot({ path: join(SHOTS, '05-achievements.png') });

  console.log('\n7. Modes gate correctly on level');
  await page.locator('.btn-icon').first().click();
  await page.waitForTimeout(500);
  const cosmicLocked = await page.locator('.mode-card:has-text("Cosmic")').isDisabled();
  check('Cosmic is locked for a level 1 player', cosmicLocked);

  // Seed enough XP to clear the level gates, the way a returning player would
  // arrive, then verify the mode opens up.
  await page.evaluate(() => {
    const key = 'bhp.profile.v1';
    const profile = JSON.parse(localStorage.getItem(key) ?? '{}');
    profile.totalXp = 20000;
    localStorage.setItem(key, JSON.stringify(profile));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check('Cosmic unlocks once levelled', !(await page.locator('.mode-card:has-text("Cosmic")').isDisabled()));

  console.log('\n8. Cosmic match: modifiers and charges');
  await page.locator('.mode-card:has-text("Cosmic")').click();
  await page.waitForTimeout(900);
  check('cosmic match starts', (await page.locator('.hud').count()) === 1);
  check('modifiers are shown', (await page.locator('.chip').count()) >= 1);
  check('charges are offered', (await page.locator('.charge').count()) === 2);
  await page.screenshot({ path: join(SHOTS, '06-cosmic.png') });

  console.log('\n9. Landscape / desktop viewport');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(600);
  const wide = await canvasHasContent(page);
  check('renders after resize', wide.ok, `distinct colours: ${wide.colours}`);
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > window.innerWidth + 1,
    y: document.documentElement.scrollHeight > window.innerHeight + 1,
  }));
  check('no page-level overflow', !overflow.x && !overflow.y, JSON.stringify(overflow));
  await page.screenshot({ path: join(SHOTS, '07-landscape.png') });

  check('no runtime errors during the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  server.close();

  console.log(`\n${failures.length === 0 ? 'ALL SMOKE CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
