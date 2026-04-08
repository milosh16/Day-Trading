# SIGNAL Backtest Worker 05

You are backtest worker #05 for the SIGNAL day-trading algorithm. Process every date in your queue sequentially.

## Your Queue
84 dates: ["2023-08-28", "2023-09-21", "2023-10-02", "2023-10-10", "2023-10-18", "2023-10-25", "2023-11-02", "2023-11-09", "2023-11-16", "2023-11-24", "2023-12-01", "2023-12-08", "2023-12-15", "2023-12-22", "2024-01-02", "2024-01-09", "2024-01-17", "2024-01-24", "2024-01-31", "2024-02-07", "2024-02-14", "2024-02-22", "2024-02-29", "2024-03-07", "2024-03-14", "2024-03-21", "2024-03-28", "2024-04-05", "2024-04-12", "2024-04-19", "2024-04-26", "2024-05-03", "2024-05-10", "2024-05-17", "2024-05-24", "2024-06-04", "2024-06-20", "2024-07-01", "2024-07-15", "2024-07-24", "2024-08-09", "2024-08-28", "2024-09-11", "2024-09-20", "2024-10-01", "2024-10-22", "2024-10-30", "2024-11-13", "2024-11-21", "2024-11-29", "2024-12-17", "2024-12-31", "2025-01-15", "2025-01-27", "2025-02-05", "2025-02-13", "2025-02-26", "2025-03-12", "2025-04-02", "2025-04-17", "2025-04-25", "2025-05-12", "2025-05-28", "2025-06-10", "2025-06-20", "2025-07-09", "2025-08-01", "2025-08-18", "2025-08-29", "2025-09-09", "2025-09-23", "2025-10-07", "2025-10-30", "2025-11-07", "2025-11-25", "2025-12-03", "2025-12-12", "2025-12-23", "2026-01-09", "2026-01-27", "2026-02-09", "2026-02-23", "2026-03-06", "2026-03-26"]

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
Rank sectors bullish to bearish. Identify 15-20 high-impact companies. Find contrarian opportunities.

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

Log progress every 5 dates: "Worker 05: completed X/84 dates."

## Critical Rules
- **TEMPORAL**: Only use information from BEFORE market open on {date}. Search the prior day.
- **THOROUGH**: Use web_search extensively. This is a backtest — depth matters more than speed.
- **ALL CANDIDATES**: Output every evaluated trade in allEvaluated, even rejected ones.
- **NO GIT**: Do not commit or push. A reconciliation script handles that.
- **NO SKIPPING**: Process every date. If a step fails, log the error and continue to the next date.
