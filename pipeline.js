#!/usr/bin/env node
/**
 * postbridge-pipeline — standalone TikTok / Instagram / Threads / Pinterest carousel generator
 *
 * Usage:
 *   node pipeline.js                    # interactive
 *   node pipeline.js "morning routine"  # pass topic directly
 *   REGEN_ANCHOR=1 node pipeline.js     # force-regenerate the anchor girl image
 *   REGEN_ANCHOR=1 node pipeline.js --anchor-only --profile upgrades "topic"  # regenerate only the anchor image
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execSync } from 'node:child_process';
import {
  mkdirSync, existsSync, readFileSync, writeFileSync, statSync, copyFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT            = dirname(fileURLToPath(import.meta.url));
const REPLICATE_TOKEN       = process.env.REPLICATE_API_KEY;
const POSTBRIDGE_KEY        = process.env.POSTBRIDGE_API_KEY;
const OPENROUTER_KEY        = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL      = process.env.OPENROUTER_MODEL || 'minimax/minimax-m2.5';
const OVERLAY_SCRIPT        = join(ROOT, 'overlay-text.cjs');
const RUNS_LOG              = join(ROOT, 'logs', 'runs.jsonl');
const LEGACY_WELLNESS_ANCHOR = join(ROOT, 'media', 'anchor_girl.jpg');
const TG_TOKEN              = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID            = process.env.TELEGRAM_NOTIFY_CHAT_ID;

const PROFILES = {
  wellness: {
    accounts: ['45778', '45779', '45780'],
    niche:    'Wellness, mindfulness, healthy habits, soft living',
    audience: 'Women 18–30 interested in holistic wellness, mental health, slow living',
    tone:     'Warm, encouraging, aspirational but grounded. Feels like a friend who has it together.',
    hashtags: ['#wellness', '#selfcare', '#mindfulness', '#wellnesstok', '#fyp'],
    anchorPath: join(ROOT, 'media', 'anchor_wellness.jpg'),
    anchorLabelDescription: 'creator anchor image',
    anchorPromptDefaults: {
      setting: 'lush tropical garden patio with bamboo fence and dense palm trees',
      clothing: 'black fitted top and relaxed blue jeans',
    },
    anchorPrompt: ({ setting, clothing }) => `Candid photo of a young brunette woman with long dark hair loosely pulled back, sitting curled up sideways in a rustic wooden chair in a lush tropical garden. She wears ${clothing}. She is barefoot, knees tucked up, deeply absorbed reading a book held open in front of her face. Her back is mostly to the camera, shot from behind and slightly to the side - face not visible. ${setting}. Dappled sunlight filters through dense palm fronds and tropical foliage behind her. A small weathered wooden side table sits beside her. Warm golden natural light, casual and intimate mood, film-like color grading. Photorealistic, candid lifestyle photo, vertical portrait orientation.`,
    negativePrompt: 'face visible, looking at camera, selfie, smartphone, phone, device, screen, technology, gadget, studio lighting, posed, artificial background',
    overlayStyle: { font: 'handwritten', align: 'center', scale: 1 },
    imageStyle: `Raw, candid, unfiltered — like a real iPhone photo or analog film shot. Mood varies per slide: moody/dark with dramatic atmospheric light, cool natural daylight, warm amber evening, or overcast softness.

SUBJECT CATEGORIES — pick a different category for each slide:
- Outdoor/nature: dew on leaves, moss on stone, light through forest canopy, rain on still water, overgrown path, wildflowers in wind
- Body/skin: close-up wrist resting on a surface, hand pressed into grass, bare shoulder in window light, fingers loosely holding something small
- Food/ingredient: herbs being chopped, a bowl of fruit in natural light, tea being poured mid-pour, hands kneading dough, spices in a palm
- Urban texture: wet pavement reflection, peeling paint on old wall, iron railing with bokeh background, worn stone steps, morning light on building facade
- Travel/place: train window with moving landscape blur, worn map on a wooden table, passport and loose coins, feet on cobblestones, a dusty road stretching out

Image prompt formula: "{Specific subject and action or texture}. {Authentic light quality — overcast diffused, amber streetlight, soft window light, harsh midday}. {Color mood — muted greens and stone grey, warm amber and shadow, cool blue-white}. {Composition — extreme close-up POV, low angle, slightly out-of-focus foreground}. Analog film grain, candid unfiltered iPhone photo aesthetic, photorealistic, no text, no people."`,
  },
  upgrades: {
    accounts: [], // TBD — connect accounts in PostBridge first
    niche:    'Voice journaling, meditation, mindfulness, radical presence, inner work — promoting the Oasis app',
    audience: 'Mixed gender 18–35 interested in journaling, meditation, CBT, stoicism, and intentional self-improvement',
    tone:     'Calm, grounded, intentional. Quiet authority — a trusted guide, not a hype brand. No fluff. Speaks plainly about inner life and mental clarity.',
    hashtags: ['#voicejournaling', '#meditation', '#mindfulness', '#selfimprovement', '#innerwork', '#journaling', '#radicalpresence', '#stoicism', '#oasisapp', '#fyp'],
    useAiAnchorPrompt: true,
    anchorPath: join(ROOT, 'media', 'anchor_upgrades.jpg'),
    anchorLabelDescription: 'brand anchor image',
    slide1LabelInstruction: 'Label MUST start with "POV:" followed by a short immersive second-person hook. Total length: 5–12 words including "POV:". Make the viewer feel seen — like you\'re naming something they\'ve lived but never said. e.g. "POV: you finally said the thing you\'ve been holding in for years", "POV: you just heard your own voice say the truth", "POV: you stopped pretending everything was fine"',
    negativePrompt: 'full face, direct eye contact, selfie, influencer pose, phone UI, app screenshot, visible text, logo, watermark, neon colors, clutter, collage, multiple subjects, stock photo look',
    overlayStyle: { font: 'sans', align: 'center', scale: 0.82 },
    imageStyle: `Elemental and grounded — raw natural textures that evoke presence and stillness. Subjects: bare hand pressing into wet moss, river stones in shallow water, fog on a forest floor, lichen on old rock, roots breaking through soil, rain on a flat stone surface, damp bark close-up, a single leaf in still water, morning mist over water.

Color mood: deep grey-green, earth tones, muted stone and sage — no bright or saturated color. Light: overcast diffused, dappled forest canopy, soft grey northern light. Composition: extreme close-up with texture in sharp focus, or ground-level perspective.

Image prompt formula: "{Specific natural subject and elemental texture}. {Overcast diffused or dappled forest light}. {Deep grey-green, earth and stone palette — no bright color}. {Extreme close-up or ground-level composition, texture in sharp focus}. Grounded elemental stillness, photorealistic, no text, no people."`,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rl = createInterface({ input, output });
const argv = process.argv.slice(2);

function getFlagValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
}

function hasFlag(flag) {
  return argv.includes(flag);
}

function getPositionalArgs() {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
      continue;
    }
    values.push(token);
  }
  return values;
}

function envFlag(name) {
  const value = (process.env[name] || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(value);
}

function header(n, title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Step ${n}: ${title}`);
  console.log('─'.repeat(60));
}

function parseJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim());
}

function extractJsonCandidate(text) {
  const cleaned = text.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim();
  const starts = ['{', '[']
    .map(char => cleaned.indexOf(char))
    .filter(index => index >= 0);

  if (starts.length === 0) return cleaned;
  return cleaned.slice(Math.min(...starts)).trim();
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
  execSync(`"${process.execPath}" "${OVERLAY_SCRIPT}" "${src}" "${escaped}" "${dest}"`, {
    cwd: ROOT,
    env: {
      ...process.env,
      OVERLAY_FONT: process.env.OVERLAY_FONT || '',
      OVERLAY_ALIGN: process.env.OVERLAY_ALIGN || '',
    },
    stdio: 'inherit',
  });
}

function sleep(ms) {
  return new Promise(ok => setTimeout(ok, ms));
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text }),
  }).catch(() => {});
}

function readRecentRuns(limit = 50) {
  if (!existsSync(RUNS_LOG)) return [];
  const lines = readFileSync(RUNS_LOG, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  return lines.slice(-limit).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getRecentAnchorHistory(profileName, limit = 5) {
  return readRecentRuns(50)
    .filter(entry => entry.profile === profileName)
    .slice(-limit)
    .map(entry => ({
      topic: entry.topic,
      slide_1_label: entry.slides?.find(slide => slide.n === 1)?.label ?? null,
      anchor_prompt: entry.anchor_prompt ?? null,
    }));
}

function cleanAnchorPrompt(text) {
  return text
    .replace(/^```(?:text)?\n?|\n?```$/gm, '')
    .replace(/^prompt:\s*/i, '')
    .trim();
}

