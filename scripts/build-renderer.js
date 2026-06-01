'use strict';

/**
 * Bundles the React renderer (separate .jsx components + React) into a single
 * self-contained IIFE with esbuild. No webpack, no CDN, works fully offline.
 *
 *   node scripts/build-renderer.js          one-off build
 *   node scripts/build-renderer.js --watch  rebuild on change
 */

const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const options = {
  entryPoints: [path.join(ROOT, 'electron', 'renderer', 'index.js')],
  outfile: path.join(ROOT, 'electron', 'renderer', 'dist', 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome114'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[build-renderer] watching for changes…');
  } else {
    await esbuild.build(options);
    console.log('[build-renderer] bundle written to electron/renderer/dist/bundle.js');
  }
})().catch((err) => {
  console.error('[build-renderer] failed:', err.message);
  process.exit(1);
});
