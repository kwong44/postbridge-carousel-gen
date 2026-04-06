# Carousel Prompt System Notes

## Summary

This document captures the recent prompt-system refactor work in `pipeline.js` for the `wellness` and `upgrades` profiles.

The main goals were:

- improve `upgrades` anchor prompts so they behave more like TikTok carousel hooks
- keep slide imagery in the same brand world as the anchor image
- reduce repeated elemental nature imagery across `upgrades` runs
- split slide planning by profile so `wellness` and `upgrades` stop sharing one overloaded Step 6 planner
- improve observability so prompt choices are visible in logs

## What Changed

### 1. Anchor prompt upgrades

- `generateAnchorPrompt(...)` was updated to use:
  - randomized `aestheticModes`
  - randomized `tensionTypes`
  - a stronger TikTok-carousel-specific anchor prompt
- the selected `visualDirection` is now shared across a run instead of being chosen independently later

### 2. Shared visual direction per run

- added `pickCarouselVisualDirection()`
- the selected `aesthetic` and `tension` are reused across Step 6 slide planning and Step 6.5 anchor generation
- this was done to reduce brand drift between the anchor and the other slides

### 3. Profile-specific run logs

- runs now write to:
  - `logs/runs_wellness.jsonl`
  - `logs/runs_upgrades.jsonl`
- reads still fall back to legacy `logs/runs.jsonl` if needed
- `visual_direction` is now logged on each run
- `motif_family` is logged per slide when applicable

### 4. Profile-owned slide planners

Step 6 no longer relies on one shared planner function.

Current structure:

- `planSlidesForWellness(...)`
- `planSlidesForUpgrades(...)`
- `planSlidesForProfile(...)`

This keeps one shared runner, but separates planner logic by profile.

### 5. Upgrades visual-system refactor

The old `upgrades.imageStyle` was too narrow and overfit to:

- moss
- stones
- leaves
- water
- fog
- forest textures

It was replaced with:

- a broader `imageStyle`
- `visualMotifFamilies` for `upgrades`

Current motif families:

- interior threshold
- architectural liminality
- tactile object tension
- partial body presence
- elemental nature metaphor
- urban night residue

### 6. Motif-family-based slide prompt generation

For `upgrades`:

- Step 6 asks the LLM for `label + motif_family`
- final `image_prompt` is generated downstream by `generateSlideImagePrompt(...)`

This is important because it moved image prompt authorship away from a single free-form Step 6 JSON response and into a more controlled second step.

### 7. Prompt inspection and repair

Added:

- `inspectImagePrompt(...)`
- `repairImagePrompt(...)`

These are used to catch and repair prompt text that violates known constraints, including:

- phone / app UI references
- visible text or logo language
- disallowed face/portrait language
- body-fragment leakage outside `partial body presence`
- elemental-nature leakage outside `elemental nature metaphor`

### 8. OpenRouter response parsing hardening

`llmCall(...)` was updated to handle more response shapes from OpenRouter.

It now:

- normalizes string / array / structured message content
- checks `content`, `reasoning_content`, `reasoning`, and `text`
- surfaces refusals explicitly instead of failing with a vague null-content error

## What Worked

### Shared visual direction

This helped reduce anchor/slide mismatch. The system now has a single per-run visual direction instead of independent anchor and slide styles.

### Profile-specific planners

This simplified the mental model. `wellness` and `upgrades` now have different Step 6 planning logic, which is the correct architectural split for this repo at the moment.

### Logging

This improved visibility a lot. The useful logged values now include:

- `visual_direction`
- `motif_family`
- final `anchor_prompt`
- final slide `image_prompt`

This makes debugging much easier than inferring behavior only from generated images.

### Narrower upgrades prompt generation

The first `upgrades` slide-prompt generator became too instruction-heavy. Simplifying it down to:

- one motif family
- one visual direction
- a small set of hard rules

worked better than the more elaborate version.

### Family-aware leakage checks

The motif-family constraints are now enforceable in a practical way. This is important because the model kept collapsing back to hands and elemental imagery unless explicitly checked.

## What Did Not Work

### One shared slide schema/planner

This became too messy. `wellness` and `upgrades` diverged enough that one shared `planSlides(...)` function was causing complexity, confusion, and accidental coupling.

### Overly narrow upgrades style

The earlier `upgrades` style strongly biased the system toward:

- wet moss
- shallow water
- stones
- leaves
- mist
- forest close-ups

This caused repeated prompts and repeated images across runs, even when the selected `aesthetic` and `tension` changed.

### Too much prompt complexity

The earlier `generateSlideImagePrompt(...)` prompt for `upgrades` was too dense. It stacked:

- brand context
- topic context
- hook context
- label context
- visual direction
- motif family
- long hard-avoid lists
- profile image-style text

That increased both refusal risk and prompt collapse.

### Relying on the model to obey rules without validation

That did not hold up. The model sometimes produced prompts that still included:

- hands when the motif family should not allow them
- water / stone / leaf / mist imagery outside the elemental family
- portrait-like language in anchor prompts

Validation and repair were necessary.

## Known Limitations

### Validation is still heuristic

`inspectImagePrompt(...)` works by checking prompt text, not by looking at the generated image. It can catch obvious leakage, but it cannot guarantee the image model follows the prompt perfectly.

### Upgrades still has a moody bias

Even after broadening the system, `upgrades` still leans toward:

- dim light
- muted palette
- introspective stillness

That is partly intentional, but it may still be stronger than desired.

### Motif-family assignment still comes from the LLM

The LLM now chooses `motif_family`, even though the downstream prompt generation is more controlled. If motif-family assignment itself becomes repetitive, that may need one more layer of enforcement.

## Recommended Next Steps

### 1. Watch the next few `upgrades` runs

Check:

- `logs/runs_upgrades.jsonl`
- generated slide images

Specifically look for:

- repeated motif-family assignment across runs
- repeated subject nouns even when motif family changes
- continued dark/elemental collapse

### 2. If repetition continues, add noun-level anti-repetition

Good next step if needed:

- extract core subject nouns from recent `upgrades` prompts
- tell the generator to avoid reusing them for a few runs

This would be stronger than just rotating motif families.

### 3. If stylistic drift continues, tighten family definitions

Possible adjustment:

- make `interior threshold`, `tactile object tension`, and `architectural liminality` even more visually distinct
- reduce overlap between their allowed palettes and compositions

### 4. If OpenRouter keeps refusing

The next move should be:

- simplify `repairImagePrompt(...)` too
- avoid stacking too many constraints in one rewrite call

Do not respond by adding more instructions to the generation prompt.

### 5. If image outputs still ignore prompt distinctions

At that point, the bottleneck may be the image model rather than the prompt system.

Candidate options:

- change image model for `upgrades`
- adjust generation parameters
- generate a stronger negative prompt for `upgrades`

## Current Intended Architecture

What seems correct for this repo now:

- one shared pipeline runner
- profile-owned strategy at prompt/planner level
- shared infra for:
  - OpenRouter
  - Replicate
  - logging
  - validation/repair
  - upload/publish flow

What does not seem necessary yet:

- fully separate top-level pipelines per profile

That would duplicate orchestration code without solving the main source of complexity.
