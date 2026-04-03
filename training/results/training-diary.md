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

## Protocol v1 Trials (soft controls only — baseline reference)

*These trials used single-agent prompt-based controls. Results likely contain hindsight bias. Kept as baseline for comparison with v2 structural separation results.*

---

### [v1] Trial 1: 2025-06-16 — Composite: 5/100

**Context:** Israel-Iran escalation Friday Jun 13. Oil +7.3%. Defense stocks up. S&P -1.1%.
**Trades:** LMT long, XOM long, UAL short — all based on escalation thesis.
**Result:** 0/3 direction correct. Iran opened to negotiations Monday AM → all 3 theses reversed.
**Key learning:** Geopolitical weekend gap risk. Correlated thesis = correlated failure. marketAlignment (55-65) was the warning signal but wasn't weighted enough to block.

---

### [v1] Trial 2: 2025-09-22 — Composite: 81/100

**Context:** FOMC cut 25bp Sep 17. Gold records. Trump H-1B fee effective Sep 21. Trump Tylenol-autism announcement Sunday night.
**Trades:** KVUE short (+6.97%), GDX long (+2.55%), INFY short (+3.54%), PFE long (+0.73%)
**Result:** 4/4 direction correct, 0/4 targets hit, avg return +3.45%
**Contamination note:** 100% direction accuracy on 4 trades — possible model knowledge. However, all catalysts were high-signal pre-market events with clear directional implications.
**Key learning:** timingUrgency showed r~0.82 correlation with return magnitude. Targets too aggressive for single-session trades.

---

### [v1] Trial 3: 2024-11-06 — Composite: 97/100

**Context:** Trump elected overnight. Republican sweep. S&P futures +2.2%. Bitcoin $75K+.
**Trades:** JPM long (+11.5%), GS long (+8.5%), TSLA long (+14.0%), COIN long (+29.6%)
**Result:** 4/4 direction, 4/4 targets hit, avg return +15.91%
**Contamination note:** Election day is the strongest binary catalyst — direction was obvious pre-market. Score is real but not generalizable to normal days. DJT correctly excluded (scored 66.9, below 72 threshold) — would have underperformed.
**Key learning:** Binary catalyst days: catalystClarity and timingUrgency are dominant. technicalSetup becomes irrelevant.

---

### [v1] Trial 4: 2025-03-10 — Composite: 83/100

**Context:** Trump refused to rule out recession on Fox News Sunday. Tariffs on Canada/Mexico/China in effect. Feb jobs miss. Nasdaq in correction.
**Trades:** TSLA short (+14.3%), GLD long (+0.9%), ORCL short (+4.8%)
**Result:** 3/3 direction correct, 1/3 target hit, avg return +6.67%
**Contamination note:** TSLA crash was a widely-known event. Model likely had strong priors. GLD and ORCL less obviously contaminated.
**Key learning:** informationEdge discriminated within winners (TSLA 78→+14.3% vs ORCL 65→+4.8%). catalystClarity + technicalSetup strongest for magnitude.

---

### [v1] Trial 5: 2025-01-27 — Composite: 74/100

**Context:** DeepSeek AI model released weekend of Jan 25-26. Chinese startup matching/beating US AI at fraction of cost. AI stocks in panic pre-market.
**Trades:** NVDA short (+7.8%), AVGO short (+4.8%), AMD short (-0.5%), SMCI short (~0%)
**Result:** 4/4 direction correct, 1/4 target hit (NVDA), 0/4 stops hit. Win rate 50%.
**Contamination note:** DeepSeek crash was major event in model training data. All-short portfolio shows directional contamination likely.
**Key learning:** Even on crash days, not all shorts work equally. NVDA (highest catalystClarity: 92, highest informationEdge: 85) was the best trade. SMCI/AMD had weaker fundamentals for the thesis. Quality of catalyst matters more than sector alignment.

---

## V1 Summary (5 trials)

| Trial | Date | Type | Composite | Direction% | Avg Return |
|-------|------|------|-----------|------------|------------|
| 1 | 2025-06-16 | Event (geo) | 5 | 0% | -4.17% |
| 2 | 2025-09-22 | Event (mixed) | 81 | 100% | +3.45% |
| 3 | 2024-11-06 | Event (election) | 97 | 100% | +15.91% |
| 4 | 2025-03-10 | Event (recession fear) | 83 | 100% | +6.67% |
| 5 | 2025-01-27 | Event (DeepSeek) | 74 | 100% | +3.0% |

**V1 Average: 68/100 composite, 80% direction accuracy, +4.97% avg return**

**CRITICAL NOTE:** 80% direction accuracy across 5 trials exceeds the 80% contamination threshold. These results are unreliable for weight optimization. V2 structural separation required.

**Preliminary weight signals (to be validated by v2):**
- timingUrgency consistently correlated with return magnitude → candidate for weight increase
- volumeLiquidity showed no predictive power → candidate for weight decrease
- catalystClarity + informationEdge discriminated best within winners → maintain or increase
- technicalSetup irrelevant on binary catalyst days but important filter on normal days → keep but consider dynamic weighting
- Targets consistently too aggressive for single-session trades → need R:R recalibration

---

## Protocol v2 Trials (structural separation)

*Pending — Agent A results being compiled. Agent B and C to follow for each date.*

---

