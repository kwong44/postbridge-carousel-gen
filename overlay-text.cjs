#!/usr/bin/env node
// overlay-text.cjs — composite centered text onto an image
// Usage: node overlay-text.cjs <input.jpg> "Label text" <output.jpg>

'use strict';

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Register handwriting font if available
const FONT_PATH = path.join(__dirname, 'fonts', 'Caveat-Bold.ttf');
const HANDWRITING_FONT = fs.existsSync(FONT_PATH)
  ? (GlobalFonts.registerFromPath(FONT_PATH, 'Caveat'), 'Caveat')
  : 'sans-serif';

function getFontFamily() {
  const style = (process.env.OVERLAY_FONT || 'handwritten').trim().toLowerCase();
  if (style === 'sans') return 'Arial';
  if (style === 'serif') return 'Georgia';
  return HANDWRITING_FONT;
}

function getTextAlign() {
  const align = (process.env.OVERLAY_ALIGN || 'center').trim().toLowerCase();
  return ['left', 'center', 'right'].includes(align) ? align : 'center';
}

function getTextScale() {
  const scale = Number.parseFloat(process.env.OVERLAY_SCALE || '1');
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1.2, Math.max(0.6, scale));
}

async function run() {
  const [,, inputPath, text, outputPath] = process.argv;

  if (!inputPath || !text || !outputPath) {
    console.error('Usage: node overlay-text.cjs <input.jpg> "text" <output.jpg>');
    process.exit(1);
  }

  // Strip emoji and unsupported Unicode (keeps ASCII + basic Latin extended)
  const sanitizedText = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{FE00}-\u{FEFF}]/gu, '').trim();

  const imgData = fs.readFileSync(inputPath);
  const img = await loadImage(imgData);
  const { width, height } = img;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const fontFamily = getFontFamily();
  const textAlign = getTextAlign();
  const textScale = getTextScale();

  // Draw the source image
  ctx.drawImage(img, 0, 0, width, height);

  // 15% horizontal padding on each side — text stays well inside the frame
  const paddingX = Math.round(width * 0.15);
  const maxTextWidth = width - paddingX * 2;

  // Start at ~5.5% of image width, shrink until ≤6 lines (slightly larger budget for handwriting font)
  let fontSize = Math.round(width * 0.055 * textScale);
  let lines;

  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    lines = wordWrap(ctx, sanitizedText, maxTextWidth);
    if (lines.length <= 6) break;
    fontSize = Math.round(fontSize * 0.82);
  }

  const lineHeight = fontSize * 1.2;
  const blockH = lines.length * lineHeight;
  const startY = (height - blockH) / 2 + lineHeight / 2;

  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontSize}px ${fontFamily}`;

  for (let i = 0; i < lines.length; i++) {
    const x = textAlign === 'left' ? paddingX : textAlign === 'right' ? width - paddingX : width / 2;
    const y = startY + i * lineHeight;

    // Outline — stroke before fill so stroke sits behind the white fill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.round(fontSize * 0.06);
    ctx.lineJoin = 'round';
    ctx.strokeText(lines[i], x, y);

    ctx.fillStyle = 'white';
    ctx.fillText(lines[i], x, y);
  }

  const buffer = canvas.toBuffer('image/jpeg');
  fs.writeFileSync(outputPath, buffer);
  console.log(`✓ Saved: ${outputPath}`);
}

function wordWrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
