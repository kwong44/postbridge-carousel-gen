#!/usr/bin/env node
// overlay-text.cjs — composite centered text onto an image
// Usage: node overlay-text.cjs <input.jpg> "Label text" <output.jpg>

'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

async function run() {
  const [,, inputPath, text, outputPath] = process.argv;

  if (!inputPath || !text || !outputPath) {
    console.error('Usage: node overlay-text.cjs <input.jpg> "text" <output.jpg>');
    process.exit(1);
  }

  const imgData = fs.readFileSync(inputPath);
  const img = await loadImage(imgData);
  const { width, height } = img;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw the source image
  ctx.drawImage(img, 0, 0, width, height);

  // 10% horizontal padding on each side — text stays well inside the frame
  const paddingX = Math.round(width * 0.10);
  const maxTextWidth = width - paddingX * 2;

  // Start at ~6% of image width (~61px on 1024px), shrink until ≤5 lines
  let fontSize = Math.round(width * 0.060);
  let lines;

  for (let attempt = 0; attempt < 8; attempt++) {
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = wordWrap(ctx, text, maxTextWidth);
    if (lines.length <= 5) break;
    fontSize = Math.round(fontSize * 0.82);
  }

  const lineHeight = fontSize * 1.35;
  const blockH = lines.length * lineHeight;
  const startY = (height - blockH) / 2 + lineHeight / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontSize}px sans-serif`;

  for (let i = 0; i < lines.length; i++) {
    const x = width / 2;
    const y = startY + i * lineHeight;

    // Outline — stroke before fill so stroke sits behind the white fill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.round(fontSize * 0.10);
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