async function generateAnchorPrompt({ profileName, profile, topic, hook, recentAnchors }) {
  const historyBlock = recentAnchors.length === 0
    ? 'No recent anchor history.'
    : recentAnchors.map((entry, index) => `${index + 1}. topic="${entry.topic}" | hook="${entry.slide_1_label ?? 'unknown'}" | prompt="${entry.anchor_prompt ?? 'unknown'}"`).join('\n');

  const prompt = await llmCall(`Write one image-generation prompt for a TikTok carousel anchor image.

Goal:
- Stop the scroll instantly
- Make the viewer curious enough to swipe
- Fit a meditation / journaling app brand
- Feel cinematic, elemental, surreal, and emotionally loaded
- Create a thought-provoking unresolved moment, not just a pretty wellness scene

Brand:
- Profile: ${profileName}
- Niche: ${profile.niche}
- Audience: ${profile.audience}
- Tone: ${profile.tone}

Current post:
- Topic: ${topic}
- Slide 1 hook: ${hook}

Recent anchor history to avoid repeating:
${historyBlock}

Rules:
- Return the prompt only
- One dominant focal subject
- Topic-relevant, but not literal or cheesy
- Build the image around one visual tension:
  1. contradiction
  2. disappearance
  3. threshold
  4. aftermath
  5. transformation
- Elemental surreal visual language: dark water, wet stone, rain, mist, submerged objects, partial human presence, strong tactile textures, cinematic tension
- Partial human presence is allowed and encouraged, but no full face and no influencer portrait
- No phone screens, no fake app UI, no logos, no visible text
- Avoid generic desk still lifes, flat lays, beige wellness stock imagery, low-contrast compositions, centered object-only still lifes, zen cliches, stacked stones, and a single hand holding an object in water unless the scene has a more unusual second element
- Prefer asymmetry, negative space, foreground obstruction, implied motion, unusual scale, mystery, and emotional ambiguity
- The image should make the viewer ask a question within one second
- Favor compositions that feel like a scene from a film, not a calming wallpaper
- If using a hand or body fragment, pair it with an unexpected environment or object relationship rather than a simple product gesture
- Use square composition
- End with a concise visual finish like "photorealistic, cinematic editorial composition, square composition"

Write a single polished prompt string that can be sent directly to an image model.`);

  return cleanAnchorPrompt(prompt);
}

