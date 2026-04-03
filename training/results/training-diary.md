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

## V1 Summary (8 trials) — See updated table below Trial 8

---

### [v1] Trial 6: 2024-08-05 (Black Monday / Yen Carry Unwind) — Composite: 81/100

**Context:** July NFP +114K vs +175K expected, unemployment 4.3% (Sahm Rule triggered). BOJ hiked to 0.25% (largest since 2007), yen carry trade unwinding. Intel -26% after catastrophic Q2. Amazon -8.7% on guidance miss. Nikkei crashing. VIX at 38.57.
**Trades:** INTC short (+6.4%), AMZN short (+3.8%), NVDA short (+6.4%)
**Result:** 3/3 direction correct, 0/3 targets hit, avg return +5.53%
**Contamination note:** Black Monday 2024 is a well-known event. 100% short accuracy expected given model knowledge of the crash.
**Key learning:** Even on crash days, targets set 14-15% below entry didn't hit intraday — 1-day targets should be 5-8% max. INTC (highest catalystClarity 88, highest informationEdge 85) and NVDA tied for best return. AMZN had weakest thesis (guidance miss vs structural crisis) = weakest return.

### [v1] Trial 7: 2025-04-07 (Liberation Day Tariff Crash) — Composite: 0/100

**Context:** Trump's "Liberation Day" tariffs announced April 2. S&P 500 crashed -5.97% on April 4 to 5,074. China retaliated with 34% counter-tariffs. VIX above 50. Nasdaq in bear market. Gold pulled back from $3,170 ATH to $3,114 on April 4 due to margin-call liquidation.
**Trades:** GLD long (-3.14%). Two other candidates (NKE long, SH long) discarded for unverifiable entry prices.
**Result:** 0/1 direction correct, 0/1 targets hit, 1/1 stops hit, avg return -3.14%
**Contamination note:** April 7, 2025 tariff crash is in model training data. However, the agent correctly discarded 2 of 3 candidates for unverifiable prices (strict protocol). GLD's thesis (safe-haven bid) was reasonable but wrong — forced margin-call liquidation overwhelmed safe-haven demand.
**Key learning:** In VIX >50 regimes, forced selling overwhelms ALL narratives including safe havens for 1-3 sessions. marketAlignment scored lowest (62) and proved most predictive — when macro alignment is weak, don't fight the liquidation cascade. Single-trade trials produce binary 0 or 100 composite scores — need minimum 3 trades for meaningful scoring.

---

### [v1] Trial 8: 2024-12-18 (FOMC Day + Micron Earnings) — Composite: 45/100

**Context:** FOMC rate decision at 2 PM ET (consensus: 25bp cut). Micron (MU) earnings after close. Alphabet (GOOGL) riding quantum computing "Willow" chip momentum from Dec 10 announcement. Nasdaq at record highs. S&P 500 at record close of ~6,074 on Dec 17.
**Trades:** MU long (-0.68%), NVDA short (+3.40%), GOOGL long (-0.78%)
**Result:** 1/3 direction correct, 1/3 targets hit (NVDA), 0/3 stops hit, avg return +0.65%
**Contamination note:** FOMC December 2024 hawkish cut is well-documented. NVDA short thesis (high-valuation tech vulnerable on FOMC day) was correct and arguably predictable from pre-market info. MU long was a legitimate pre-earnings play that failed due to after-hours guidance miss (unknowable pre-market). GOOGL long was weak — quantum narrative couldn't override FOMC macro pressure.
**Key learning:** MACRO EVENT PRIMACY — on FOMC days, macro outcome dominates individual stock catalysts. marketAlignment was the only differentiating dimension (winner: 72 vs losers: 65). Earnings on FOMC day = compounded binary risk. Don't fight macro events with individual catalysts rated below 80 catalystClarity. Profit factor of 2.33 saved the composite despite only 33% direction accuracy.

---

### [v1] Trial 9: 2025-02-18 (Post-Holiday Reopening + Earnings) — Composite: 68/100

**Context:** Markets reopen after Presidents' Day (Feb 17 closed). Last trading day Feb 14: S&P 500 6,115 (+1.0%), Nasdaq 19,946 (+1.5%). Hot January PPI (+0.5% vs +0.3% est) on Feb 13, but market rallied through it. NVDA earnings due Feb 26 (8 days out). TOL and BMBL reporting earnings after close Feb 18.
**Trades:** NVDA long (-1.30%), TOL short (+6.70%), BMBL short (+17.6%)
**Result:** 2/3 direction correct, 1/3 targets hit (BMBL), 0/3 stops hit, avg return +7.67%, PF 9.36
**Contamination note:** BMBL's +17.6% short return is suspicious — Bumble cratered on guidance miss. However, the thesis cited the ongoing revenue deceleration and CFO departure (pre-market info). TOL short was based on housing affordability headwinds + earnings risk. NVDA long was the only loss — a holiday-reopening momentum play that fizzled.
**Key learning:** EARNINGS CATALYST SHORTS OUTPERFORMED. Both winners were short positions into same-day earnings where fundamentals favored disappointment. marketAlignment was an INVERSE signal — the two winners (TOL 65, BMBL 60) had the LOWEST market alignment because they went against the bullish tape. For earnings-event shorts, broad market alignment is noise; catalystClarity and timingUrgency are the true edges. volumeLiquidity was also inverse — lower liquidity stocks (BMBL 55) delivered the biggest moves.

---

## V1 Summary (9 trials)

