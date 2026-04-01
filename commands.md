# Pipeline commands

## Manual runs
```
node pipeline.js "enter carousel topic"               # Interactive: prompts for profile and slide count, then stops after preview by default
node pipeline.js --profile wellness "enter topic"     # Run a specific profile with a direct topic
node pipeline.js --profile upgrades "enter topic"     # Brand/app profile; generates local assets if no PostBridge accounts exist
node pipeline.js                                      # Interactive: also prompts for topic
npm start                                 # Alias for node pipeline.js
```

## Manual scheduling prompt
```
PROMPT_SCHEDULE=1 node pipeline.js --profile wellness "enter topic"   # Re-enable manual schedule prompt
PROMPT_SCHEDULE=1 node pipeline.js --profile upgrades "enter topic"   # Keeps preview flow, but asks for a PostBridge schedule time
```

## Force-regenerate anchor image
```
REGEN_ANCHOR=1 node pipeline.js "what I stopped doing in the morning (and how it helped)"
REGEN_ANCHOR=1 node pipeline.js --profile upgrades "why voice journaling works when written journaling feels impossible"
```

## Anchor only
```
REGEN_ANCHOR=1 node pipeline.js --anchor-only --profile upgrades "why voice journaling works when written journaling feels impossible"
REGEN_ANCHOR=1 node pipeline.js --anchor-only --profile wellness "what I stopped doing in the morning (and how it helped)"
```

## Non-interactive / automation mode
```
# All prompts bypassed — runs end-to-end without input
AUTO_PROFILE=wellness AUTO_TOPIC="morning habits that made me calmer all day" AUTO_SLIDE_COUNT=5 AUTO_SCHEDULE_HST=09:00 node pipeline.js

# Upgrades brand/app profile
# If no PostBridge accounts are configured, local assets are generated and the process exits non-zero before posting
AUTO_PROFILE=upgrades AUTO_TOPIC="why voice journaling works when written journaling feels impossible" AUTO_SLIDE_COUNT=5 AUTO_SCHEDULE_HST=09:00 node pipeline.js
```

---

# Automation (automate.js)

## Dry run — see next topic + anchor regen status without posting
```
node automate.js --dry-run
node automate.js --profile upgrades --dry-run
```

## Post next topic in the rotation
```
node automate.js
node automate.js --profile upgrades
```

## Profile files
```
# Legacy wellness defaults
config.json
state.json
wellness-topics.md

# Brand/app profile
config.upgrades.json
state.upgrades.json
topics.upgrades.md
```

## Launchd (daily cron at 09:00 HST)
```
# Load / enable
launchctl load ~/Library/LaunchAgents/com.postbridge.daily.plist

# Unload / pause
launchctl unload ~/Library/LaunchAgents/com.postbridge.daily.plist

# Trigger a one-off run right now
launchctl start com.postbridge.daily

# Check status (PID + last exit code)
launchctl list | grep postbridge

# Watch live output
tail -f /Users/kylewong/postbridge-pipeline/logs/launchd.log
```

---

# Analytics (analytics.js)

## Sync — poll PostBridge for post status + merge TikTok CSV if present
```
node analytics.js sync
```

## Report — category performance table ranked by avg views
```
node analytics.js report
```

## Generate topics — LLM creates new ideas from top categories, appends to wellness-topics.md
# Requires >= 20 posts with engagement data in analytics.json
```
node analytics.js generate-topics
```

## Check API — probe PostBridge endpoints to see what analytics data is available
```
node analytics.js check-api
```

---

# TikTok CSV import
Drop tiktok-analytics.csv in the project root, then run:
```
node analytics.js sync
```
Rows are matched to posts by scheduled date (±1.5 days).
