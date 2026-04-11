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
const OPENROUTER_MODEL      = process.env.OPENROUTER_MODEL || 'qwen/qwen3-235b-a22b-2507';
const OVERLAY_SCRIPT        = join(ROOT, 'overlay-text.cjs');
const LEGACY_RUNS_LOG       = join(ROOT, 'logs', 'runs.jsonl');
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
      setting: 'a quiet sunlit courtyard with weathered stone, trailing greenery, and soft natural depth in the background',
      clothing: 'black fitted top and relaxed blue jeans',
    },
    anchorPrompt: ({ setting, clothing }) => `Candid photo of the same young brunette woman with long dark hair loosely pulled back, sitting curled up sideways in a rustic wooden chair. She wears ${clothing}. She is barefoot, knees tucked up, deeply absorbed reading a book held open in front of her face. Her back is mostly to the camera, shot from behind and slightly to the side - face not visible. The setting is ${setting}. Include a small lived-in side detail nearby, such as a weathered table, folded linen, ceramic mug, or open window frame, but keep the woman as the clear focal subject. Natural light only, intimate and unposed mood, film-like color grading, authentic lifestyle realism. Photorealistic, candid lifestyle photo, vertical portrait orientation.`,
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
    imageStyle: `Aspirational wellness realism that stops the scroll immediately. Images should feel beautiful, emotionally legible, and uplifting without becoming cheesy or fake. Prioritize scenic, expansive, healing imagery that feels relatable to meditation, voice journaling, inner clarity, and personal growth.

Preferred subjects: glowing horizons, ocean overlooks, mountain paths, wildflower fields, cliff edges, sunrise or sunset skies, reflective water at golden hour, open roads, warm interiors connected to nature, tactile non-text objects, and distant or partial human presence that suggests release, relief, or becoming.

Color mood: golden amber, peach light, sea glass blue, warm sand, soft green, clean sky blue, sunlit neutral stone. Light: sunrise glow, sunset backlight, clean daylight, golden-hour rim light, luminous overcast brightness. Composition: bold focal subject, scenic depth, emotional scale, wind or motion when helpful, generous negative space, and immediately readable beauty.

Hard avoids: books, journals, notebooks, open pages, paper with visible writing, readable text artifacts, flat lays styled around stationery, and anything that makes AI-generated text obvious.

Image prompt formula: "{One emotionally striking wellness scene built around a single dominant subject}. {Beautiful natural light and uplifting color}. {Cinematic composition with depth, motion, or scale}. Photorealistic, cinematic editorial image, no text, no logos."`,
    visualMotifFamilies: [
      'expansive landscape release: coastlines, overlooks, mountains, valleys, open roads, sweeping skies, and the feeling of exhaling into something bigger',
      'sunset horizon emotion: glowing sunsets, sunrises, horizon lines, clouds lit from behind, open water, desert light, and emotionally resonant sky color',
      'triumphant path or summit: trails, ridgelines, steps toward a viewpoint, reaching higher ground, breakthrough motion, and grounded victory',
      'calm reflective nature: still water, wind through grass, trees in warm light, flowers, natural textures, and peaceful clarity without cliché zen props',
      'partial or distant human presence: silhouettes, backs, distant figures, hands, shoulders, or body fragments interacting with beautiful environments, never a full face or full body',
      'tactile wellness ritual: tea, blankets, curtains, windows, ceramic objects, linen, bare feet on stone, and other warm lived-in non-text objects that feel restorative and hopeful',
    ],
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

