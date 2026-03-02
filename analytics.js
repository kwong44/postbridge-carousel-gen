#!/usr/bin/env node
/**
 * analytics.js — PostBridge poller, TikTok CSV parser, category reporter, topic generator
 *
 * Commands:
 *   node analytics.js sync              # Sync PB status + merge TikTok CSV if present
 *   node analytics.js report            # Category performance report
 *   node analytics.js generate-topics   # LLM-generate topics from top categories
 *   node analytics.js check-api         # Probe PostBridge analytics endpoints
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const ROOT           = dirname(fileURLToPath(import.meta.url));
const STATE_PATH     = join(ROOT, 'state.json');
const ANALYTICS_PATH = join(ROOT, 'analytics.json');
const CONFIG_PATH    = join(ROOT, 'config.json');
const TOPICS_PATH    = join(ROOT, 'wellness-topics.md');
const TIKTOK_CSV     = join(ROOT, 'tiktok-analytics.csv');

dotenvConfig({ path: join(ROOT, '.env') });

const POSTBRIDGE_KEY   = process.env.POSTBRIDGE_API_KEY;
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim());
}

async function llmCall(prompt, maxTokens = 1024) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices[0].message.content.trim();
}

// Simple RFC-4180-aware CSV parser (handles quoted fields with commas inside)
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvRow(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = splitCsvRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
    return row;
  });
}

function splitCsvRow(row) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// Find a column by checking several possible names
function findCol(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined) return row[c];
  }
  return null;
}

// ─── sync ─────────────────────────────────────────────────────────────────────

async function cmdSync() {
  if (!POSTBRIDGE_KEY) { console.error('❌  POSTBRIDGE_API_KEY not set'); process.exit(1); }

  const state = readJson(STATE_PATH, { posts: [] });
  if (state.posts.length === 0) { console.log('No posts in state.json yet.'); return; }

  console.log(`Syncing ${state.posts.length} posts from PostBridge...`);

  // Load existing analytics or seed from state
  let analytics = readJson(ANALYTICS_PATH, null);
  if (!analytics) {
    analytics = { last_synced: null, posts: state.posts.map(p => ({ ...p })) };
  }

  // Index analytics posts by post_id for fast lookup
  const byId = {};
  for (const p of analytics.posts) { if (p.post_id) byId[p.post_id] = p; }

  // Add any state posts not yet in analytics
  for (const p of state.posts) {
    if (p.post_id && !byId[p.post_id]) {
      analytics.posts.push({ ...p });
      byId[p.post_id] = analytics.posts[analytics.posts.length - 1];
    }
  }

  // Poll PostBridge for each post
  for (const post of analytics.posts) {
    if (!post.post_id) { console.log(`  [skip] no post_id for topic "${post.topic}"`); continue; }

    process.stdout.write(`  ${post.post_id} (${post.topic?.slice(0, 40)})... `);

    try {
      const r = await fetch(`https://api.post-bridge.com/v1/posts/${post.post_id}`, {
        headers: { 'Authorization': `Bearer ${POSTBRIDGE_KEY}` },
      });
      if (r.ok) {
        const data = await r.json();
        post.pb_status = data.status ?? post.pb_status;
        console.log(post.pb_status);
      } else {
        console.log(`HTTP ${r.status}`);
      }
    } catch (e) {
      console.log(`error: ${e.message}`);
    }

    // Try analytics endpoint
    try {
      const ra = await fetch(`https://api.post-bridge.com/v1/posts/${post.post_id}/analytics`, {
        headers: { 'Authorization': `Bearer ${POSTBRIDGE_KEY}` },
      });
      if (ra.ok) {
        const adata = await ra.json();
        if (adata.views    != null) post.pb_views    = adata.views;
        if (adata.likes    != null) post.pb_likes    = adata.likes;
        if (adata.comments != null) post.pb_comments = adata.comments;
        if (adata.shares   != null) post.pb_shares   = adata.shares;
      } else if (ra.status !== 404) {
        // 404 = endpoint not available on this plan; any other error is noteworthy
        console.log(`    PostBridge analytics HTTP ${ra.status}`);
      } else {
        // 404 is expected on basic plans — log once below
      }
    } catch { /* analytics endpoint not available */ }
  }

  // Merge TikTok CSV if present
  if (existsSync(TIKTOK_CSV)) {
    console.log('\nMerging TikTok CSV...');
    mergeTikTokCsv(analytics);
  } else {
    console.log('\n  (no tiktok-analytics.csv found — skipping TikTok merge)');
  }

  analytics.last_synced = new Date().toISOString();
  writeJson(ANALYTICS_PATH, analytics);
  console.log(`\n✅ Synced ${analytics.posts.length} posts → analytics.json`);
}

