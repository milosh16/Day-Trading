# SIGNAL Conviction Training Diary

> Auto-generated training log. Each entry shows one historical trading day:
> what we recommended, what actually happened, how accurate we were, and what we learned.
>
> **Started:** 2026-04-03
> **Target:** 500 trials
> **Initial Weights:** catalystClarity: 20.0% | technicalSetup: 15.0% | riskReward: 15.0% | volumeLiquidity: 10.0% | marketAlignment: 15.0% | informationEdge: 15.0% | timingUrgency: 10.0%

---

## Anti-Leakage Protocol v2 (HARD STRUCTURAL SEPARATION)

**Problem:** An LLM generating "pre-market" recommendations for historical dates has training data that encodes what happened. Prompt-based "pretend you don't know" is not a real control.

**Solution:** Three agents with ZERO shared context:

| Agent | Receives | Never Sees | Returns |
|-------|----------|------------|---------|
| **A (Recommender)** | Date + "search for pre-market news only" | Outcomes, actual prices | Symbols, entry prices, targets, stops, conviction scores, thesis with cited sources |
| **B (Verifier + Scorer)** | Symbols + entry prices + date | Thesis, direction, targets | Verified prior-day closes, actual OHLC, factual price data |
| **C (Leakage Auditor)** | Recommendations with thesis text + date | Outcomes | Flag/pass for each trade |

**Hard Rules:**
1. Entry price must be within **2%** of Agent B's verified prior-day close — or trade is **DISCARDED**
2. Any trade flagged by Agent C → scored as **CONTAMINATED**, score = 0
3. Date selection: **70% boring/random days**, 30% event days — boring days are the real test
4. If direction accuracy exceeds **80% across 10+ trials** → trigger contamination review
5. Agent A must cite specific pre-market sources for every thesis

---

## Protocol v1 Baseline (soft controls only — kept for reference)

*The following trials were run with prompt-based "pretend it's pre-market" controls only. These results likely contain hindsight bias and should NOT be used for weight optimization. Kept as baseline comparison.*

### [v1] Trial: 2025-06-16 — Composite: 5.0/100
- 3 trades (LMT long, XOM long, UAL short) — all based on Israel-Iran escalation from Friday
- 0% direction accuracy — Iran de-escalation headline Monday AM reversed all 3 theses
- Key learning: Geopolitical weekend gap risk; correlated thesis risk

### [v1] Trial: 2025-09-22 — Composite: 81.0/100
- 4 trades (KVUE short, GDX long, INFY short, PFE long) — all directionally correct
- 100% direction accuracy — **suspiciously high, likely contaminated by model knowledge**
- Key learning: timingUrgency showed r~0.82 correlation with return magnitude

---

## Protocol v2 Trials Begin Below

