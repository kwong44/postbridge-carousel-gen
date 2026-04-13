#!/usr/bin/env node
/**
 * automate.js — Daily orchestrator for postbridge-pipeline
 *
 * Usage:
 *   node automate.js                                                   # Normal run
 *   node automate.js --dry-run                                         # Print next topic + anchor status, don't run pipeline
 *
 * Anchor image behavior:
 *   - Automation regenerates slide 1's cached anchor image every N days via config.anchor_regen_every.
 *   - Manual override:
 *       REGEN_ANCHOR=1 node pipeline.js "what I stopped doing in the morning (and how it helped)"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const ROOT       = dirname(fileURLToPath(import.meta.url));
const LEGACY_CONFIG_PATH = join(ROOT, 'config.json');
const LEGACY_STATE_PATH  = join(ROOT, 'state.json');
const LEGACY_TOPICS_PATH = join(ROOT, 'wellness-topics.md');
const LOGS_DIR    = join(ROOT, 'logs');

dotenvConfig({ path: join(ROOT, '.env') });

const isDryRun = process.argv.includes('--dry-run');
const argv = process.argv.slice(2);

function getFlagValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(join(LOGS_DIR, 'auto.log'), line + '\n', 'utf8');
  } catch { /* logging is best-effort */ }
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return Infinity;
  return (Date.now() - ts) / (24 * 60 * 60 * 1000);
}

function getLegacyAnchorBaseline(state, intervalDays) {
  if (!Array.isArray(state.posts) || state.posts.length === 0) return null;
  if (!(intervalDays > 0)) return null;

  // Older state files do not track anchor regeneration explicitly.
  // Approximate the prior cadence by treating every Nth completed post as the last regen point.
  const completedRegenCycles = Math.floor((state.post_count ?? 0) / intervalDays);
  if (completedRegenCycles <= 0) return null;

  const approxIndex = completedRegenCycles * intervalDays - 1;
  const approxPost = state.posts[approxIndex];
  return approxPost?.created_at ?? null;
}

// HST = UTC-10; convert "HH:MM" HST to UTC ISO string (bumps to next day if time has passed)
function hstToUtc(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h + 10, m));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// ─── Topic parsing ────────────────────────────────────────────────────────────

function parseTopics(mdText) {
  const topics = [];
  const categories = [];
  const lines = mdText.split('\n');
  let currentCategory = 'General';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const catMatch = line.match(/^##\s+(.+)/);
    if (catMatch) {
      currentCategory = catMatch[1].trim();
      if (!categories.includes(currentCategory)) categories.push(currentCategory);
      continue;
    }

    const topicMatch = line.match(/^-\s+(.+?)(?:\s+--(DONE|USED))?\s*$/);
    if (!topicMatch) continue;

    const topic = topicMatch[1].trim();
    const status = topicMatch[2] ?? null;
    topics.push({ topic, category: currentCategory, lineIndex, status });
    if (!categories.includes(currentCategory)) categories.push(currentCategory);
  }

  return { topics, categories, lines };
}

function chooseNextTopic(topics, categories, lastCategory, postedTopics) {
  const postedSet = new Set([
    ...postedTopics.map(p => p.topic),
    ...topics.filter(t => t.status === 'DONE' || t.status === 'USED').map(t => t.topic),
  ]);
  const availableByCategory = new Map();

  for (const category of categories) {
    availableByCategory.set(category, []);
  }

  for (const topic of topics) {
    if (postedSet.has(topic.topic)) continue;
    if (!availableByCategory.has(topic.category)) availableByCategory.set(topic.category, []);
    availableByCategory.get(topic.category).push(topic);
  }

  if (categories.length === 0) return null;

  const startIndex = lastCategory ? categories.indexOf(lastCategory) : -1;
  for (let offset = 1; offset <= categories.length; offset += 1) {
    const category = categories[(startIndex + offset) % categories.length];
    const bucket = availableByCategory.get(category) ?? [];
    if (bucket.length > 0) return bucket[0];
  }

  return null;
}