| Trial | Date | Type | Composite | Direction% | Avg Return |
|-------|------|------|-----------|------------|------------|
| 1 | 2025-06-16 | Event (geo) | 5 | 0% | -4.17% |
| 2 | 2025-09-22 | Event (mixed) | 81 | 100% | +3.45% |
| 3 | 2024-11-06 | Event (election) | 97 | 100% | +15.91% |
| 4 | 2025-03-10 | Event (recession fear) | 83 | 100% | +6.67% |
| 5 | 2025-01-27 | Event (DeepSeek) | 74 | 100% | +3.0% |
| 6 | 2024-08-05 | Event (Black Monday) | 81 | 100% | +5.53% |
| 7 | 2025-04-07 | Event (tariff crash) | 0 | 0% | -3.14% |
| 8 | 2024-12-18 | Event (FOMC) | 45 | 33% | +0.65% |
| 9 | 2025-02-18 | Mixed (earnings) | 68 | 67% | +7.67% |

**V1 Average: 59.3/100 composite, 67% direction accuracy, +3.95% avg return**

**NOTE:** 9 v1 trials complete. Direction accuracy at 67% — below 80% contamination threshold. v1 results show the algorithm works best on high-conviction, catalyst-specific trades (earnings shorts, binary events) and struggles with momentum-continuation plays (NVDA holiday reopen, GLD safe-haven). Key insight: marketAlignment is INVERSE for earnings-event shorts.

**Cumulative weight signals from v1:**
- marketAlignment is context-dependent: strong predictor on macro days, INVERSE on earnings-event days → needs dynamic weighting
- timingUrgency consistently correlates with return magnitude across all trial types
- volumeLiquidity shows inverse signal for earnings plays (lower liquidity → bigger moves)
- catalystClarity + informationEdge remain the best discriminators within any single trial
- Targets too aggressive for single-session trades → need R:R recalibration (5-8% max day targets)

---

## Protocol v2 Trials (structural separation)

*Three agents with ZERO shared context. Agent A (blind recommender) → Agent B (price verifier, never sees thesis/direction) → Agent C (leakage auditor, never sees outcomes). Hard discard rules enforced.*

**V2 dates in pipeline:** 2024-10-23 (B+C running), 2025-05-14 (B+C running), 2025-08-20 (A running), 2024-09-11 (A running), 2025-03-19 (A running), 2024-07-17 (A running), 2025-01-15 (A running), 2024-06-12 (A running)

---

### [v2] Trial 1: 2025-10-08 (Wednesday — AMD/OpenAI Deal + Comerica Merger Arb)

**Agent A (Blind Recommender):**
- AMD LONG: Entry $205.50 (claimed Oct 7 close $203.71), Target $240, Stop $190, Conviction 80
  - Thesis: Jefferies upgrade to Buy/$300 PT on Oct 7 after AMD/OpenAI multi-year GPU supply deal announced Oct 6. Multiple analyst upgrades ($270-$310 targets). CNBC reported "up 43% this week" pre-market Oct 8.
- CMA LONG (merger arb): Entry $80.50 (claimed Oct 7 close $80.20), Target $82.50, Stop $77.50, Conviction 74
  - Thesis: Fifth Third Bancorp acquiring Comerica for $10.9B all-stock (1.8663x exchange, implied $82.88). 3.3% arb spread.
- DISCARDED: NVDA (unverifiable Oct 7 close), FITB (unverifiable), XLK (unverifiable)

**Agent B (Price Verifier — never saw thesis/direction/targets):**
- AMD: Verified Oct 7 close was **$213.27** (not $203.71 as claimed). $203.71 appears to be the Oct 6 close. Agent A's entry of $205.50 deviates **-3.6%** from verified close → **DISCARD** (exceeds 2% rule).
  - Oct 8 OHLC: Open ~$218, High ~$230+, Close ~$226-230 (up ~6%)
- CMA: Verified Oct 7 close was **$80.20** ✓. Entry $80.50, deviation +0.37% → **VALID**.
  - Oct 8 OHLC: **Data unavailable** — specific Oct 8 price data could not be verified.

**Agent C (Leakage Auditor — never saw outcomes):**
- AMD LONG: **CLEAN** — thesis cites verifiable pre-market sources (Jefferies upgrade Oct 7, Bloomberg, TechCrunch). Momentum continuation after +24% is standard practice, not evidence of foreknowledge.
- CMA LONG: **CLEAN** — textbook merger arb. Direction inherent in the spread, not a prediction.

**V2 Protocol Results:**
| Trade | Agent A | Agent B Entry Check | Agent C Audit | Final Status |
|-------|---------|-------------------|---------------|-------------|
| AMD LONG | Conv 80 | **DISCARD** (-3.6% entry deviation) | CLEAN | **DISCARDED** |
| CMA LONG | Conv 74 | VALID (+0.37%) | CLEAN | Data unavailable for scoring |

**Composite Score: INCOMPLETE** — AMD discarded by Agent B price check. CMA passed all gates but Oct 8 OHLC unavailable. No scoreable trades this trial.

**Key v2 learnings:**
1. **The protocol worked.** Agent B independently caught a $10 entry price error that would have slipped through v1 soft controls. $203.71 was the Oct 6 close, not Oct 7. This is exactly what structural separation is designed to catch.
2. **Price verification is the hardest gate.** Of 5 candidates Agent A considered, 3 were discarded for unverifiable closes, and the one with a "verified" close was wrong. Web search financial data is unreliable for precise close prices.
3. **Merger arb trades are the cleanest** — deal terms are public, direction is mechanical, and entry prices are verifiable from merger announcements. Low contamination risk by design.
4. **Data availability limits scoring.** Even when a trade passes all gates, finding precise OHLC data for scoring is difficult via web search. Future improvement: integrate a financial data API (Polygon.io, Yahoo Finance API) for Agent B.

---

