/**
 * Produces a single self-contained HTML file containing the whole game.
 *
 * Useful for sharing a playable link with people who cannot run a dev server:
 * no install, no build step, no server — one file that runs from anywhere.
 *
 * Run: node scripts/build-singlefile.mjs   (after `VITE_SINGLE_FILE=1 vite build`)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DIST = resolve('dist');
const OUT = resolve('dist-single/black-hole-pyramid.html');

const assets = await readdir(join(DIST, 'assets'));
const jsName = assets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));

if (!jsName || !cssName) {
  throw new Error(`could not find built assets in ${DIST}/assets: ${assets.join(', ')}`);
}

const js = await readFile(join(DIST, 'assets', jsName), 'utf8');
const css = await readFile(join(DIST, 'assets', cssName), 'utf8');

// The artifact host wraps the file in its own <!doctype>/<head>/<body>, so this
// emits page *content* only: a title, inline styles, the mount point, and the
// bundle as an inline module.
const html = `<title>Black Hole Pyramid</title>
<style>
/* The host page supplies its own reset; the game needs the viewport to itself. */
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #05060f; }
#app { position: fixed; inset: 0; }
${css}
</style>

<div id="app" class="app-root"></div>

<script type="module">
${js}
</script>
`;

await writeFile(OUT, html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`wrote ${OUT}`);
console.log(`  js  ${kb(js.length)}`);
console.log(`  css ${kb(css.length)}`);
console.log(`  total ${kb(html.length)}`);