function logRun({ profile, topic, captionData, slides, postId, scheduledAt, anchorPrompt }) {
  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  const entry = {
    timestamp:   new Date().toISOString(),
    profile,
    topic,
    model:       OPENROUTER_MODEL,
    caption:     captionData.best_caption,
    hashtags:    captionData.best_hashtags,
    anchor_prompt: anchorPrompt ?? null,
    slides:      slides.map(s => ({
      n:            s.n,
      label:        s.label,
      image_prompt: s.image_prompt ?? null,
    })),
    post_id:     postId,
    scheduled_at: scheduledAt,
  };
  writeFileSync(RUNS_LOG, JSON.stringify(entry) + '\n', { flag: 'a' });
  console.log(`  Run logged → logs/runs.jsonl`);
}

function resolveAnchorPath(profileName, profile) {
  if (process.env.AUTO_ANCHOR_PATH) return process.env.AUTO_ANCHOR_PATH;
  if (profile.anchorPath && existsSync(profile.anchorPath)) return profile.anchorPath;
  if (profileName === 'wellness' && existsSync(LEGACY_WELLNESS_ANCHOR)) return LEGACY_WELLNESS_ANCHOR;
  return profile.anchorPath || join(ROOT, 'media', `anchor_${profileName}.jpg`);
}

