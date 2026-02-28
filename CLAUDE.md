# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Pipeline

```bash
node pipeline.js                    # Interactive mode (prompts for profile, topic, slide count)
node pipeline.js "your topic here"  # Pass topic as CLI argument
REGEN_ANCHOR=1 node pipeline.js     # Force regenerate cached anchor image
npm start                           # Equivalent to node pipeline.js
```

No build step, test suite, or linter is configured.

## Required Environment Variables

Create a `.env` file (gitignored) with:
- `REPLICATE_API_KEY` — for image generation (Ideogram v3, Z-Image Turbo models)
- `POSTBRIDGE_API_KEY` — for carousel upload and post creation
- `OPENROUTER_API_KEY` — for LLM calls (scene analysis, captions, slide planning)
- `OPENROUTER_MODEL` (optional) — model override, defaults to `moonshotai/kimi-k2`
- `REGEN_ANCHOR` (optional) — set to `1` to force anchor image regeneration

## Architecture

This is a **single-pass CLI orchestration pipeline** (`pipeline.js`) that takes a topic and produces a posted social media carousel. It has no abstraction layers — all logic is sequential in one file (~450 lines) plus a canvas utility (`overlay-text.cjs`).

### Pipeline Stages

| Step | What happens |
|------|-------------|
| 1–4 | Claude analyzes topic → plans caption strategy → generates 8 caption variants → selects best |
| 6 | Claude designs slide sequence: slide 1 gets the cached anchor image; slides 2+ get labels + Replicate image prompts |
| 6.5 | Anchor image generated via Replicate (Ideogram v3) if not cached at `media/anchor_girl.jpg` |
| 7 | Slide images submitted in parallel to Replicate (Z-Image Turbo), polled sequentially |
| 7.5 | `overlay-text.cjs` composites text labels onto each slide image |
| 8 | **Approval gate** — shows caption + slide labels, user accepts/rejects/schedules before publishing |
| 10–11 | PostBridge: 2-step upload (create presigned URL → PUT file) then carousel post creation |
| 12 | 30s wait → PostBridge status check poll |

### Key Design Decisions

- **`overlay-text.cjs` is CommonJS**, loaded via `createRequire` from the ES Module `pipeline.js`. This is intentional due to `@napi-rs/canvas` compatibility.
- **Anchor image is cached** at `media/anchor_girl.jpg` between runs to save generation costs. Use `REGEN_ANCHOR=1` to refresh it.
- **TikTok posts are created as drafts** (manual publish required in TikTok app). All other platforms schedule or post immediately.
- **Replicate polling**: 4s interval, max 60 attempts (~4 min timeout) per image.
- **`hstToUtc()`** converts Hawaii Standard Time (UTC−10, no DST) for scheduling input.
- **`parseJson()`** strips markdown fences from Claude responses before `JSON.parse`.

### Brand Profiles

Three profiles are defined in the `PROFILES` object in `pipeline.js`:

| Profile | Niche | Status |
|---------|-------|--------|
| `wellness` | Holistic health | Active (4 accounts wired) |
| `upgrades` | Productivity/tech | TBD accounts |
| `lifestyle` | Aesthetic/Pinterest | TBD accounts |

Each profile carries: account IDs, niche description, audience, tone, and hashtag pools used in Claude prompts.

### `overlay-text.cjs` — Text Compositing

- Adaptive font sizing: starts at 6% of image width, shrinks by 18% per iteration until text fits ≤5 lines
- Text centered vertically, 10% horizontal padding
- Rendering: white fill + black outline (10% of font size) for contrast on any background
- Input/output: JPEG files passed as CLI args by `pipeline.js`
