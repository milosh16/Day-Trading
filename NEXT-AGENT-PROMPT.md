# Prompt for Next Agent

> Copy-paste this entire file as context for the next agent session.

---

## YOUR MISSION

You are continuing a rebuild of the SIGNAL training engine — an AI-powered day trading platform. Read `TRAINING-REBUILD.md` in the repo root FIRST — it contains the complete specification, file checksums, architecture, and user requirements.

## IMMEDIATE ACTIONS

### Step 1: Check what the previous agents completed
```bash
# Did train.ts get rewritten? (should contain "Signal Gathering" if yes)
grep -c "Signal Gathering" training/train.ts
# Did app training page get created?
ls src/app/api/training/route.ts src/app/\(app\)/training/page.tsx 2>/dev/null
# What's uncommitted?
git status
git diff --stat
```

### Step 2: Read these files (in this order)
1. `TRAINING-REBUILD.md` — THE master spec. Read ALL of it.
2. `training/lib/types.ts` — Already extended with new types (TrainingBriefing, TrainingRegime, TrainingDayRecord)
3. `training/train.ts` — Check if rewritten or still old version
4. `scripts/generate-briefing.ts` — Reference for signals prompt + briefing generation (the production pipeline)
5. `src/lib/market-regime.ts` — Lines 27-170 for GlobalSignals interface, `classifyRegime()`, `buildRegimePrompt()`
6. `src/lib/leading-indicators.ts` — `computeStressIndex()`, `computeRiskAppetiteIndex()`
7. `training/lib/api.ts` — The `callClaude()` function signature
8. `training/lib/scorer.ts` — `scoreRecommendations()`, `calculateScores()`, `analyzeDimensions()`
9. `training/lib/anti-leakage.ts` — `verifyRecommendations()`
10. `training/lib/optimizer.ts` — `optimizeWeights()`, `DEFAULT_WEIGHTS`
11. `training/lib/diary.ts` — Needs update for briefing/regime data
12. `src/app/api/briefing/route.ts` — Pattern for new training API route
13. `src/app/(app)/briefing/page.tsx` — Pattern for new training page

### Step 3: Complete what's missing

**If `training/train.ts` was NOT rewritten:**
Write the complete file following the FULL PIPELINE SPEC in TRAINING-REBUILD.md. Each trial runs 7 phases:
1. Signal Gathering (Claude + web search, 100+ fields, historical date)
2. Regime Classification (local: classifyRegime, computeStressIndex, computeRiskAppetiteIndex)
3. Daily Briefing (Claude + web search, with regime context)
4. Trade Recommendations (Claude + web search, with regime + briefing context)
5. Anti-Leakage Verification (Yahoo Finance price check + hindsight audit)
6. Outcome Scoring (Yahoo Finance OHLC, deterministic)
7. Store to App (write JSON to public/data/training/)
Plus: Opus review every 10 trials with revised recommendations.

**If app files don't exist:**
Create `src/app/api/training/route.ts` and `src/app/(app)/training/page.tsx` — see TRAINING-REBUILD.md for specs.

**Always needed:**
- Update `training/lib/diary.ts` to include briefing summary, regime type, revised recs
- Reset training state: set currentTrial to 0 in training/results/training-state.json (or delete and let it recreate)
- Delete the old 2-trial results so we start fresh with the comprehensive pipeline
- Commit ALL changes (types.ts, train.ts, app files, diary.ts, TRAINING-REBUILD.md)
- Push to main
- Verify the training workflow triggers

### Step 4: After pushing
- The push to main will trigger `.github/workflows/trigger-training.yml`
- Training will start running with the new comprehensive pipeline
- Each trial will write results to `public/data/training/` and commit every 10 trials
- Tell the user training has been initiated

## KEY CONSTRAINTS
- **No API keys on Vercel** — all Claude calls happen in GitHub Actions only
- **Model: claude-opus-4-6** — set via TRAINING_MODEL env var in training/lib/api.ts
- **Anti-leakage is non-negotiable** — 2% max price deviation, hindsight audit on every trade
- **Every training day must be visible in the app** — full briefing, recs, outcomes, scores, revised recs
- **Dynamic branch for git pushes** — use GITHUB_REF_NAME env var, never hardcode a branch name
- **AGENTS.md says**: read Next.js docs in node_modules before writing Next.js code if unsure about APIs

## USER PERSONALITY
The user is the CFO/COO of a fintech startup. They are hands-on, technical, and expect:
- Comprehensive work, not shortcuts
- Real data, not simulations
- Everything visible and auditable in the app
- Updates every 10 training days
- "HARD protocols against data leakage"
