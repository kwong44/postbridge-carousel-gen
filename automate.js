#!/usr/bin/env node
/**
 * automate.js — Daily orchestrator for postbridge-pipeline
 *
 * Usage:
 *   node automate.js           # Normal run
 *   node automate.js --dry-run # Print next topic + anchor status, don't run pipeline
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const ROOT       = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, 'config.json');
const STATE_PATH  = join(ROOT, 'state.json');
const TOPICS_PATH = join(ROOT, 'wellness-topics.md');
const LOGS_DIR    = join(ROOT, 'logs');

dotenvConfig({ path: join(ROOT, '.env') });

const isDryRun = process.argv.includes('--dry-run');

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
  let currentCategory = 'General';
  for (const line of mdText.split('\n')) {
    const catMatch = line.match(/^##\s+(.+)/);
    if (catMatch) { currentCategory = catMatch[1].trim(); continue; }
    const topicMatch = line.match(/^-\s+(.+)/);
    if (topicMatch) topics.push({ topic: topicMatch[1].trim(), category: currentCategory });
  }
  return topics;
}

function findNextTopic(allTopics, postedTopics) {
  const postedSet = new Set(postedTopics.map(p => p.topic));
  return allTopics.find(t => !postedSet.has(t.topic)) ?? null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`❌  Missing config.json — expected at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const config = readJson(CONFIG_PATH);
  let state    = readJson(STATE_PATH, { post_count: 0, cycle: 1, posts: [] });

  if (!existsSync(TOPICS_PATH)) {
    log('ERROR: wellness-topics.md not found');
    process.exit(1);
  }

  const allTopics = parseTopics(readFileSync(TOPICS_PATH, 'utf8'));
  if (allTopics.length === 0) {
    log('ERROR: No topics found in wellness-topics.md');
    process.exit(1);
  }

  let nextTopic = findNextTopic(allTopics, state.posts);
  if (!nextTopic) {
    log(`All ${allTopics.length} topics cycled — starting new cycle ${state.cycle + 1}`);
    state = { ...state, cycle: state.cycle + 1, posts: [] };
    writeJson(STATE_PATH, state);
    nextTopic = allTopics[0];
  }

  const shouldRegenAnchor = config.anchor_regen_every > 0
    && state.post_count > 0
    && state.post_count % config.anchor_regen_every === 0;

  log(`Next topic: "${nextTopic.topic}" (${nextTopic.category})`);
  log(`Post count: ${state.post_count} | Cycle: ${state.cycle}`);
  log(`Anchor regen: ${shouldRegenAnchor ? 'YES' : 'no'}`);

  if (isDryRun) {
    console.log('\n[DRY RUN] Would run pipeline with:');
    console.log(`  AUTO_PROFILE      = ${config.profile}`);
    console.log(`  AUTO_TOPIC        = "${nextTopic.topic}"`);
    console.log(`  AUTO_SLIDE_COUNT  = ${config.slide_count}`);
    console.log(`  AUTO_SCHEDULE_HST = ${config.post_time_hst}`);
    console.log(`  REGEN_ANCHOR      = ${shouldRegenAnchor ? '1' : '0'}`);
    return;
  }

  // ── Spawn pipeline.js ────────────────────────────────────────────────────────
  const env = {
    ...process.env,
    AUTO_PROFILE:      config.profile,
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
  if (!postId) log('WARN: Could not parse post_id from pipeline output');

  // Advance state
  state.posts.push({
    post_id:      postId,
    topic:        nextTopic.topic,
    category:     nextTopic.category,
    profile:      config.profile,
    scheduled_at: hstToUtc(config.post_time_hst),
    created_at:   new Date().toISOString(),
    pb_status:    'scheduled',
  });
  state.post_count = (state.post_count ?? 0) + 1;
  writeJson(STATE_PATH, state);

  log(`SUCCESS: post_id=${postId ?? 'unknown'} topic="${nextTopic.topic}"`);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
