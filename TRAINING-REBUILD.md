# SIGNAL Training Engine Rebuild — Handoff Document

> **Created:** 2026-04-03
> **Branch:** `claude/signal-trading-platform-lRjct` (develop here, push to main)
> **Purpose:** Complete knowledge transfer for any agent picking this up after context compaction.

---

## WHAT WE'RE BUILDING

The training engine (`training/train.ts`) runs backtesting against random historical dates. Each trial simulates a FULL production day — not a simplified simulation. The user (CFO/COO) demands real, comprehensive runs that make the algorithm significantly smarter with each training day.

## CURRENT STATE OF WORK

### COMPLETED
1. **Types extended** (`training/lib/types.ts`) — Added `TrainingBriefing`, `TrainingRegime`, `TrainingDayRecord`, `revisedRecommendations`, `opusReviewNotes` to types
2. **Branch fix committed to main** — `training/train.ts` had hardcoded `claude/conviction-training` branch for git pushes. Fixed to use dynamic `GITHUB_REF_NAME || git rev-parse`. Already pushed to main.
3. **Training state** — Only 2 trials exist in repo (`training/results/training-state.json`). A previous run did ~163 trials but all results were lost because the branch push was wrong. Training restarts from trial 2.

### IN PROGRESS (background agents working)
4. **`training/train.ts` full rewrite** — Agent is writing the complete file. If it didn't finish, you MUST write it. See FULL PIPELINE SPEC below.
5. **App training history page** — Agent is creating:
   - `src/app/api/training/route.ts` — API to read training JSON files
   - `src/app/(app)/training/page.tsx` — Page to browse all training days
   - Navigation link addition

### NOT STARTED
6. **Update `training/lib/diary.ts`** — Diary entries should include briefing summary, regime type, and revised recommendations after Opus reviews
7. **Reset training state** — Delete `training/results/training-state.json` (or set currentTrial to 0) so the new comprehensive pipeline starts fresh
8. **Commit and push everything to main**
9. **Trigger training workflow** — Push to main auto-triggers `.github/workflows/trigger-training.yml`

---

## FULL PIPELINE SPEC (for train.ts)

Each trial MUST run these phases in order:

### Phase 1 — Signal Gathering (Claude + web search)
- Call Claude with web search to gather 100+ global market signals for the historical date
- Use the SIGNALS_PROMPT structure from `scripts/generate-briefing.ts` (lines 162-270) but adapted for historical dates
- TEMPORAL CONSTRAINT: Only search for data available BEFORE market open on that date
- Output: `GlobalSignals` object (100+ fields across 14 categories)

### Phase 2 — Regime Classification (local computation, no API call)
- Import from `../../src/lib/market-regime`: `classifyRegime(signals)`, `buildRegimePrompt(regime)`
- Import from `../../src/lib/leading-indicators`: `computeStressIndex(signals)`, `computeRiskAppetiteIndex(signals)`
- These are pure functions that run locally — no tokens consumed
- Output: regime type, confidence, bias, volatility regime, sector tilts, stress index, risk appetite

### Phase 3 — Daily Briefing (Claude + web search)
- Call Claude to generate a full morning briefing, incorporating regime context
- Same structure as `scripts/generate-briefing.ts` Phase 2
- Output: `TrainingBriefing` with summary, marketCondition, sections[], scenarios[]

### Phase 4 — Trade Recommendations (Claude + web search)
- Generate trade recommendations informed by regime + briefing context
- The prompt MUST include the regime prompt string and briefing summary
- Same 7-dimension conviction scoring
- Minimum conviction threshold: 72/100 weighted score
- Output: `TradeRecommendation[]`

### Phase 5 — Anti-Leakage Verification
- Use `verifyRecommendations(date, recs)` from `training/lib/anti-leakage.ts`
- Two-layer check: Yahoo Finance price verification + Claude hindsight audit
- Filters out trades with >2% entry price deviation or temporal leakage