async function sendTelegramPhotos(filePaths) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;

  const existingFiles = filePaths.filter(filePath => existsSync(filePath));
  if (existingFiles.length === 0) return;

  for (let i = 0; i < existingFiles.length; i += 10) {
    const batch = existingFiles.slice(i, i + 10);
    const form = new FormData();
    const media = batch.map((filePath, index) => ({
      type: 'photo',
      media: `attach://photo${index}`,
    }));

    form.append('chat_id', TG_CHAT_ID);
    form.append('media', JSON.stringify(media));

    batch.forEach((filePath, index) => {
      form.append(
        `photo${index}`,
        new Blob([readFileSync(filePath)], { type: 'image/jpeg' }),
        `slide_${i + index + 1}.jpg`,
      );
    });

    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMediaGroup`, {
      method: 'POST',
      body: form,
    }).catch(() => {});
  }
}

function getRunsLogPath(profileName) {
  return join(ROOT, 'logs', `runs_${profileName}.jsonl`);
}

function parseRunsLog(filePath, limit = 50) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf8')
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

function readRecentRuns(profileName, limit = 50) {
  const profileRuns = profileName ? parseRunsLog(getRunsLogPath(profileName), limit) : [];
  if (profileRuns.length > 0) return profileRuns;
  return parseRunsLog(LEGACY_RUNS_LOG, limit)
    .filter(entry => !profileName || entry.profile === profileName);
}

function getRecentAnchorHistory(profileName, limit = 5) {
  return readRecentRuns(profileName, 50)
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

function getVisualDirectionPool(profileName, profile) {
  if (profileName === 'upgrades' || profile?.niche?.includes('Voice journaling')) {
    return {
      aestheticModes: [
        'golden-hour release',
        'expansive horizon clarity',
        'nature-led transformation',
        'quiet triumph',
        'reflective warmth',
        'luminous scenic uplift',
      ],
      tensionTypes: [
        'release',
        'breakthrough',
        'arrival',
        'self-trust',
        'becoming',
      ],
    };
  }

  return {
    aestheticModes: [
      'cinematic elemental surreal',
      'digital psyche inner mindscape',
      'brutal minimal high contrast',
      'soft dream memory haze',
      'absurd surreal contrast',
      'emotional nature metaphor',
      'time distortion loop',
      'tactile macro realism',
      'liminal architectural isolation',
    ],
    tensionTypes: [
      'contradiction',
      'disappearance',
      'threshold',
      'aftermath',
      'transformation',
    ],
  };
}

function pickCarouselVisualDirection(profileName = null, profile = null) {
  const { aestheticModes, tensionTypes } = getVisualDirectionPool(profileName, profile);

  return {
    selectedAesthetic: aestheticModes[Math.floor(Math.random() * aestheticModes.length)],
    selectedTension: tensionTypes[Math.floor(Math.random() * tensionTypes.length)],
  };
}

function shuffleArray(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getMotifFamilyOrder(profile, count) {
  const families = Array.isArray(profile.visualMotifFamilies) ? profile.visualMotifFamilies.filter(Boolean) : [];
  if (families.length === 0) return [];
  const shuffled = shuffleArray(families);
  const needed = Math.max(0, count - 1);
  const order = [];
  for (let i = 0; i < needed; i++) {
    order.push(shuffled[i % shuffled.length]);
  }
  return order;
}

function formatMotifFamilies(families) {
  return families.map((family, index) => `- ${index + 1}. ${family}`).join('\n');
}

function getMotifFamilyPromptGuidance(motifFamily) {
  const family = (motifFamily || '').toLowerCase();

  if (family.includes('expansive landscape release')) {
    return {
      focus: 'sweeping coastlines, overlooks, mountain valleys, cliff edges, open roads, or broad natural spaces that feel like emotional exhale and freedom',
      light: 'sunrise glow, sunset backlight, luminous clean daylight, or warm high-altitude light',
      palette: 'golden amber, sky blue, sea glass, warm stone, soft green, and sunlit neutrals',
      composition: 'bold scenic scale with one dominant focal subject, strong horizon or depth line, and instantly readable beauty',
      hardAvoids: 'No bleak interiors, concrete hallways, parked car scenes, urban grime, or tiny low-impact subjects swallowed by dull empty space',
    };
  }

  if (family.includes('sunset horizon emotion')) {
    return {
      focus: 'sunsets, sunrises, glowing cloud banks, horizon lines, open water, desert skies, or sky-dominant scenes that carry emotional warmth and hope',
      light: 'golden-hour flare, backlit clouds, soft radiant dusk, or crisp early-morning light',
      palette: 'peach, amber, coral, warm blue, lavender-grey, and luminous sand tones',
      composition: 'one dominant horizon-led image with strong sky presence, emotional color, and clean cinematic depth',
      hardAvoids: 'No noir mood, heavy shadow dominance, muddy grey palettes, urban night residue, or cluttered foreground objects',
    };
  }

  if (family.includes('triumphant path or summit')) {
    return {
      focus: 'a trail, ridgeline, steps, a summit edge, a winding path, or a viewpoint that suggests progress, breakthrough, and grounded victory',
      light: 'clear sunrise, triumphant sunset, bright mountain air, or warm directional light',
      palette: 'warm stone, sunlit earth, amber sky, clear blue, and energized natural color',
      composition: 'forward-moving lines, scenic depth, elevated perspective, and a sense of upward momentum',
      hardAvoids: 'No empty room tension, noir restraint, urban decay, or static tabletop still lifes',
    };
  }

  if (family.includes('calm reflective nature')) {
    return {
      focus: 'still water, wind through tall grass, flowers, trees in warm light, gentle waves, or natural textures that feel calming, clear, and alive',
      light: 'golden-hour softness, luminous overcast brightness, clean morning light, or reflective sunset glow',
      palette: 'soft green, sky blue, warm gold, sand, sea glass, and fresh neutral tones',
      composition: 'one emotionally legible natural subject with softness, motion, and serene cinematic depth',
      hardAvoids: 'No stacked stones, generic spa props, muddy darkness, or repetitive close-up moss-and-rock filler',
    };
  }

  if (family.includes('partial or distant human presence')) {
    return {
      focus: 'a distant figure, back view, cropped shoulder, hand, or silhouette interacting with a beautiful environment in a way that feels relatable, healing, and emotionally open',
      light: 'sunset rim light, sunrise glow, clean daylight, or warm window light connected to nature',
      palette: 'sunlit skin tones, warm neutrals, sky blue, peach, soft green, and luminous amber',
      composition: 'human presence should support the environment, with strong scenic context, emotional clarity, and no direct face-forward portrait framing',
      hardAvoids: 'No full face, no full body, no selfie framing, no influencer pose, no gym-style triumph clichés, and no body fragment floating without a clear environment',
    };
  }

  if (family.includes('tactile wellness ritual')) {
    return {
      focus: 'tea, blanket, ceramic cup, open window, linen curtain, bare feet on warm stone, or another lived-in ritual object that feels restorative and hopeful without involving paper or text-bearing objects',
      light: 'sunlit window glow, golden-hour spill, soft morning brightness, or warm natural light',
      palette: 'paper cream, warm sand, honey light, soft green, pale sky blue, and natural wood',
      composition: 'tight but inviting editorial framing around one tactile ritual scene with warmth, beauty, and emotional immediacy',
      hardAvoids: 'No books, journals, notebooks, open pages, readable paper, generic desk flat lays, dim lonely interiors, tangled-cord melancholy, harsh clutter, or cold tech-first object scenes',
    };
  }

  return {
    focus: 'one emotionally striking wellness scene built around a single dominant subject',
    light: 'beautiful natural light with uplift and clarity',
    palette: 'luminous editorial color with warmth and clean contrast',
    composition: 'cinematic scenic depth, emotional readability, and strong focal framing',
    hardAvoids: 'No bleak noir interiors, no dull low-contrast filler, and no default urban residue imagery',
  };
}

function inspectImagePrompt(text, motifFamily = null) {
  const normalized = (text || '').toLowerCase();
  const violations = [];

  const bannedPatterns = [
    { pattern: /\bphone screens?\b|\bsmartphone\b|\bphone ui\b|\bapp ui\b|\bapp interface\b|\bscreenshot\b/, reason: 'contains phone/app UI language' },
    { pattern: /\blogos?\b|\bwatermarks?\b|\bvisible text\b|\btypography\b|\bwords\b/, reason: 'contains text/logo language' },
    { pattern: /\bbooks?\b|\bjournals?\b|\bnotebooks?\b|\bpages?\b|\bpaper\b|\bhandwriting\b|\bwritten\b|\bwriting\b/, reason: 'contains text-bearing paper object language' },
    { pattern: /\bfull face\b|\bface visible\b|\blooking at camera\b|\bdirect eye contact\b|\binfluencer portrait\b|\bselfie\b/, reason: 'contains disallowed face/portrait language' },
  ];

  for (const rule of bannedPatterns) {
    if (rule.pattern.test(normalized)) violations.push(rule.reason);
  }

  const family = (motifFamily || '').toLowerCase();
  if (!family.includes('partial or distant human presence') && /\bhand\b|\bhands\b|\bwrist\b|\bforearm\b|\bfingers?\b|\bshoulder\b|\bsilhouette\b/.test(normalized)) {
    violations.push('uses body-fragment language outside partial or distant human presence motif');
  }

  const allowsNatureLanguage = [
    'expansive landscape release',
    'sunset horizon emotion',
    'triumphant path or summit',
    'calm reflective nature',
    'partial or distant human presence',
    'tactile wellness ritual',
  ].some(name => family.includes(name));

  if (!allowsNatureLanguage && /\bwater\b|\bripple\b|\bripples\b|\bstone\b|\bstones\b|\bmoss\b|\bleaf\b|\bleaves\b|\broot\b|\broots\b|\bfog\b|\bmist\b|\bforest\b/.test(normalized)) {
    violations.push('uses nature language outside approved scenic wellness motifs');
  }

  return {
    cleaned: cleanAnchorPrompt(text),
    violations,
  };
}

async function repairImagePrompt({
  originalPrompt,
  profile,
  topic,
  hook,
  label,
  motifFamily,
  slideNumber,
  visualDirection,
  type,
}) {
  const { selectedAesthetic, selectedTension } = visualDirection ?? pickCarouselVisualDirection(null, profile);
  const motifGuidance = getMotifFamilyPromptGuidance(motifFamily);
  const prompt = await llmCall(`Rewrite this ${type} image-generation prompt so it obeys all constraints while preserving the original creative idea as much as possible.

Context:
- Topic: ${topic}
- Slide 1 hook: ${hook}
- Slide label: ${label || 'n/a'}
- Niche: ${profile.niche}
- Tone: ${profile.tone}
- Aesthetic mode: ${selectedAesthetic}
- Core visual tension: ${selectedTension}
- Slide number: ${slideNumber || 'anchor'}

Hard rules:
- Return ONLY the final prompt string
- One dominant focal subject
- No phone screens, smartphones, app UI, app interface, screenshots, logos, watermarks, or visible text
- No books, journals, notebooks, open pages, readable paper, or any object with visible writing
- No full face, selfie, influencer portrait, direct eye contact, or full body
- Keep it photorealistic and cinematic, not a graphic design concept
- Preserve the same carousel visual world and emotional tension
- Keep the result scroll-stopping, beautiful, emotionally legible, and wellness-adjacent rather than obscure, gloomy, or overly abstract
- If human presence is used, keep it partial or obscured
${motifGuidance.hardAvoids ? `- ${motifGuidance.hardAvoids}` : ''}

Original prompt to repair:
${originalPrompt}`);

  return cleanAnchorPrompt(prompt);
}

async function generateAnchorPrompt({ profileName, profile, topic, hook, recentAnchors, visualDirection }) {
  const historyBlock = recentAnchors.length === 0
    ? 'No recent anchor history.'
    : recentAnchors.map((entry, index) => `${index + 1}. topic="${entry.topic}" | hook="${entry.slide_1_label ?? 'unknown'}" | prompt="${entry.anchor_prompt ?? 'unknown'}"`).join('\n');

  const { selectedAesthetic, selectedTension } = visualDirection ?? pickCarouselVisualDirection(profileName, profile);

  const prompt = await llmCall(`Write one image-generation prompt for a TikTok carousel anchor image.

Goal:
- Stop the scroll instantly (this is the primary job)
- Create immediate curiosity so the viewer wants to swipe
- Make the viewer feel something before they fully understand it
- Fit a voice journaling / meditation app brand
- Feel like a frozen moment from a film, not a designed graphic
- Create a beautiful, emotionally moving wellness image that still has curiosity and tension

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

Creative Direction:
- Aesthetic mode: ${selectedAesthetic}
- Core visual tension: ${selectedTension}

Core Rules:
- Return ONLY the final prompt string
- One dominant focal subject
- Topic-relevant, but not literal, cheesy, or overly explanatory
- Build around one clear visual idea, not multiple competing ideas

Scroll Psychology:
- The image must create an unresolved moment
- It should feel like something just happened or is about to happen
- The viewer should feel curious, slightly emotionally pulled, or intrigued within one second
- Prioritize beauty plus emotion first, then curiosity

Composition:
- Prefer asymmetry, negative space, and layered depth
- Use foreground / midground / background separation when helpful

Visual Strategy:
- Apply the aesthetic mode as the primary visual language
- Build the image around one visual tension
- Favor scenic beauty, emotional release, expansiveness, natural grandeur, or healing momentum
- Let the frame feel like a film still, but also like something a wellness viewer would want to save or send
- Prefer sunsets, horizons, landscapes, warm interiors connected to nature, and partial or distant human presence over dim symbolic object scenes

Hard Avoids:
- No phone screens, fake app UI, logos, or visible text
- No books, journals, notebooks, paper pages, stationery flat lays, or any readable writing artifact
- No generic desk still lifes, flat lays, beige wellness stock imagery, low-contrast compositions, centered object-only still lifes, or cliché zen imagery
- No stacked stones
- No empty concrete hallways, parked car interiors, urban residue noir, or bleak dim-room melancholy
- No simple hand-holding-object-in-water image unless paired with a distinctly unusual second element

Finish:
- End with exactly: "photorealistic, cinematic editorial composition"

Write a single polished prompt string that can be sent directly to an image model.`);

  return cleanAnchorPrompt(prompt);
}

async function generateSlideImagePrompt({
  profile,
  topic,
  hook,
  label,
  slideNumber,
  motifFamily,
  visualDirection,
}) {
  const { selectedAesthetic, selectedTension } = visualDirection ?? pickCarouselVisualDirection(null, profile);
  const motifGuidance = getMotifFamilyPromptGuidance(motifFamily);
  const prompt = await llmCall(`Write one image-generation prompt for slide ${slideNumber} of a TikTok carousel.

Context:
- Topic: ${topic}
- Slide 1 hook: ${hook}
- This slide label: ${label}
- Brand tone: ${profile.tone}

Visual direction:
- Aesthetic mode: ${selectedAesthetic}
- Core visual tension: ${selectedTension}
- Motif family for this slide: ${motifFamily || 'use the profile visual system'}

Scene guidance:
- Subject/world: ${motifGuidance.focus}
- Light: ${motifGuidance.light}
- Palette: ${motifGuidance.palette}
- Composition: ${motifGuidance.composition}

Requirements:
- Return ONLY the final prompt string
- Create one emotionally striking, scroll-stopping wellness image that supports the slide label without illustrating it literally
- One dominant focal subject
- Photorealistic and cinematic, not a graphic design concept
- No books, journals, notebooks, open pages, readable paper, or visible writing artifacts
- Partial human presence is allowed only if the motif family is "partial or distant human presence"
- If the motif family is not "partial or distant human presence", do not use hands, wrists, shoulders, silhouettes, or any visible body fragment
- No full face, no full body, no influencer portrait
- Do not use hands, wrists, shoulders, silhouettes, or any visible body fragment unless the motif family is "partial or distant human presence"
- No phone screens, app UI, logos, or visible text
- Prioritize beautiful light, scenic depth, emotional clarity, and wellness relatability over dark symbolism
- The image should feel save-worthy or share-worthy on TikTok within one second
- ${motifGuidance.hardAvoids}

End with: "photorealistic, cinematic editorial composition"

Write a single concise prompt string that can be sent directly to an image model.`);

  return cleanAnchorPrompt(prompt);
}

function logRun({ profile, topic, captionData, slides, postId, scheduledAt, anchorPrompt, visualDirection }) {
  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  const runsLog = getRunsLogPath(profile);
  const entry = {
    timestamp:   new Date().toISOString(),
    profile,
    topic,
    model:       OPENROUTER_MODEL,
    caption:     captionData.best_caption,
    hashtags:    captionData.best_hashtags,
    anchor_prompt: anchorPrompt ?? null,
    visual_direction: visualDirection ?? null,
    slides:      slides.map(s => ({
      n:            s.n,
      label:        s.label,
      motif_family: s.motif_family ?? null,
      image_prompt: s.image_prompt ?? null,
    })),
    post_id:     postId,
    scheduled_at: scheduledAt,
  };
  writeFileSync(runsLog, JSON.stringify(entry) + '\n', { flag: 'a' });
  console.log(`  Run logged → ${runsLog.replace(`${ROOT}/`, '')}`);
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
  const stringifyMessagePart = (value) => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      return value
        .map(part => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          if (part && typeof part.content === 'string') return part.content;
          if (part && typeof part.reasoning === 'string') return part.reasoning;
          return '';
        })
        .join('\n')
        .trim();
    }
    if (value && typeof value.text === 'string') return value.text.trim();
    if (value && typeof value.content === 'string') return value.content.trim();
    if (value && typeof value.reasoning === 'string') return value.reasoning.trim();
    return '';
  };

  const content = [
    msg.content,
    msg.reasoning_content,
    msg.reasoning,
    msg.text,
  ]
    .map(stringifyMessagePart)
    .find(Boolean) || '';

  if (!content) {
    const refusal = stringifyMessagePart(msg.refusal);
    if (refusal) {
      throw new Error(`LLM refused request: ${refusal}`);
    }
    throw new Error(`LLM returned empty content. Message keys: ${Object.keys(msg).join(', ')}`);
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

async function planSlidesForWellness(sourceTopic, captionData, profile, count, visualDirection) {
  const { selectedAesthetic, selectedTension } = visualDirection ?? pickCarouselVisualDirection();
  console.log(`  Visual direction: aesthetic="${selectedAesthetic}" | tension="${selectedTension}"`);

  const slidesSchema = `{
  "slides": [
    { "n": 1, "label": "..." },
    { "n": 2, "label": "...", "image_prompt": "..." }
  ]
}`;

  const { slides } = await llmJson(`Plan ${count} slides for a TikTok carousel.

Original topic: ${sourceTopic}
Caption (what this post promises the viewer): ${captionData.best_caption}
Tone: ${captionData.target_tone}
Niche: ${profile.niche}

Core objective:
- Write overlay text the viewer would actually stop, read, save, or send to a friend
- Keep the overlays tightly anchored to the original topic, not the broader brand category
- Do not let generic wellness language replace the specific pain point, mechanism, or payoff in the topic

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
- The slide imagery must feel like the same brand world as slide 1, not a different aesthetic on each slide
- Keep one coherent visual system across the carousel: consistent mood, lighting logic, environmental tension, and editorial feel
- Use the same carousel visual direction on every slide:
  - Aesthetic mode: ${selectedAesthetic}
  - Core visual tension: ${selectedTension}
- Vary scenes within that world without drifting into a different brand aesthetic
- Prefer motif continuity, recurring materials, recurring spatial logic, and escalating emotional tension over random subject rotation

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

ANTI-DRIFT RULES:
- The original topic is the source of truth. Build labels from that, not from the caption wording alone.
- Avoid generic fallback language that could fit any post in the niche.
- Do not repeat the same branded term across multiple slides unless the topic itself is explicitly about that term.
- Every slide should make sense even if the viewer never sees the caption.

VISUAL AESTHETIC:
${profile.imageStyle}

IMAGE PROMPT STYLE:
- Think in terms of cinematic scene families and emotional situations, not generic stock categories
- The sequence should feel like adjacent scenes from the same film, not different Pinterest boards

Return JSON only (no markdown fences):
${slidesSchema}`, slidesSchema);

  const hook = slides.find(s => s.n === 1)?.label ?? captionData.best_caption;
  for (const slide of slides) {
    if (slide.n === 1) {
      delete slide.image_prompt;
      delete slide.motif_family;
      continue;
    }

    if (typeof slide.image_prompt === 'string' && slide.image_prompt.trim()) {
      slide.image_prompt = cleanAnchorPrompt(slide.image_prompt);
    } else {
      console.log(`  Repairing missing image prompt for slide ${slide.n}...`);
      slide.image_prompt = await generateSlideImagePrompt({
        profile,
        topic: sourceTopic,
        hook,
        label: slide.label,
        slideNumber: slide.n,
        visualDirection,
      });
    }

    const inspected = inspectImagePrompt(slide.image_prompt, null);
    if (inspected.violations.length > 0) {
      console.log(`  Repairing invalid image prompt for slide ${slide.n}: ${inspected.violations.join(', ')}`);
      slide.image_prompt = await repairImagePrompt({
        originalPrompt: inspected.cleaned,
        profile,
        topic: sourceTopic,
        hook,
        label: slide.label,
        motifFamily: null,
        slideNumber: slide.n,
        visualDirection,
        type: `slide ${slide.n}`,
      });
    } else {
      slide.image_prompt = inspected.cleaned;
    }
  }

  slides.forEach(s => console.log(`  ${s.n}. "${s.label}"`));
  return slides;
}

async function planSlidesForUpgrades(sourceTopic, captionData, profile, count, visualDirection) {
  const { selectedAesthetic, selectedTension } = visualDirection ?? pickCarouselVisualDirection();
  const motifFamilyOrder = getMotifFamilyOrder(profile, count);
  console.log(`  Visual direction: aesthetic="${selectedAesthetic}" | tension="${selectedTension}"`);
  console.log('  Motif rotation:');
  motifFamilyOrder.forEach((family, index) => console.log(`    ${index + 1}. ${family}`));

  const slidesSchema = `{
  "slides": [
    { "n": 1, "label": "..." },
    { "n": 2, "label": "...", "motif_family": "..." }
  ]
}`;

  const { slides } = await llmJson(`Plan ${count} slides for a TikTok carousel.

Original topic: ${sourceTopic}
Caption (what this post promises the viewer): ${captionData.best_caption}
Tone: ${captionData.target_tone}
Niche: ${profile.niche}

Core objective:
- Write viral on-screen overlay text, not caption copy
- Make each slide feel natively TikTok: sharp, emotionally legible, save-worthy, and easy to read fast
- Stay specific to the original topic's pain point, insight, mechanism, or shift
- Do not let the broader brand niche swallow the actual idea

SLIDE 1 — ANCHOR SLIDE (${profile.anchorLabelDescription}, already cached):
- Provide "label" only — no "image_prompt"
${profile.slide1LabelInstruction
  ? `- ${profile.slide1LabelInstruction}`
  : `- Label is the hook/curiosity text overlaid on the cached anchor asset\n- Should make the viewer want to swipe`
}

SLIDES 2+ — imagery:
- Provide both "label" (text overlay) and "motif_family"
- Do NOT provide "image_prompt" in the JSON output — image prompts are generated downstream
- For each slide 2+, choose the exact motif_family from the allowed rotation below that best supports the label
- The slide imagery must feel like the same brand world as slide 1, not a different aesthetic on each slide
- Keep one coherent visual system across the carousel: consistent mood, lighting logic, environmental tension, and editorial feel
- Use the same carousel visual direction on every slide:
  - Aesthetic mode: ${selectedAesthetic}
  - Core visual tension: ${selectedTension}
- Assign each slide a different motif_family in this order unless a later slide would become ill-fitting:
${formatMotifFamilies(motifFamilyOrder)}
- Vary scenes within that world, but do not collapse every slide into moss, stones, leaves, or water textures
- Prefer motif continuity, recurring materials, recurring spatial logic, and escalating emotional tension over random subject rotation

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

VIRAL OVERLAY RULES:
- Each label should feel like something a real person would screenshot, send, or think "wait, that's me"
- Prefer second-person or confessional first-person phrasing over generic advice copy
- Bias toward tension, recognition, contrast, or a surprising reframe
- Name the exact moment, symptom, mistake, pattern, or shift from the topic
- Keep labels punchy and clean; avoid sounding like meditation app onboarding copy

HARD AVOIDS:
- Do not make every slide about "voice journaling", "your voice", "press record", "Oasis app", or "the mic"
- Do not use product mentions except optionally on the final slide, and only if it fits naturally
- Do not write labels that could be pasted onto any topic in this niche
- Do not turn the whole carousel into a feature pitch or generic self-help affirmation

GOOD DIRECTIONS:
- "your spiral gets louder when you argue with it"
- "cbt starts working faster when you stop treating every thought like a fact"
- "the thought that wakes you up at 2am usually isn’t the first problem"
- "naming the distortion breaks half its power"
- "you don’t need a better thought first. you need distance."

VISUAL AESTHETIC:
${profile.imageStyle}

IMAGE PROMPT STYLE:
- Think in terms of cinematic scene families and emotional situations, not generic stock categories
- The sequence should feel like adjacent scenes from the same film, not different Pinterest boards

Return JSON only (no markdown fences):
${slidesSchema}`, slidesSchema);

  const hook = slides.find(s => s.n === 1)?.label ?? captionData.best_caption;
  for (const [index, slide] of slides.entries()) {
    if (slide.n === 1) {
      delete slide.image_prompt;
      delete slide.motif_family;
      continue;
    }

    const fallbackFamily = motifFamilyOrder[Math.max(0, index - 1)] ?? motifFamilyOrder[(slide.n - 2) % Math.max(motifFamilyOrder.length, 1)] ?? null;
    if (typeof slide.motif_family !== 'string' || !slide.motif_family.trim()) {
      slide.motif_family = fallbackFamily;
    }

    console.log(`  Generating image prompt for slide ${slide.n} using motif family: ${slide.motif_family}`);
    slide.image_prompt = await generateSlideImagePrompt({
      profile,
      topic: sourceTopic,
      hook,
      label: slide.label,
      slideNumber: slide.n,
      motifFamily: slide.motif_family,
      visualDirection,
    });

    const inspected = inspectImagePrompt(slide.image_prompt, slide.motif_family);
    if (inspected.violations.length > 0) {
      console.log(`  Repairing invalid image prompt for slide ${slide.n}: ${inspected.violations.join(', ')}`);
      slide.image_prompt = await repairImagePrompt({
        originalPrompt: inspected.cleaned,
        profile,
        topic: sourceTopic,
        hook,
        label: slide.label,
        motifFamily: slide.motif_family,
        slideNumber: slide.n,
        visualDirection,
        type: `slide ${slide.n}`,
      });
    } else {
      slide.image_prompt = inspected.cleaned;
    }
  }

  slides.forEach(s => console.log(`  ${s.n}. "${s.label}"`));
  return slides;
}

async function planSlidesForProfile(profileName, sourceTopic, captionData, profile, count, visualDirection) {
  header(6, `Slide planning (${count} slides)`);
  if (profileName === 'upgrades') {
    return planSlidesForUpgrades(sourceTopic, captionData, profile, count, visualDirection);
  }
  return planSlidesForWellness(sourceTopic, captionData, profile, count, visualDirection);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎠  PostBridge Carousel Pipeline\n');

  mkdirSync(join(ROOT, 'media'), { recursive: true });
  const tmp = join(ROOT, 'runs', `carousel-${Date.now()}`);
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
  const visualDirection = pickCarouselVisualDirection(pInput, profile);
  const slides = await planSlidesForProfile(pInput, topic, captionData, profile, slideCount, visualDirection);

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
        visualDirection,
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
    const anchorInspection = inspectImagePrompt(prompt);
    if (anchorInspection.violations.length > 0) {
      console.log(`  Repairing anchor prompt: ${anchorInspection.violations.join(', ')}`);
      prompt = await repairImagePrompt({
        originalPrompt: anchorInspection.cleaned,
        profile,
        topic,
        hook: slides[0]?.label ?? captionData.best_caption,
        motifFamily: null,
        visualDirection,
        type: 'anchor',
      });
    } else {
      prompt = anchorInspection.cleaned;
    }
    anchorPromptUsed = prompt;
    console.log(`  Visual direction: aesthetic="${visualDirection.selectedAesthetic}" | tension="${visualDirection.selectedTension}"`);
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
      width: 576,
      height: 1024,
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
  await sendTelegramPhotos(slides.map(s => labeled[s.n]).filter(Boolean));

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
    logRun({ profile: pInput, topic, captionData, slides, postId: null, scheduledAt, anchorPrompt: anchorPromptUsed, visualDirection });
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

  logRun({ profile: pInput, topic, captionData, slides, postId, scheduledAt, anchorPrompt: anchorPromptUsed, visualDirection });

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