function markTopicDone(lines, topic) {
  if (topic.lineIndex == null) return lines;
  const updated = [...lines];
  const current = updated[topic.lineIndex];
  if (typeof current !== 'string') return lines;

  const nextLine = current
    .replace(/\s+--(DONE|USED)\s*$/, '')
    .replace(/\s+$/, '') + ' --DONE';

  updated[topic.lineIndex] = nextLine;
  return updated;
}

function resolveProfileFiles(profileArg) {
  const requestedProfile = (profileArg || '').trim().toLowerCase();
  const configPath = requestedProfile
    ? join(ROOT, `config.${requestedProfile}.json`)
    : LEGACY_CONFIG_PATH;

  if (!existsSync(configPath)) {
    if (requestedProfile === 'wellness' && existsSync(LEGACY_CONFIG_PATH)) {
      return {
        profile: 'wellness',
        configPath: LEGACY_CONFIG_PATH,
        statePath: LEGACY_STATE_PATH,
        topicsPath: LEGACY_TOPICS_PATH,
      };
    }
    throw new Error(`Missing config for profile "${requestedProfile}" — expected at ${configPath}`);
  }

  const config = readJson(configPath);
  const resolvedProfile = (requestedProfile || config.profile || 'wellness').trim().toLowerCase();
  const profileSpecificState = join(ROOT, `state.${resolvedProfile}.json`);
  const profileSpecificTopics = join(ROOT, `topics.${resolvedProfile}.md`);

  return {
    profile: resolvedProfile,
    configPath,
    statePath: existsSync(profileSpecificState)
      ? profileSpecificState
      : (resolvedProfile === 'wellness' ? LEGACY_STATE_PATH : profileSpecificState),
    topicsPath: existsSync(profileSpecificTopics)
      ? profileSpecificTopics
      : (resolvedProfile === 'wellness' ? LEGACY_TOPICS_PATH : profileSpecificTopics),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const profileArg = getFlagValue('--profile');
  const { profile, configPath, statePath, topicsPath } = resolveProfileFiles(profileArg);
  const skipPostbridge = process.env.SKIP_POSTBRIDGE === '1';

  const config = readJson(configPath);
  let state    = readJson(statePath, { post_count: 0, cycle: 1, posts: [] });

  if (!existsSync(topicsPath)) {
    log(`ERROR: Topics file not found for profile "${profile}" at ${topicsPath}`);
    process.exit(1);
  }

  const topicFile = readFileSync(topicsPath, 'utf8');
  const { topics: allTopics, categories, lines: topicLines } = parseTopics(topicFile);
  if (allTopics.length === 0) {
    log(`ERROR: No topics found in ${topicsPath}`);
    process.exit(1);
  }

  const lastCategory = state.posts.length > 0 ? state.posts[state.posts.length - 1]?.category ?? null : null;
  const nextTopic = chooseNextTopic(allTopics, categories, lastCategory, state.posts);
  if (!nextTopic) {
    log(`All topics in ${topicsPath} are marked DONE/USED — add new topics to continue`);
    process.exit(1);
  }

  const anchorRegenEveryDays = Number(config.anchor_regen_every) || 0;
  const lastAnchorRegeneratedAt = state.last_anchor_regenerated_at
    ?? getLegacyAnchorBaseline(state, anchorRegenEveryDays);
  const anchorAgeDays = daysSince(lastAnchorRegeneratedAt);
  const shouldRegenAnchor = anchorRegenEveryDays > 0 && anchorAgeDays >= anchorRegenEveryDays;

  log(`Profile: ${profile}`);
  log(`Config: ${configPath}`);
  log(`State: ${statePath}`);
  log(`Topics: ${topicsPath}`);
  log(`Next topic: "${nextTopic.topic}" (${nextTopic.category})`);
  log(`Category rotation: last=${lastCategory ?? 'none'} -> next=${nextTopic.category}`);
  log(`Post count: ${state.post_count} | Cycle: ${state.cycle}`);
  log(`Anchor regen cadence: every ${anchorRegenEveryDays} day(s)`);
  log(`Last anchor regen: ${lastAnchorRegeneratedAt ?? 'unknown'} | age: ${Number.isFinite(anchorAgeDays) ? anchorAgeDays.toFixed(2) : 'unknown'} day(s)`);
  log(`Anchor regen this run: ${shouldRegenAnchor ? 'YES' : 'no'}`);

  if (isDryRun) {
    console.log('\n[DRY RUN] Would run pipeline with:');
    console.log(`  AUTO_PROFILE      = ${profile}`);
    console.log(`  AUTO_TOPIC        = "${nextTopic.topic}"`);
    console.log(`  AUTO_SLIDE_COUNT  = ${config.slide_count}`);
    console.log(`  AUTO_SCHEDULE_HST = ${config.post_time_hst}`);
    console.log(`  LAST_ANCHOR_REGEN = ${lastAnchorRegeneratedAt ?? 'unknown'}`);
    console.log(`  REGEN_ANCHOR      = ${shouldRegenAnchor ? '1' : '0'}`);
    console.log(`  CONFIG_PATH       = ${configPath}`);
    console.log(`  STATE_PATH        = ${statePath}`);
    console.log(`  TOPICS_PATH       = ${topicsPath}`);
    return;
  }

  // ── Spawn pipeline.js ────────────────────────────────────────────────────────
  const env = {
    ...process.env,
    AUTO_PROFILE:      profile,
    AUTO_TOPIC:        nextTopic.topic,
    AUTO_SLIDE_COUNT:  String(config.slide_count),
    AUTO_SCHEDULE_HST: config.post_time_hst,
    REGEN_ANCHOR:      shouldRegenAnchor ? '1' : '0',
  };

  let captured = '';
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'pipeline.js')], { env, cwd: ROOT });
    child.stdout.on('data', chunk => { process.stdout.write(chunk); captured += chunk.toString(); });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('close', resolve);
  });

  if (exitCode !== 0) {
    log(`ERROR: pipeline.js exited with code ${exitCode} — state NOT advanced`);
    process.exit(exitCode);
  }

  // Parse post ID from pipeline output
  const idMatch = captured.match(/✅ Post created — ID: (\S+)/);
  const postId  = idMatch ? idMatch[1] : null;
  if (!postId && !skipPostbridge) {
    log('ERROR: Could not parse post_id from pipeline output — state NOT advanced');
    process.exit(1);
  }
  if (!postId && skipPostbridge) {
    log('INFO: pipeline skipped PostBridge; advancing state without a post_id');
  }

  // Advance state
  state.posts.push({
    post_id:      postId,
    topic:        nextTopic.topic,
    category:     nextTopic.category,
    profile,
    scheduled_at: hstToUtc(config.post_time_hst),
    created_at:   new Date().toISOString(),
    pb_status:    postId ? 'scheduled' : 'skipped',
  });
  state.post_count = (state.post_count ?? 0) + 1;
  if (shouldRegenAnchor) {
    state.last_anchor_regenerated_at = new Date().toISOString();
  } else if (!state.last_anchor_regenerated_at && lastAnchorRegeneratedAt) {
    state.last_anchor_regenerated_at = lastAnchorRegeneratedAt;
  }
  writeJson(statePath, state);
  const updatedTopicLines = markTopicDone(topicLines, nextTopic);
  if (updatedTopicLines !== topicLines) {
    writeFileSync(topicsPath, updatedTopicLines.join('\n') + '\n', 'utf8');
  }

  log(`SUCCESS: post_id=${postId ?? 'unknown'} topic="${nextTopic.topic}"`);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