### Phase 6 — Outcome Scoring (Yahoo Finance, deterministic)
- Use `scoreRecommendations(date, recs)` from `training/lib/scorer.ts`
- 3-day OHLC window from Yahoo Finance — zero tokens, zero leakage
- `calculateScores()` produces composite score
- `analyzeDimensions()` shows which conviction dims predicted winners

### Phase 7 — Store to App
- Write `public/data/training/day-{trialId}-{date}.json` with full `TrainingDayRecord`
- Update `public/data/training/index.json` with trial summary
- This makes every training day visible in the app

### Every 10 Trials — Opus Algorithm Review
1. Statistical weight optimization (`optimizeWeights()` from optimizer.ts)
2. Opus reviews the FULL pipeline for last 10 trials:
   - Signal accuracy
   - Regime classification quality
   - Briefing relevance
   - Trade recommendation alignment with regime
   - Conviction dimension predictive power
   - Blind spots and failure patterns
3. Opus produces **revised trade recommendations** showing what SHOULD have been recommended
4. Revised recs stored on trial records and app-visible JSON updated
5. Weight adjustments applied (with min 0.05, max 0.35, re-normalized)

### Git Checkpoint (every 10 trials in CI)
```typescript
const branch = process.env.GITHUB_REF_NAME ||
  execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim() ||
  'main';
execSync(
  `git add training/results/ public/data/training/ 2>/dev/null; ` +
  `git diff --staged --quiet || ` +
  `(git commit -m "Training checkpoint: ${trialNum}/${TOTAL_TRIALS} trials" && ` +
  `git pull origin ${branch} --rebase 2>/dev/null; ` +
  `git push origin HEAD:${branch})`,
  { stdio: "pipe", timeout: 120000 }
);
```

---

## CRITICAL: SIGNALS PROMPT FOR HISTORICAL DATES

The production signals prompt is in `scripts/generate-briefing.ts` lines 162-270. For training, adapt it to search for a SPECIFIC historical date. The key adaptation:

```
You are SIGNAL's market regime scanner. Your job is to gather comprehensive global market data for ${priorDateDisplay} (the trading day before ${dateDisplay}).

TEMPORAL CONSTRAINT: Search for market data as of the CLOSE on ${priorDateDisplay}. 
Do NOT include any data from ${dateDisplay} or later.
Search for: "${priorDateStr} market data", "${priorDateStr} stock market close", "${priorDateStr} VIX", etc.
```

The 14 categories and all 100+ fields are defined in the `GlobalSignals` interface in `src/lib/market-regime.ts` (lines 27-170). The signals JSON template with all field names is in `scripts/generate-briefing.ts` lines 251-267.

## CRITICAL: BRIEFING PROMPT FOR HISTORICAL DATES

Adapt from `scripts/generate-briefing.ts` `buildBriefingPrompt()` function (line 272-304). Key adaptation:
```
You are SIGNAL, an AI trading intelligence system. Today is ${dateDisplay}. 
Generate a pre-market morning briefing using ONLY information available before market open.
${regimeContext}
Search for news, events, and market data from ${priorDateDisplay} and earlier.
```

## CRITICAL: TRADE REC PROMPT ENHANCEMENT

The existing trade rec prompt in `training/train.ts` `generateRecommendations()` (lines 266-322 of OLD file) needs to be enhanced to include:
1. The regime prompt from `buildRegimePrompt(regime)` 
2. The briefing summary
3. Stress index and risk appetite scores

Add to the system prompt:
```
--- REGIME ASSESSMENT ---
${regimePrompt}
--- END REGIME ---

--- MORNING BRIEFING SUMMARY ---
${briefing.summary}
Market condition: ${briefing.marketCondition}
Key sections: ${briefing.sections.filter(s => s.importance === 'high').map(s => s.title).join(', ')}
--- END BRIEFING ---

Stress Index: ${stressIndex}/100 | Risk Appetite: ${riskAppetite}/100

Use this context to inform your trade selection. Your recommendations should ALIGN with the regime assessment.
```

---

## EXISTING TRAINING LIB FILES (DO NOT MODIFY)

