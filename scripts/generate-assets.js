'use strict';

/**
 * Generates packaging assets with sharp:
 *   build/icon.png            (1024x1024 app icon — electron-builder makes .icns/.ico from it)
 *   build/dmg-background.png   (540x380 dmg backdrop)
 *   build/dmg-background@2x.png(1080x760 retina backdrop)
 *
 * A saffron circle with "MT" on a dark tile — matches the app's devotional feel.
 * Run via `npm run generate-assets`. The PNGs are committed so packaging never
 * depends on sharp being present at build time.
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');

const ICON_SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#242424"/>
      <stop offset="1" stop-color="#0e0e0e"/>
    </linearGradient>
    <radialGradient id="saf" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#FFB74D"/>
      <stop offset="0.55" stop-color="#FF9800"/>
      <stop offset="1" stop-color="#E65100"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <rect x="8" y="8" width="1008" height="1008" rx="216" fill="none" stroke="#FF980033" stroke-width="6"/>
  <circle cx="512" cy="512" r="332" fill="url(#saf)"/>
  <text x="512" y="624" font-family="Arial, Helvetica, sans-serif" font-size="320" font-weight="900"
        fill="#181818" text-anchor="middle">MT</text>
</svg>`;

function dmgSvg(w, h) {
  const cx = w / 2;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#202020"/>
      <stop offset="1" stop-color="#121212"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <circle cx="${cx}" cy="62" r="22" fill="#FF9800"/>
  <text x="${cx}" y="70" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="#181818" text-anchor="middle">MT</text>
  <text x="${cx}" y="118" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff" text-anchor="middle">Morari Translate</text>
  <text x="${cx}" y="146" font-family="Arial, sans-serif" font-size="13" fill="#888888" text-anchor="middle">Drag the app onto the Applications folder to install</text>
  <g stroke="#FF9800" stroke-width="3" fill="none" opacity="0.8">
    <line x1="${cx - 40}" y1="210" x2="${cx + 40}" y2="210"/>
    <polyline points="${cx + 22},196 ${cx + 42},210 ${cx + 22},224"/>
  </g>
</svg>`;
}

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.error('[generate-assets] sharp is not installed. Run `npm install` first.');
    process.exit(1);
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });

  await sharp(Buffer.from(ICON_SVG)).png().toFile(path.join(BUILD_DIR, 'icon.png'));
  console.log('[generate-assets] wrote build/icon.png (1024x1024)');

  await sharp(Buffer.from(dmgSvg(540, 380))).png().toFile(path.join(BUILD_DIR, 'dmg-background.png'));
  console.log('[generate-assets] wrote build/dmg-background.png (540x380)');

  await sharp(Buffer.from(dmgSvg(1080, 760))).png().toFile(path.join(BUILD_DIR, 'dmg-background@2x.png'));
  console.log('[generate-assets] wrote build/dmg-background@2x.png (1080x760)');
}

main().catch((err) => {
  console.error('[generate-assets] failed:', err);
  process.exit(1);
});