function mergeTikTokCsv(analytics) {
  const csvText = readFileSync(TIKTOK_CSV, 'utf8');
  const rows = parseCsv(csvText);
  if (rows.length === 0) { console.log('  CSV is empty.'); return; }

  console.log(`  CSV has ${rows.length} rows. Sample headers: ${Object.keys(rows[0]).join(', ')}`);

  let merged = 0;
  for (const post of analytics.posts) {
    if (!post.scheduled_at) continue;
    const postDate = new Date(post.scheduled_at);

    // Find CSV rows within ±1 day of the post's scheduled date
    const matches = rows.filter(row => {
      const dateStr = findCol(row, ['date', 'post date', 'video date', 'publish date', 'time']);
      if (!dateStr) return false;
      try {
        const rowDate = new Date(dateStr);
        return Math.abs(rowDate - postDate) <= 86400000 * 1.5;
      } catch { return false; }
    });

    if (matches.length === 0) continue;

    // If multiple matches, use the one with highest views (most likely the right post)
    const best = matches.reduce((a, b) => {
      const av = Number(findCol(a, ['views', 'video views', 'play count', 'plays']) || 0);
      const bv = Number(findCol(b, ['views', 'video views', 'play count', 'plays']) || 0);
      return av >= bv ? a : b;
    });

    const views    = Number(findCol(best, ['views', 'video views', 'play count', 'plays'])    || 0);
    const likes    = Number(findCol(best, ['likes', 'like count', 'hearts'])                  || 0);
    const comments = Number(findCol(best, ['comments', 'comment count'])                      || 0);
    const shares   = Number(findCol(best, ['shares', 'share count'])                          || 0);

    post.tiktok_views    = views;
    post.tiktok_likes    = likes;
    post.tiktok_comments = comments;
    post.tiktok_shares   = shares;
    post.engagement_rate = views > 0
      ? Number(((likes + comments + shares) / views * 100).toFixed(2))
      : 0;
    merged++;
  }
  console.log(`  Matched ${merged} posts from CSV`);
}

// ─── report ───────────────────────────────────────────────────────────────────

function cmdReport() {
  const analytics = readJson(ANALYTICS_PATH, null);
  if (!analytics) { console.log('No analytics.json — run `node analytics.js sync` first.'); return; }

  const postsWithData = analytics.posts.filter(p => p.tiktok_views != null || p.pb_views != null);
  if (postsWithData.length === 0) {
    console.log('No engagement data yet. Run sync after dropping a tiktok-analytics.csv file.');
    return;
  }

  // Group by category
  const byCategory = {};
  for (const p of postsWithData) {
    const cat = p.category ?? 'Unknown';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  }

  // Compute per-category averages
  const stats = Object.entries(byCategory).map(([category, posts]) => {
    const views    = posts.map(p => p.tiktok_views    ?? p.pb_views    ?? 0);
    const likes    = posts.map(p => p.tiktok_likes    ?? p.pb_likes    ?? 0);
    const er       = posts.map(p => p.engagement_rate ?? 0);
    const avg  = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      category,
      count:       posts.length,
      avg_views:   Math.round(avg(views)),
      avg_likes:   Math.round(avg(likes)),
      avg_er:      Number(avg(er).toFixed(2)),
    };
  }).sort((a, b) => b.avg_views - a.avg_views);

  // Overall median views (for underperformer flagging)
  const allViews = postsWithData.map(p => p.tiktok_views ?? p.pb_views ?? 0).sort((a, b) => a - b);
  const median   = allViews[Math.floor(allViews.length / 2)];

  console.log('\n📊  Category Performance Report');
  console.log('─'.repeat(72));
  console.log(`${'Category'.padEnd(30)} ${'Posts'.padEnd(6)} ${'Avg Views'.padEnd(12)} ${'Avg Likes'.padEnd(11)} ${'Avg ER%'}`);
  console.log('─'.repeat(72));
  for (const s of stats) {
    const flag = s.avg_views < median ? ' ⚠️' : '';
    console.log(
      `${s.category.padEnd(30)} ${String(s.count).padEnd(6)} ${String(s.avg_views).padEnd(12)} ${String(s.avg_likes).padEnd(11)} ${s.avg_er}%${flag}`
    );
  }
  console.log('─'.repeat(72));
  console.log(`  ⚠️  = below median views (${median})`);
  console.log(`  Total posts with data: ${postsWithData.length} / ${analytics.posts.length}\n`);
}