| File | Exports | Purpose |
|------|---------|---------|
| `training/lib/api.ts` | `callClaude({ system, messages, maxTokens, useWebSearch })`, `extractJson<T>(text, arrayMode?)` | API client with rate limiting, SSE streaming, retry logic |
| `training/lib/scorer.ts` | `scoreRecommendations(date, recs)`, `calculateScores(recs, outcomes)`, `analyzeDimensions(recs, outcomes)` | Yahoo Finance outcome scoring |
| `training/lib/optimizer.ts` | `optimizeWeights(weights, results, lr?)`, `optimizeThreshold(results)`, `summarizeChanges(old, new)`, `DEFAULT_WEIGHTS` | Gradient-free weight optimization |
| `training/lib/dates.ts` | `getRandomTradingDays(count, startDate, endDate)` | Random trading day generator |
| `training/lib/anti-leakage.ts` | `verifyRecommendations(date, recs)` | Price check + hindsight audit |
| `training/lib/diary.ts` | `writeDiaryHeader(state)`, `appendTrialEntry(result, trialNum, total)`, `appendMilestoneSummary(trialNum, state, oldW, newW)` | Markdown diary generation |
| `training/lib/market-data.ts` | `getPriorClose(symbol, date)`, `getOHLC(symbol, date)`, `getMultiDayOHLC(symbol, date, days)` | Yahoo Finance with Claude fallback |
| `training/lib/types.ts` | All type definitions | Already extended with new types |

## APP-SIDE FILES TO CREATE

### `src/app/api/training/route.ts`
- GET handler reading from `public/data/training/`
- `?id=5` returns specific trial JSON
- No params returns index.json
- Match pattern from `src/app/api/briefing/route.ts`

### `src/app/(app)/training/page.tsx`
- Training history browser
- Summary dashboard: total trials, avg score, best score, weights
- List of all trials: date, regime, score, win rate, PF, # recs
- Expandable detail: briefing, recs table, outcomes table, dimension analysis
- Revised recs section (from Opus reviews)
- Match styling from `src/app/(app)/briefing/page.tsx`

### Navigation
- Add "Training" link to nav (check existing sidebar/nav component)

---

## ARCHITECTURE NOTES

### No API Keys on Vercel
- Vercel serves ONLY static files + reads from `public/data/`
- All Claude API calls happen in GitHub Actions
- `ANTHROPIC_API_KEY` is a GitHub secret, NOT a Vercel env var

### Data Flow
```
GitHub Actions runs training → writes JSON to public/data/training/ → commits → pushes
Vercel auto-deploys → serves static JSON → app reads via /api/training route
```

### Model
- Training uses `claude-opus-4-6` (set via `TRAINING_MODEL` env var in api.ts)
- Default in api.ts line 5: `const MODEL = process.env.TRAINING_MODEL || "claude-opus-4-6"`

### Workflows
- `/.github/workflows/trigger-training.yml` — Triggers on push to main (when training/ files change)
  - 6-hour timeout, auto-restart when incomplete
  - Concurrency group: `conviction-training` with cancel-in-progress
  - Commits results + uploads artifacts
- `/.github/workflows/daily-crons.yml` — Daily briefing generation (weekdays 10:15 UTC)
  - Runs `scripts/generate-briefing.ts`
  - Writes to `public/data/` and commits

### Key Constraints
- Rate limiting: 6s between API calls (handled by api.ts)
- Yahoo Finance: Used for deterministic price data. Falls back to Claude web search if blocked.
- Anti-leakage: 2% max entry price deviation from prior close
- Conviction threshold: 72/100 minimum weighted score (adjustable by optimizer)
- Graceful shutdown: SIGTERM/SIGINT saves state

---

## USER REQUIREMENTS (verbatim)

