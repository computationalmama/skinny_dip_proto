/**
 * Bundles seeds/app.jsx (React + React Flow) into static/seeds.js and
 * static/seeds.css, which seeds.html loads.
 *
 * Bundled rather than pulled from a CDN so the page works offline and doesn't
 * depend on a CDN resolving React Flow's transitive versions correctly.
 *
 * @xyflow/react is pinned to an exact 12.11.2 in package.json: 12.11.3 and
 * 12.11.4 import `handleAttributionWarning` from @xyflow/system@0.0.80, which
 * doesn't export it, so they fail to bundle. Don't loosen it to a caret range
 * without checking that upstream has published the matching system release.
 *
 * Usage: npm run build:seeds  (add --watch to rebuild on save)
 */

import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(__dirname, 'app.jsx')],
  outfile: path.join(__dirname, '../static/seeds.js'),
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching seeds/app.jsx…');
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    console.log(`${path.relative(process.cwd(), file)}  ${(meta.bytes / 1024).toFixed(1)} kB`);
  }
}