// ─── generate-topics ──────────────────────────────────────────────────────────

async function cmdGenerateTopics() {
  if (!OPENROUTER_KEY) { console.error('❌  OPENROUTER_API_KEY not set'); process.exit(1); }

  const config    = readJson(CONFIG_PATH, { analytics_generate_topics_after: 20 });
  const analytics = readJson(ANALYTICS_PATH, null);
  if (!analytics) { console.log('No analytics.json — run sync first.'); return; }

  const postsWithData = analytics.posts.filter(p => p.tiktok_views != null || p.pb_views != null);
  const threshold = config.analytics_generate_topics_after ?? 20;

  if (postsWithData.length < threshold) {
    console.log(`Need ≥${threshold} posts with data to generate topics (have ${postsWithData.length}). Sync more data first.`);
    return;
  }

  // Find top 3 categories by avg views
  const byCategory = {};
  for (const p of postsWithData) {
    const cat = p.category ?? 'Unknown';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p.tiktok_views ?? p.pb_views ?? 0);
  }
  const ranked = Object.entries(byCategory)
    .map(([cat, views]) => ({ cat, avg: views.reduce((a, b) => a + b, 0) / views.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map(x => x.cat);

  console.log(`\nTop 3 categories: ${ranked.join(', ')}`);

  // Gather example topics from those categories for the prompt
  const mdText = readFileSync(TOPICS_PATH, 'utf8');
  const examplesByCategory = {};
  let currentCat = '';
  for (const line of mdText.split('\n')) {
    const catMatch = line.match(/^##\s+(.+)/);
    if (catMatch) { currentCat = catMatch[1].trim(); continue; }
    const topicMatch = line.match(/^-\s+(.+)/);
    if (topicMatch && ranked.includes(currentCat)) {
      if (!examplesByCategory[currentCat]) examplesByCategory[currentCat] = [];
      examplesByCategory[currentCat].push(topicMatch[1].trim());
    }
  }

  const examplesText = ranked.map(cat => {
    const ex = (examplesByCategory[cat] ?? []).slice(0, 3).join(', ');
    return `${cat}: ${ex || '(no examples)'}`;
  }).join('\n');

  console.log('Calling LLM for new topic ideas...');

  const result = parseJson(await llmCall(`You are a content strategist for a wellness TikTok account targeting women 18–30.

These are the top-performing content categories by average views:
${ranked.join(', ')}

Example existing topics in those categories:
${examplesText}

Generate 5 fresh, specific topic ideas per category. Topics should:
- Be phrased as a TikTok carousel hook in casual first-person voice
- Be specific and actionable (not generic)
- Differ meaningfully from the examples above
- Feel like something you'd actually say to a friend

Return JSON only (no markdown fences):
{
  "topics": [
    { "category": "...", "topic": "..." }
  ]
}`, 2048));

  if (!result.topics || result.topics.length === 0) {
    console.log('LLM returned no topics.'); return;
  }

  // Append to wellness-topics.md under the relevant category headers
  const mdLines     = mdText.split('\n');
  const addedTopics = { };

  for (const { category, topic } of result.topics) {
    if (!addedTopics[category]) addedTopics[category] = [];
    addedTopics[category].push(topic);
  }

  let updatedMd = mdText;
  for (const [cat, newTopics] of Object.entries(addedTopics)) {
    // Find the line index of the ## heading for this category
    const catHeading = `## ${cat}`;
    const headingIdx = mdLines.findIndex(l => l.trim() === catHeading);
    if (headingIdx === -1) {
      // Category not found — append new section at end
      updatedMd += `\n## ${cat}\n${newTopics.map(t => `- ${t}`).join('\n')}\n`;
    } else {
      // Find the end of this category's block (next ## or end of file)
      let insertBefore = mdLines.length;
      for (let i = headingIdx + 1; i < mdLines.length; i++) {
        if (mdLines[i].startsWith('## ')) { insertBefore = i; break; }
      }
      // Insert before the next heading (or at end)
      const toInsert = newTopics.map(t => `- ${t}`).join('\n');
      const before   = mdLines.slice(0, insertBefore).join('\n');
      const after    = mdLines.slice(insertBefore).join('\n');
      updatedMd = before + '\n' + toInsert + '\n' + (after ? after : '');
      // Re-split for subsequent insertions
      mdLines.splice(insertBefore, 0, ...newTopics.map(t => `- ${t}`));
    }
  }

  writeFileSync(TOPICS_PATH, updatedMd, 'utf8');

  const total = result.topics.length;
  console.log(`\n✅ Added ${total} new topics to wellness-topics.md`);
  for (const { category, topic } of result.topics) {
    console.log(`  [${category}] ${topic}`);
  }
}

// ─── check-api ────────────────────────────────────────────────────────────────

async function cmdCheckApi() {
  if (!POSTBRIDGE_KEY) { console.error('❌  POSTBRIDGE_API_KEY not set'); process.exit(1); }

  const state = readJson(STATE_PATH, { posts: [] });
  const recentPost = state.posts.filter(p => p.post_id).slice(-1)[0];

  if (!recentPost) {
    console.log('No posts in state.json yet — run the pipeline first to create a post.');
    return;
  }

  const postId = recentPost.post_id;
  console.log(`\nProbing PostBridge API with post_id: ${postId}\n`);

  const endpoints = [
    { label: 'Post status',             url: `https://api.post-bridge.com/v1/posts/${postId}` },
    { label: 'Post analytics',          url: `https://api.post-bridge.com/v1/posts/${postId}/analytics` },
    { label: 'Post insights',           url: `https://api.post-bridge.com/v1/posts/${postId}/insights` },
  ];

  // Also try account-level analytics for first account in wellness profile
  const accountId = '45778'; // wellness profile first account
  endpoints.push({ label: 'Account analytics', url: `https://api.post-bridge.com/v1/accounts/${accountId}/analytics` });

  for (const { label, url } of endpoints) {
    console.log(`── ${label}`);
    console.log(`   ${url}`);
    try {
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${POSTBRIDGE_KEY}` } });
      console.log(`   Status: ${r.status} ${r.statusText}`);
      const text = await r.text();
      try {
        const json = JSON.parse(text);
        console.log('   Response:', JSON.stringify(json, null, 2).split('\n').map(l => '   ' + l).join('\n'));
      } catch {
        console.log('   Response (raw):', text.slice(0, 300));
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    console.log();
  }
}

// ─── CLI dispatch ─────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const CMDS = { sync: cmdSync, report: cmdReport, 'generate-topics': cmdGenerateTopics, 'check-api': cmdCheckApi };

if (!cmd || !CMDS[cmd]) {
  console.log('Usage: node analytics.js <sync|report|generate-topics|check-api>');
  process.exit(cmd ? 1 : 0);
}

CMDS[cmd]().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
