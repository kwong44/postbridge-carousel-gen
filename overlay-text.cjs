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

function parseTextPayload(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && ('primary' in parsed || 'secondary' in parsed)) {
      return {
        primary: String(parsed.primary || '').trim(),
        secondary: String(parsed.secondary || '').trim(),
      };
    }
  } catch {}

  return {
    primary: sanitizeText(text),
    secondary: '',
  };
}

function sanitizeText(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{FE00}-\u{FEFF}]/gu, '')
    .trim();
}

async function run() {
  const [,, inputPath, text, outputPath] = process.argv;

  if (!inputPath || !text || !outputPath) {
    console.error('Usage: node overlay-text.cjs <input.jpg> "text" <output.jpg>');
    process.exit(1);
  }

  const payload = parseTextPayload(text);

  const imgData = fs.readFileSync(inputPath);
  const img = await loadImage(imgData);
  const { width, height } = img;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const fontFamily = getFontFamily();
  const textAlign = getTextAlign();
  const textScale = getTextScale();

  ctx.drawImage(img, 0, 0, width, height);

  if (payload.secondary) {
    drawSplitTextOverlay(ctx, width, height, payload, textScale);
  } else {
    drawSingleTextOverlay(ctx, width, height, payload.primary, fontFamily, textAlign, textScale);
  }

  const buffer = canvas.toBuffer('image/jpeg');
  fs.writeFileSync(outputPath, buffer);
  console.log(`✓ Saved: ${outputPath}`);
}

function drawSingleTextOverlay(ctx, width, height, text, fontFamily, textAlign, textScale) {
  const paddingX = Math.round(width * 0.15);
  const maxTextWidth = width - paddingX * 2;

  let fontSize = Math.round(width * 0.055 * textScale);
  let lines;

  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    lines = wordWrap(ctx, text, maxTextWidth);
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
    strokeAndFillText(ctx, lines[i], x, y, fontSize, 'white', 'black');
  }
}

function drawSplitTextOverlay(ctx, width, height, payload, textScale) {
  const boxPaddingX = Math.round(width * 0.07);
  const maxBoxWidth = width - boxPaddingX * 2;
  let primaryFontSize = Math.round(width * 0.07 * textScale);
  let primaryLines;

  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.font = `700 ${primaryFontSize}px Arial`;
    primaryLines = wordWrap(ctx, payload.primary, maxBoxWidth - Math.round(width * 0.07));
    if (primaryLines.length <= 4) break;
    primaryFontSize = Math.round(primaryFontSize * 0.86);
  }

  const primaryLineHeight = primaryFontSize * 1.15;
  const boxInnerPaddingX = Math.round(width * 0.035);
  const boxInnerPaddingY = Math.round(width * 0.018);
  const boxHeight = primaryLines.length * primaryLineHeight + boxInnerPaddingY * 2;
  const boxY = Math.round(height * 0.14);
  const radius = Math.round(width * 0.025);

  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  drawRoundedRect(ctx, boxPaddingX, boxY, maxBoxWidth, boxHeight, radius);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111111';
  ctx.font = `700 ${primaryFontSize}px Arial`;

  for (let i = 0; i < primaryLines.length; i++) {
    const y = boxY + boxInnerPaddingY + primaryLineHeight / 2 + i * primaryLineHeight;
    ctx.fillText(primaryLines[i], width / 2, y);
  }

  let secondaryFontSize = Math.round(width * 0.06 * textScale);
  let secondaryLines;
  const secondaryMaxWidth = width - Math.round(width * 0.18) * 2;
  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.font = `700 ${secondaryFontSize}px Arial`;
    secondaryLines = wordWrap(ctx, payload.secondary, secondaryMaxWidth);
    if (secondaryLines.length <= 5) break;
    secondaryFontSize = Math.round(secondaryFontSize * 0.86);
  }

  const secondaryLineHeight = secondaryFontSize * 1.2;
  const secondaryStartY = boxY + boxHeight + Math.round(height * 0.12);
  for (let i = 0; i < secondaryLines.length; i++) {
    const y = secondaryStartY + i * secondaryLineHeight;
    strokeAndFillText(ctx, secondaryLines[i], width / 2, y, secondaryFontSize, 'white', 'black');
  }
}

function strokeAndFillText(ctx, text, x, y, fontSize, fillStyle, strokeStyle) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = Math.round(fontSize * 0.08);
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillStyle;
  ctx.fillText(text, x, y);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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