1. "Full runs, for each training day. Full research, validated that no data leakage, with a daily briefing, and trade recommendations."
2. "Once those are generated, the results are scored based on what actually did happen that day, essentially allowing data leakage."
3. "Once 10 of those are done, opus review the weightings and the algorithm and then revise the trade recommendations. Then continue."
4. "This is a highly sophisticated trading algorithm. It needs to be getting significantly smarter with each backtested training day."
5. "The results of every training day, along with the original trade suggestions as well as the revised suggestions after subsequent opus reviews need to be stored in the app. I should be able to see every single one in the app history."
6. "HARD protocols against data leakage"
7. "Use the git secret, not Vercel. Remember the vercel timeout issues"
8. Updates every 10 training days

---

## FILE CHECKSUMS (to detect if agents modified them)

```
training/lib/types.ts      — 7d1843d (MODIFIED by us — new types added)
training/train.ts          — 02e3549 (NEEDS FULL REWRITE — old version still on disk)
training/lib/api.ts        — 1e6aa49 (DO NOT MODIFY)
training/lib/scorer.ts     — ce79191 (DO NOT MODIFY)
training/lib/optimizer.ts  — 8fd6fc2 (DO NOT MODIFY)
training/lib/dates.ts      — 9fef4c1 (DO NOT MODIFY)
training/lib/anti-leakage.ts — 641742f (DO NOT MODIFY)
training/lib/diary.ts      — 78c0743 (needs update for briefing/regime in entries)
training/lib/market-data.ts — f70ba9f (DO NOT MODIFY)
scripts/generate-briefing.ts — 67aa198 (DO NOT MODIFY — reference for signals prompt)
src/lib/market-regime.ts   — 66064b6 (DO NOT MODIFY — import classifyRegime, buildRegimePrompt)
src/lib/leading-indicators.ts — 4fc117e (DO NOT MODIFY — import computeStressIndex, computeRiskAppetiteIndex)
.github/workflows/trigger-training.yml — 29ee0d5 (DO NOT MODIFY)
.github/workflows/daily-crons.yml — b4b6462 (DO NOT MODIFY)
```

### Uncommitted Changes on Disk
- `training/lib/types.ts` — Extended with TrainingBriefing, TrainingRegime, TrainingDayRecord, revisedRecommendations
- `TRAINING-REBUILD.md` — This file (new)
- `training/train.ts` — May have been rewritten by background agent (check!)

### Background Agents (may or may not have completed)
1. **train.ts rewrite agent** — Was writing the full training engine. Check if `training/train.ts` has been updated. If it still starts with the old header (no "v2" in comments, no signal gathering phase), the agent didn't finish and you need to write it.
2. **App training page agent** — Was creating `src/app/api/training/route.ts` and `src/app/(app)/training/page.tsx`. Check if these files exist. If not, create them.

### How to Check if Agents Finished
```bash
# Check if train.ts was rewritten (should have "Phase 1" and "Signal Gathering")
grep -c "Signal Gathering" training/train.ts
# Check if app files exist
ls src/app/api/training/route.ts src/app/\(app\)/training/page.tsx 2>/dev/null
```

---

## VALIDATION CHECKLIST (before pushing)

- [ ] `training/train.ts` has all 7 phases per trial
- [ ] Signals prompt covers all 14 categories (100+ fields)
- [ ] Regime classification uses local `classifyRegime()` (no extra API call)
- [ ] Briefing generated with regime context
- [ ] Trade recs generated with regime + briefing context
- [ ] Anti-leakage verification runs on all recs
- [ ] Scoring uses Yahoo Finance (deterministic)
- [ ] Each trial writes to `public/data/training/day-{id}-{date}.json`
- [ ] Index updated at `public/data/training/index.json`
- [ ] Opus review every 10 trials produces revised recommendations
- [ ] Revised recs stored on trial records
- [ ] Git checkpoint uses dynamic branch (not hardcoded)
- [ ] `src/app/api/training/route.ts` reads training data
- [ ] `src/app/(app)/training/page.tsx` shows full history
- [ ] Nav link added for Training
- [ ] Training state reset for fresh start
- [ ] `training/lib/types.ts` has all required types (DONE)
- [ ] No API keys in Vercel — all Claude calls in GitHub Actions
