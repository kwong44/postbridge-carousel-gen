#!/usr/bin/env node
/**
 * postbridge-pipeline — standalone TikTok / Instagram / Threads / Pinterest carousel generator
 *
 * Usage:
 *   node pipeline.js                    # interactive
 *   node pipeline.js "morning routine"  # pass topic directly
 *   REGEN_ANCHOR=1 node pipeline.js     # force-regenerate the anchor girl image
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execSync } from 'node:child_process';
import {
  mkdirSync, existsSync, readFileSync, writeFileSync, statSync, copyFileSync, rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT            = dirname(fileURLToPath(import.meta.url));
const REPLICATE_TOKEN  = process.env.REPLICATE_API_KEY;
const POSTBRIDGE_KEY   = process.env.POSTBRIDGE_API_KEY;
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2';
const ANCHOR_PATH     = join(ROOT, 'media', 'anchor_girl.jpg');
const OVERLAY_SCRIPT  = join(ROOT, 'overlay-text.cjs');

const PROFILES = {
  wellness: {
    accounts: ['45778', '45779', '45780', '45776'],
    niche:    'Wellness, mindfulness, healthy habits, soft living',
    audience: 'Women 18–30 interested in holistic wellness, mental health, slow living',
    tone:     'Warm, encouraging, aspirational but grounded. Feels like a friend who has it together.',
    hashtags: ['#wellness', '#selfcare', '#mindfulness', '#wellnesstok', '#fyp'],
  },
  upgrades: {
    accounts: [], // TBD — connect accounts in PostBridge first
    niche:    'Self-improvement, productivity, AI tools, tech for everyday people',
    audience: 'Curious builders, young professionals, tech-adjacent',
    tone:     'Direct, smart, no fluff. Opinionated. Sounds like a person, not a brand.',
    hashtags: ['#selfimprovement', '#productivity', '#aitools', '#buildinpublic', '#fyp'],
  },
  lifestyle: {
    accounts: [], // TBD — connect accounts in PostBridge first
    niche:    'Lifestyle blog, aesthetic content, Pinterest girl energy',
    audience: 'Girls 16–28 who curate aesthetic feeds — matcha, travel, fashion, soft life',
    tone:     'Dreamy, aspirational, visually-led. Captions are short and vibe-y.',
    hashtags: ['#lifestyle', '#aesthetic', '#pinterestgirl', '#softlife', '#fyp'],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rl = createInterface({ input, output });

function header(n, title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Step ${n}: ${title}`);
  console.log('─'.repeat(60));
}

function parseJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim());
}

async function replicateSubmit(endpoint, body) {
  const r = await fetch(`https://api.replicate.com/v1/models/${endpoint}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: body }),
  });
  if (!r.ok) throw new Error(`Replicate submit error ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}

async function replicatePoll(id, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` },
    });
    const data = await r.json();
    if (data.status === 'succeeded') { process.stdout.write(' ✓\n'); return Array.isArray(data.output) ? data.output[0] : data.output; }
    if (data.status === 'failed') throw new Error(`Prediction ${id} failed: ${JSON.stringify(data.error)}`);
    process.stdout.write('.');
  }
  throw new Error(`Prediction ${id} timed out after 4 minutes`);
}

async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${url}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

async function pbUpload(filePath) {
  const size = statSync(filePath).size;
  const name = filePath.split('/').pop();

  const r1 = await fetch('https://api.post-bridge.com/v1/media/create-upload-url', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POSTBRIDGE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mime_type: 'image/jpeg', size_bytes: size, name }),
  });
  if (!r1.ok) throw new Error(`PostBridge create-upload-url failed ${r1.status}: ${await r1.text()}`);
  const { media_id, upload_url } = await r1.json();

  const r2 = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: readFileSync(filePath),
  });
  if (!r2.ok) throw new Error(`PostBridge upload PUT failed ${r2.status}`);

  return String(media_id);
}

function overlayText(src, label, dest) {
  const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execSync(`node "${OVERLAY_SCRIPT}" "${src}" "${escaped}" "${dest}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function sleep(ms) {
  return new Promise(ok => setTimeout(ok, ms));
}

// HST = UTC-10; convert "HH:MM" HST to UTC ISO string (bumps to next day if time has passed)
function hstToUtc(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h + 10, m));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function llmCall(prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices[0].message.content.trim();
}

// ─── LLM: Caption pipeline (Steps 1–4) ───────────────────────────────────────

async function runCaptionPipeline(profile, topic) {
  header('1–2', 'Scene analysis + caption strategy');

  const analysis = parseJson(await llmCall(`Analyze this topic for a TikTok carousel post and plan a caption strategy.

Topic: ${topic}
Audience: ${profile.audience}
Niche: ${profile.niche}
Tone: ${profile.tone}
Available hashtags: ${profile.hashtags.join(', ')}

Return JSON only (no markdown fences):
{
  "scene_description": "concise description of the content/visual world for this post",
  "content_category": "one-word category",
  "target_tone": "tone phrase",
  "cta": "call to action phrase",
  "hashtag_approach": "brief note on hashtag selection"
}`));
  console.log(`  Scene:  ${analysis.scene_description}`);
  console.log(`  Tone:   ${analysis.target_tone}`);

  header('3–4', 'Caption generation + selection');

  const caption = parseJson(await llmCall(`Generate 8 distinct TikTok caption variations for this content, then select the single best one.

Scene: ${analysis.scene_description}
Tone: ${analysis.target_tone}
CTA: ${analysis.cta}
Hashtag guidance: ${analysis.hashtag_approach}
Available hashtags: ${profile.hashtags.join(', ')}

Rules:
- Caption body ≤150 characters (do not include hashtags in body count)
- Each uses 3–5 hashtags chosen from the available set above
- Variations must differ meaningfully in hook style and structure
- Select the one best caption that fits the tone and content

Return JSON only (no markdown fences):
{
  "best_caption": "...",
  "best_hashtags": ["#...", "#...", "#..."],
  "ranking_rationale": "one sentence why this is best"
}`));
  caption.best_hashtags = caption.best_hashtags.slice(0, 5); // hard cap at 5

  console.log(`  Caption:  ${caption.best_caption}`);
  console.log(`  Hashtags: ${caption.best_hashtags.join(' ')}`);

  return { ...analysis, ...caption };
}

// ─── LLM: Slide planning (Step 6) ────────────────────────────────────────────

async function planSlides(captionData, profile, count) {
  header(6, `Slide planning (${count} slides)`);

  const { slides } = parseJson(await llmCall(`Plan ${count} slides for a TikTok carousel.

Caption topic: ${captionData.scene_description}
Tone: ${captionData.target_tone}
Niche: ${profile.niche}

SLIDE 1 — ANCHOR SLIDE (brand identity selfie photo, already cached):
- Provide "label" only — no "image_prompt"
- Label is the hook/curiosity text overlaid on the anchor girl image (e.g. "5 things i started doing that changed everything", "what no one tells you about slow mornings")
- Should make the viewer want to swipe

SLIDES 2+ — lifestyle imagery:
- Provide both "label" (tip/hack text overlay) and "image_prompt" (Replicate prompt)
- Labels must be ACTUAL TIPS OR HABITS — specific, actionable, and a full sentence (12–25 words)
- Write labels in lowercase casual first-person voice, like a friend texting a life hack
- Good examples: "i switched to drinking warm lemon water first thing and my digestion completely changed", "journaling for 5 minutes before touching my phone made my whole day feel different", "the 2-minute reset: step outside, breathe deep, no phone — try it when you're overwhelmed"
- Bad examples (too short/vague): "light that doesn't rush you", "a drink that tastes like patience"
- NO faces or full bodies in image_prompt — avoid people entirely EXCEPT close-up hands/wrists interacting with an object or texture are allowed and encouraged
- NO text, typography, diagrams, or infographics in image_prompt
- Aesthetic: raw, candid, unfiltered — like a real iPhone photo or analog film shot, not a styled commercial shoot
- Mood varies per slide: can be moody/dark with dramatic atmospheric light, cool natural daylight, warm amber evening, or overcast softness — avoid forcing every slide to be "golden hour"
- Subjects: lean into sensory, textural moments — a hand trailing through river water, rain on a window, bare feet on wet stones, a steaming cup on a rainy windowsill, a journal page in soft overcast light, tangled earbuds on a nightstand, candle flame close-up, overgrown moss on old stone
- Build a visual arc: hook → tip 1 → tip 2 → tip 3 → satisfying close

Image prompt formula (follow this structure):
"{Specific subject and action or texture}. {Authentic light quality — e.g. overcast diffused, amber streetlight, soft window light, harsh midday}. {Color mood — e.g. muted greens and stone grey, warm amber and shadow, cool blue-white}. {Composition detail — e.g. extreme close-up POV, low angle, slightly out of focus foreground}. Analog film grain, candid unfiltered iPhone photo aesthetic, photorealistic, no text, no people."

Return JSON only (no markdown fences):
{
  "slides": [
    { "n": 1, "label": "..." },
    { "n": 2, "label": "...", "image_prompt": "..." }
  ]
}`));
  slides.forEach(s => console.log(`  ${s.n}. "${s.label}"`));
  return slides;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎠  PostBridge Carousel Pipeline\n');

  mkdirSync(join(ROOT, 'media'), { recursive: true });
  const tmp = join('/tmp', `carousel-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  // Profile selection
  const profileNames = Object.keys(PROFILES).join(', ');
  const pInput = (await rl.question(`Profile [${profileNames}] (default: wellness): `)).trim().toLowerCase() || 'wellness';
  const profile = PROFILES[pInput];
  if (!profile) {
    console.error(`Unknown profile: "${pInput}". Valid options: ${profileNames}`);
    process.exit(1);
  }

  // Topic
  const topicArg = process.argv[2];
  const topic = topicArg || (await rl.question('Topic / description: ')).trim();
  if (!topic) { console.error('No topic provided.'); process.exit(1); }

  // Slide count
  const countInput = (await rl.question('Slide count [3–7] (default 5): ')).trim();
  const slideCount = Math.min(7, Math.max(3, parseInt(countInput) || 5));

  // ── Steps 1–4: Caption pipeline ──
  const captionData = await runCaptionPipeline(profile, topic);

  // ── Step 6: Slide planning ──
  const slides = await planSlides(captionData, profile, slideCount);

  // ── Step 6.5: Anchor image ──
  header('6.5', 'Anchor image');
  const regenAnchor = process.env.REGEN_ANCHOR === '1';
  if (!existsSync(ANCHOR_PATH) || regenAnchor) {
    console.log(regenAnchor ? '  Regenerating anchor image...' : '  No cached anchor found — generating...');
    const setting  = (await rl.question('  Setting (e.g. "beach at golden hour"): ')).trim();
    const clothing = (await rl.question('  Clothing (e.g. "flowy white sundress"): ')).trim();
    const prompt = `Candid low-angle portrait of a young brunette woman wearing ${clothing}, ${setting}. Camera angle is from below looking upward at her. She gazes upward toward the sky with her chin lifted, side-profile or three-quarter view. Her face and shoulder fill the lower portion of the frame; sky, trees, or landscape fill the frame above her. Natural light, subtle lens flare, slightly imperfect framing. Photorealistic, candid moment.`;
    const negative_prompt = `smartphone, iphone, phone, mobile phone, device, screen, hand, arm, selfie stick, technology, gadget`;
    const predId = await replicateSubmit('ideogram-ai/ideogram-v3-quality', {
      prompt, negative_prompt, aspect_ratio: '1:1', magic_prompt_option: 'Off',
    });
    const url = await replicatePoll(predId, 'anchor image (ideogram)');
    await downloadTo(url, ANCHOR_PATH);
    console.log(`  Saved → ${ANCHOR_PATH}`);
  } else {
    console.log(`  Using cached anchor: ${ANCHOR_PATH}`);
  }

  // ── Step 7: Generate slide images ──
  header(7, 'Generating slide images');

  // Slide 1: copy anchor to tmp
  copyFileSync(ANCHOR_PATH, join(tmp, 'slide_1.jpg'));

  // Submit all predictions upfront (parallel submissions)
  const predIds = {};
  for (const s of slides.filter(s => s.n > 1)) {
    console.log(`  Submitting slide ${s.n}...`);
    predIds[s.n] = await replicateSubmit('prunaai/z-image-turbo', {
      prompt: s.image_prompt,
      dimensions: '1024x1024',
      num_inference_steps: 9,
      guidance_scale: 0.0,
    });
  }

  // Poll and download each
  for (const s of slides.filter(s => s.n > 1)) {
    const url = await replicatePoll(predIds[s.n], `slide ${s.n}`);
    await downloadTo(url, join(tmp, `slide_${s.n}.jpg`));
  }

  // ── Step 7.5: Composite text labels ──
  header('7.5', 'Compositing text labels');
  const labeled = {};
  for (const s of slides) {
    const src  = join(tmp, `slide_${s.n}.jpg`);
    const dest = join(tmp, `slide_${s.n}_labeled.jpg`);
    overlayText(src, s.label, dest);
    labeled[s.n] = dest;
  }

  // ── Step 8: Approval gate ──
  header(8, 'Approval gate');
  console.log(`\n  Caption:  ${captionData.best_caption}`);
  console.log(`  Hashtags: ${captionData.best_hashtags.join(' ')}\n`);
  slides.forEach(s => console.log(`  Slide ${s.n}: "${s.label}"`));
  console.log(`\n  Labeled images saved to: ${tmp}`);
  execSync(`open "${tmp}"`);

  let scheduledAt = null;
  while (true) {
    const reply = (await rl.question('  [HH:MM to schedule in HST / no to cancel]: ')).trim().toLowerCase();
    if (reply === 'no' || reply === 'n') {
      console.log('Cancelled.');
      rl.close();
      return;
    }
    const timeMatch = reply.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      scheduledAt = hstToUtc(`${timeMatch[1]}:${timeMatch[2]}`);
      console.log(`  Scheduled: ${scheduledAt} UTC`);
      break;
    }
    console.log('  Enter a time like 14:30 (HST) or "no" to cancel.');
  }

  // ── Steps 10–11: Upload + post ──
  header('10–11', 'Uploading images + creating post');

  if (profile.accounts.length === 0) {
    console.warn('⚠️  No PostBridge account IDs configured for this profile.');
    console.warn('    Add account IDs to PROFILES in pipeline.js, then re-run.');
    rl.close();
    return;
  }

  const mediaIds = [];
  for (const s of slides) {
    process.stdout.write(`  Uploading slide ${s.n}... `);
    const mid = await pbUpload(labeled[s.n]);
    mediaIds.push(mid);
    console.log(`media_id ${mid}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`  Cleaned up tmp: ${tmp}`);

  const postBody = {
    caption: `${captionData.best_caption} ${captionData.best_hashtags.join(' ')}`,
    media: mediaIds,
    social_accounts: profile.accounts,
    platform_configurations: { tiktok: { is_aigc: true, draft: true } },
  };
  if (scheduledAt) postBody.scheduled_at = scheduledAt;

  const pr = await fetch('https://api.post-bridge.com/v1/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POSTBRIDGE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postBody),
  });
  if (!pr.ok) throw new Error(`PostBridge post failed ${pr.status}: ${await pr.text()}`);

  const postResult = await pr.json();
  const postId = postResult.id ?? postResult.post_id;
  console.log(`\n  ✅ Post created — ID: ${postId}`);
  console.log('     TikTok: saved as draft — publish from app when ready');
  console.log(`     Other platforms: scheduled for ${scheduledAt} UTC`);

  // ── Step 12: Status check ──
  header(12, 'Status check (waiting 30s)');
  await sleep(30000);

  const sr = await fetch(`https://api.post-bridge.com/v1/posts/${postId}`, {
    headers: { 'Authorization': `Bearer ${POSTBRIDGE_KEY}` },
  });
  if (sr.ok) {
    const s = await sr.json();
    const icon = { posted: '✅', scheduled: '⏳', failed: '❌' }[s.status] ?? 'ℹ️';
    console.log(`  ${icon} Status: ${s.status}`);
    if (s.status === 'failed') console.error('  Error:', JSON.stringify(s.error ?? s));
  } else {
    console.warn('  Could not fetch post status:', sr.status);
  }

  console.log('\n🎉 Done!\n');
  rl.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  rl.close();
  process.exit(1);
});
