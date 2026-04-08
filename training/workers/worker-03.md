# SIGNAL Backtest Worker 03

You are backtest worker #03 for the SIGNAL day-trading algorithm. Process every date in your queue sequentially.

## Your Queue
23 dates: ["2023-07-20", "2023-08-17", "2023-09-15", "2023-10-13", "2023-11-10", "2023-12-11", "2024-01-10", "2024-02-08", "2024-03-08", "2024-04-08", "2024-05-06", "2024-06-05", "2024-07-29", "2024-09-25", "2024-11-14", "2025-01-02", "2025-02-14", "2025-04-21", "2025-06-11", "2025-08-19", "2025-10-08", "2025-12-04", "2026-01-30"]

## Working Directory
```
cd /tmp/day-trading
```

## For EACH Date in Your Queue

### Step 1 — Signals (run this command)
```bash
cd /tmp/day-trading && DATE={date} npx tsx training/run-phase1.ts
```
Replace `{date}` with the current date (e.g. `DATE=2023-07-18`).

### Step 2 — Deep Research + Trade Evaluation

Read `/tmp/trial-signals-{date}.json` for regime, signals, and context.

You are an elite trading intelligence analyst. For this historical date:

**A) Research (use web_search for each domain):**
Search for what was happening as of the PRIOR trading day (the day before {date}). Cover:
- Geopolitics & conflicts
- Macro & central bank policy
- Corporate news & earnings
- Tech, AI & supply chains
- Energy & commodities
- Policy & regulation

Search for the prior day's date specifically. Do NOT include any information from {date} itself or later.

**B) Impact Analysis:**
Rank sectors bullish→bearish. Identify 15-20 high-impact companies. Find contrarian opportunities.

**C) Trade Evaluation (ALL candidates):**
For the top 10-12 candidates, search for their prices/technicals as of the prior day. Score EVERY candidate on 7 conviction dimensions (0-100):
- catalystClarity, technicalSetup, riskReward, volumeLiquidity, marketAlignment, informationEdge, timingUrgency

Include entry/target/stop for EVERY candidate — even ones you reject.

**D) Conviction Gate:**
Only mark trades with 70+ composite conviction as `"recommended": true`. On range-bound or low-conviction days, 0 recommended trades is valid. Sitting out preserves capital.

**Write output to** `/tmp/trial-research-{date}.json`:
```json
{
  "marketOutlook": "1-2 sentence view",
  "riskLevel": "low|moderate|elevated|high",
  "research": {
    "geopolitics": "findings...",
    "macro": "findings...",
    "corporate": "findings...",
    "tech": "findings...",
    "energy": "findings...",
    "policy": "findings..."
  },
  "allEvaluated": [
    {
      "ticker": "XYZ",
      "direction": "long",
      "entryPrice": 100.00,
      "targetPrice": 104.00,
      "stopPrice": 97.50,
      "recommended": true,
      "rejectionReason": null,
      "catalyst": "Specific catalyst",
      "reasoning": "Full reasoning",
      "bearCase": "What could go wrong",
      "conviction": {
        "catalystClarity": 85,
        "technicalSetup": 70,
        "riskReward": 80,
        "volumeLiquidity": 90,
        "marketAlignment": 75,
        "informationEdge": 65,
        "timingUrgency": 70
      },
      "compositeScore": 76
    }
  ],
  "recommendations": [
    { "...only entries from allEvaluated where recommended=true..." }
  ],
  "watchlist": [],
  "avoidList": []
}
```

### Step 3 — Scoring (run this command)
```bash
cd /tmp/day-trading && DATE={date} npx tsx training/run-phase3.ts
```

### Then move to the next date.

Log progress every 5 dates: "Worker 03: completed X/23 dates."

## Critical Rules
- **TEMPORAL**: Only use information from BEFORE market open on {date}. Search the prior day.
- **THOROUGH**: Use web_search extensively. This is a backtest — depth matters more than speed.
- **ALL CANDIDATES**: Output every evaluated trade in allEvaluated, even rejected ones.
- **NO GIT**: Do not commit or push. A reconciliation script handles that.
- **NO SKIPPING**: Process every date. If a step fails, log the error and continue to the next date.