// HST = UTC-10; convert "HH:MM" or "MM/DD HH:MM" HST to UTC ISO string
// HH:MM only → bumps to next day if time has already passed today
// MM/DD HH:MM → specific date; bumps to next year if that date+time has passed
function hstToUtc(input) {
  const now = new Date();
  const dateTimeMatch = input.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (dateTimeMatch) {
    const month = parseInt(dateTimeMatch[1], 10) - 1; // 0-indexed
    const day   = parseInt(dateTimeMatch[2], 10);
    const h     = parseInt(dateTimeMatch[3], 10);
    const m     = parseInt(dateTimeMatch[4], 10);
    let year = now.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, day, h + 10, m));
    if (d <= now) d = new Date(Date.UTC(++year, month, day, h + 10, m));
    return d.toISOString();
  }
  const [h, m] = input.split(':').map(Number);
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
      max_tokens: 8192,
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const msg = data.choices[0].message;
  const content = msg.content ?? msg.reasoning_content ?? msg.reasoning ?? msg.text ?? null;
  if (content == null) {
    throw new Error(`LLM returned null content. Message keys: ${Object.keys(msg).join(', ')}`);
  }
  return content.trim();
}

async function llmJson(prompt, schemaExample) {
  const raw = await llmCall(prompt);

  try {
    return parseJson(extractJsonCandidate(raw));
  } catch (firstError) {
    const repaired = await llmCall(`Convert the following content into valid JSON.

Rules:
- Return JSON only
- Preserve the original meaning and wording as closely as possible
- Do not add commentary
- Match this schema exactly:
${schemaExample}

Content to fix:
${raw}`);

    try {
      return parseJson(extractJsonCandidate(repaired));
    } catch (secondError) {
      throw new Error(`Invalid JSON from LLM after repair attempt: ${secondError.message}`);
    }
  }
}

// ─── LLM: Caption pipeline (Steps 1–4) ───────────────────────────────────────

async function runCaptionPipeline(profile, topic) {
  header('1–2', 'Scene analysis + caption strategy');

  const analysisSchema = `{
  "scene_description": "concise description of the content/visual world for this post",
  "content_category": "one-word category",
  "target_tone": "tone phrase",
  "cta": "call to action phrase",
  "hashtag_approach": "brief note on hashtag selection"
}`;

  const analysis = await llmJson(`Analyze this topic for a TikTok carousel post and plan a caption strategy.

Topic: ${topic}
Audience: ${profile.audience}
Niche: ${profile.niche}
Tone: ${profile.tone}
Available hashtags: ${profile.hashtags.join(', ')}

Return JSON only (no markdown fences):
${analysisSchema}`, analysisSchema);
  console.log(`  Scene:  ${analysis.scene_description}`);
  console.log(`  Tone:   ${analysis.target_tone}`);

  header('3–4', 'Caption generation + selection');

  const captionSchema = `{
  "best_caption": "...",
  "best_hashtags": ["#...", "#...", "#..."],
  "ranking_rationale": "one sentence why this is best"
}`;

  const caption = await llmJson(`Generate 8 distinct TikTok caption variations for this content, then select the single best one.

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
${captionSchema}`, captionSchema);
  caption.best_hashtags = caption.best_hashtags.slice(0, 5); // hard cap at 5

  console.log(`  Caption:  ${caption.best_caption}`);
  console.log(`  Hashtags: ${caption.best_hashtags.join(' ')}`);

  return { ...analysis, ...caption };
}

// ─── LLM: Slide planning (Step 6) ────────────────────────────────────────────

async function planSlides(captionData, profile, count) {
  header(6, `Slide planning (${count} slides)`);

  const slidesSchema = `{
  "slides": [
    { "n": 1, "label": "..." },
    { "n": 2, "label": "...", "image_prompt": "..." }
  ]
}`;

  const { slides } = await llmJson(`Plan ${count} slides for a TikTok carousel.

Caption (what this post promises the viewer): ${captionData.best_caption}
Tone: ${captionData.target_tone}
Niche: ${profile.niche}

SLIDE 1 — ANCHOR SLIDE (${profile.anchorLabelDescription}, already cached):
- Provide "label" only — no "image_prompt"
${profile.slide1LabelInstruction
  ? `- ${profile.slide1LabelInstruction}`
  : `- Label is the hook/curiosity text overlaid on the cached anchor asset (e.g. "5 things i started doing that changed everything", "what no one tells you about slow mornings")\n- Should make the viewer want to swipe`
}

SLIDES 2+ — imagery:
- Provide both "label" (text overlay) and "image_prompt" (Replicate prompt)
- NO faces or full bodies in image_prompt — avoid people entirely EXCEPT close-up hands/wrists interacting with an object or texture are allowed and encouraged
- NO text, typography, diagrams, or infographics in image_prompt
- VARIETY REQUIRED: each slide must use a subject from a different category (outdoor/nature, body/skin, food/ingredient, urban texture, travel/place) — do not repeat the same category twice in one carousel

LABEL FORMAT — choose based on topic type:

For HABIT/TIP topics (morning routines, journaling habits, wellness practices):
- Labels = specific, actionable tips in lowercase casual first-person (12–25 words)
- Focus on what you did and what changed — concrete and direct, like texting a friend
- Good examples: "i switched to drinking warm lemon water first thing and my digestion completely changed", "journaling for 5 minutes before touching my phone made my whole day feel different", "i stopped eating after 7pm and i actually wake up feeling good now"
- Bad examples (too poetic/atmospheric): "i light my fairy lights at 5pm sharp — something about that warm amber glow tells my nervous system the day is done", "the cold weight in my palm makes drinking water feel like a small ceremony"
- Bad examples (too short/vague): "light that doesn't rush you", "a drink that tastes like patience"
- NO sensory atmosphere, NO poetic metaphor, NO describing objects as ceremonial or symbolic
- Arc: hook → tip 1 → tip 2 → tip 3 → satisfying close

For CONCEPT/EDUCATION topics (CBT, stoicism, mindfulness, radical presence, science of meditation):
Choose ONE of these formats based on what fits the concept best:

FORMAT A — Teach + Apply: slide 1 hooks with the concept ("why your brain gets stuck in loops"). Slides 2–4 each unpack one insight or mechanism plainly. Last slide = a concrete practice or shift to try.

FORMAT B — Reframe/Insight: each slide is one sharp, punchy insight or reframe from the concept. Written plainly — feels like a realization, not a lecture. Shareable, quotable.

FORMAT C — Story arc (Problem → Insight → Shift): slide 1 names a relatable problem. Middle slides walk through the concept as the explanation/solution. Last slide = one practical shift the viewer can make today.

Labels for concept slides: plain, specific, 10–22 words. Lowercase. No jargon. Reads like a clear thought, not a bullet point.

VISUAL AESTHETIC:
${profile.imageStyle}

Return JSON only (no markdown fences):
${slidesSchema}`, slidesSchema);
  slides.forEach(s => console.log(`  ${s.n}. "${s.label}"`));
  return slides;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎠  PostBridge Carousel Pipeline\n');

  mkdirSync(join(ROOT, 'media'), { recursive: true });
  const tmp = join('/tmp', `carousel-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const positionalArgs = getPositionalArgs();
  const anchorOnly = hasFlag('--anchor-only');

  // Profile selection
  const profileNames = Object.keys(PROFILES).join(', ');
  const pInput = (process.env.AUTO_PROFILE || getFlagValue('--profile')
    || (await rl.question(`Profile [${profileNames}] (default: wellness): `)).trim().toLowerCase()
    || 'wellness').toLowerCase();
  const profile = PROFILES[pInput];
  if (!profile) {
    console.error(`Unknown profile: "${pInput}". Valid options: ${profileNames}`);
    process.exit(1);
  }

  // Topic
  const topicArg = positionalArgs[0];
  const topic = process.env.AUTO_TOPIC || topicArg || (await rl.question('Topic / description: ')).trim();
  if (!topic) { console.error('No topic provided.'); process.exit(1); }

  // Slide count
  const countInput = process.env.AUTO_SLIDE_COUNT
    || (await rl.question('Slide count [3–7] (default 5): ')).trim();
  const slideCount = Math.min(7, Math.max(3, parseInt(countInput) || 5));

  // ── Steps 1–4: Caption pipeline ──
  const captionData = await runCaptionPipeline(profile, topic);

  // ── Step 6: Slide planning ──
  const slides = await planSlides(captionData, profile, slideCount);

  // ── Step 6.5: Anchor image ──
  header('6.5', 'Anchor image');
  const regenAnchor = process.env.REGEN_ANCHOR === '1';
  const anchorPath = resolveAnchorPath(pInput, profile);
  let anchorPromptUsed = null;
  if (!existsSync(anchorPath) || regenAnchor) {
    console.log(regenAnchor ? '  Regenerating anchor image...' : '  No cached anchor found — generating...');
    let prompt;
    if (profile.useAiAnchorPrompt) {
      prompt = await generateAnchorPrompt({
        profileName: pInput,
        profile,
        topic,
        hook: slides[0]?.label ?? captionData.best_caption,
        recentAnchors: getRecentAnchorHistory(pInput),
      });
    } else {
      const autoMode = !!process.env.AUTO_SCHEDULE_HST;
      const anchorInputs = {};
      for (const [key, defaultValue] of Object.entries(profile.anchorPromptDefaults ?? {})) {
        const envKey = `AUTO_ANCHOR_${key.toUpperCase()}`;
        const answer = autoMode
          ? (process.env[envKey] || defaultValue)
          : ((await rl.question(`  ${key.replace(/_/g, ' ')} (default: ${defaultValue}): `)).trim() || defaultValue);
        anchorInputs[key] = answer;
      }
      prompt = profile.anchorPrompt(anchorInputs);
    }
    anchorPromptUsed = prompt;
    console.log(`  Anchor prompt: ${prompt}`);
    const predId = await replicateSubmit('black-forest-labs/flux-1.1-pro', {
      prompt, aspect_ratio: '9:16',
    });
    const url = await replicatePoll(predId, 'anchor image (flux-1.1-pro)');
    await downloadTo(url, anchorPath);
    console.log(`  Saved → ${anchorPath}`);
  } else {
    console.log(`  Using cached anchor: ${anchorPath}`);
  }

  if (anchorOnly) {
    console.log(`\n  Anchor-only mode complete.`);
    console.log(`  Anchor image: ${anchorPath}`);
    if (!process.env.AUTO_SCHEDULE_HST) execSync(`open "${anchorPath}"`);
    rl.close();
    return;
  }

  // ── Step 7: Generate slide images ──
  header(7, 'Generating slide images');

  // Slide 1: copy anchor to tmp
  copyFileSync(anchorPath, join(tmp, 'slide_1.jpg'));

  // Submit all predictions upfront (parallel submissions)
  const predIds = {};
  for (const s of slides.filter(s => s.n > 1)) {
    console.log(`  Submitting slide ${s.n}...`);
    predIds[s.n] = await replicateSubmit('prunaai/z-image-turbo', {
      prompt: s.image_prompt,
      dimensions: '576x1024',
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
    process.env.OVERLAY_FONT = profile.overlayStyle?.font || '';
    process.env.OVERLAY_ALIGN = profile.overlayStyle?.align || '';
    process.env.OVERLAY_SCALE = String(profile.overlayStyle?.scale ?? 1);
    overlayText(src, s.label, dest);
    labeled[s.n] = dest;
  }

  // ── Step 8: Approval gate ──
  header(8, 'Approval gate');
  console.log(`\n  Caption:  ${captionData.best_caption}`);
  console.log(`  Hashtags: ${captionData.best_hashtags.join(' ')}\n`);
  slides.forEach(s => console.log(`  Slide ${s.n}: "${s.label}"`));
  console.log(`\n  Labeled images saved to: ${tmp}`);
  if (!process.env.AUTO_SCHEDULE_HST) execSync(`open "${tmp}"`);

  await sendTelegram(`${captionData.best_caption}\n\n${captionData.best_hashtags.join(' ')}`);

  let scheduledAt = null;
  const autoScheduleHst = process.env.AUTO_SCHEDULE_HST;
  const promptForManualSchedule = envFlag('PROMPT_SCHEDULE');
  if (autoScheduleHst) {
    scheduledAt = hstToUtc(autoScheduleHst);
    console.log(`  [AUTO] Scheduling at ${autoScheduleHst} HST → ${scheduledAt} UTC`);
  } else if (promptForManualSchedule) {
    while (true) {
      const reply = (await rl.question('  [HH:MM or MM/DD HH:MM to schedule in HST / no to cancel]: ')).trim();
      if (reply.toLowerCase() === 'no' || reply.toLowerCase() === 'n') {
        console.log('Cancelled.');
        rl.close();
        return;
      }
      const timeOnly     = reply.match(/^(\d{1,2}):(\d{2})$/);
      const dateAndTime  = reply.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
      if (timeOnly || dateAndTime) {
        scheduledAt = hstToUtc(reply);
        console.log(`  Scheduled: ${scheduledAt} UTC`);
        break;
      }
      console.log('  Enter a time like 14:30 or a date+time like 3/15 14:30 (HST), or "no" to cancel.');
    }
  } else {
    console.log('  Scheduling prompt skipped. Set PROMPT_SCHEDULE=1 to schedule from the pipeline.');
  }

  // ── Steps 10–11: Upload + post ──
  header('10–11', 'Uploading images + creating post');

  if (profile.accounts.length === 0) {
    console.warn('⚠️  No PostBridge account IDs configured for this profile.');
    console.warn('    Local assets are ready for manual posting; skipping upload and post creation.');
    console.warn(`    Asset folder: ${tmp}`);
    logRun({ profile: pInput, topic, captionData, slides, postId: null, scheduledAt, anchorPrompt: anchorPromptUsed });
    rl.close();
    process.exit(2);
  }

  const mediaIds = [];
  for (const s of slides) {
    process.stdout.write(`  Uploading slide ${s.n}... `);
    const mid = await pbUpload(labeled[s.n]);
    mediaIds.push(mid);
    console.log(`media_id ${mid}`);
  }
  const postBody = {
    caption: `${captionData.best_caption} ${captionData.best_hashtags.join(' ')}`,
    media: mediaIds,
    social_accounts: profile.accounts,
    platform_configurations: { tiktok: { is_aigc: true, draft: true, title: captionData.best_caption.slice(0, 150) } },
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
  if (!postId) throw new Error('PostBridge response did not include a post ID');
  console.log(`\n  ✅ Post created — ID: ${postId}`);
  console.log('     TikTok: saved as draft — publish from app when ready');
  console.log(`     Other platforms: scheduled for ${scheduledAt} UTC`);

  logRun({ profile: pInput, topic, captionData, slides, postId, scheduledAt, anchorPrompt: anchorPromptUsed });

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
