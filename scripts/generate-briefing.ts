#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Deep Research Intelligence Pipeline
// ============================================================
// 5-Phase daily pipeline using Opus for deep world research:
//
//   Phase 1: DEEP WORLD RESEARCH — Multiple Opus web searches
//            covering geopolitics, macro, corporate, sectors,
//            supply chains, policy, crypto, commodities
//   Phase 2: IMPACT ANALYSIS — Opus identifies which companies
//            and sectors are most affected by the news
//   Phase 3: TRADE CANDIDATE RESEARCH — Opus pulls prices,
//            technicals, and catalysts for top candidates
//   Phase 4: CONVICTION SCORING — Opus scores each trade on
//            confidence, risk/reward, and timing
//   Phase 5: COMPILE & SURFACE — Build briefing + recs for
//            human review
//
// Runs in GitHub Actions. No Vercel dependency.
// Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-briefing.ts
// ============================================================

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  classifyRegime,
  buildRegimePrompt,
  type GlobalSignals,
} from "../src/lib/market-regime";
import {
  computeLeadingIndicators,
  computeStressIndex,
  computeRiskAppetiteIndex,
  buildLeadingIndicatorPrompt,
  type DailySignalRecord,
} from "../src/lib/leading-indicators";

// --- Config ---
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.BRIEFING_MODEL || "claude-opus-4-6";
const DATA_DIR = join(process.cwd(), "public", "data");
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_RETRIES = 3;

if (!API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

// --- Helpers ---

async function callClaude(
  system: string,
  userMessage: string,
  maxTokens = 8192,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  Claude call attempt ${attempt}/${MAX_RETRIES}...`);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          stream: true,
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: [{ type: "web_search_20260209", name: "web_search" }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`  API error ${response.status}: ${err.slice(0, 300)}`);
        if (response.status === 429 || response.status === 529) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`  Rate limited. Waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let text = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              text += event.delta.text;
            }
          } catch { /* skip */ }
        }
      }

      if (!text) throw new Error("Empty response from Claude");
      return text;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const wait = Math.pow(2, attempt) * 1000;
      console.error(`  Error: ${err}. Retrying in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error("Max retries exceeded");
}

function extractJson(text: string, tag: string): string {
  const tagMatch = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (tagMatch) return tagMatch[1].trim();

  // Fallback: find JSON in text
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) return text.slice(jsonStart, jsonEnd + 1);

  throw new Error(`Could not extract JSON (tag: ${tag}) from response`);
}

function writeData(filename: string, data: unknown): void {
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Wrote ${filepath}`);
}

function loadSignalHistory(): DailySignalRecord[] {
  try {
    const historyDir = join(DATA_DIR, "history");
    if (!existsSync(historyDir)) return [];
    const files = readdirSync(historyDir)
      .filter(f => f.startsWith("signals-") && f.endsWith(".json"))
      .sort()
      .slice(-20); // Last 20 days
    return files.map(f => {
      const content = readFileSync(join(historyDir, f), "utf-8");
      return JSON.parse(content) as DailySignalRecord;
    });
  } catch {
    return [];
  }
}

function saveSignalHistory(record: DailySignalRecord): void {
  const historyDir = join(DATA_DIR, "history");
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(
    join(historyDir, `signals-${record.date}.json`),
    JSON.stringify(record, null, 2),
  );
}

// --- Phase Prompts ---

// Phase 1: Deep world research — 6 parallel-ish search domains
const RESEARCH_DOMAINS = [
  {
    name: "Geopolitics & War",
    system: `You are a geopolitical intelligence analyst. Search DEEPLY for current geopolitical events and their market implications. Do NOT give surface-level summaries — dig into second and third-order effects.`,
    query: (date: string) => `Search for ALL major geopolitical developments as of ${date}. Cover:
- Active military conflicts (Iran, Middle East, Ukraine, Taiwan strait)
- Diplomatic developments, ceasefire negotiations, escalation risks
- Sanctions, asset freezes, trade restrictions imposed or lifted
- Oil/energy supply disruption risks from conflicts
- Refugee/humanitarian crises affecting economies
- Military spending announcements, defense contract awards
- Terrorism/security threats to markets or infrastructure
- Key diplomatic meetings, UN votes, NATO developments

For EACH development, analyze: What is the market impact? Which sectors benefit/suffer? Which specific companies are exposed? What is the probability of escalation vs de-escalation?

Return in <research> tags a detailed analysis with specific company/sector callouts.`,
  },
  {
    name: "Macro & Central Banks",
    system: `You are a macroeconomic analyst specializing in central bank policy and economic indicators. Search for the latest data and policy signals.`,
    query: (date: string) => `Search for ALL macroeconomic developments as of ${date}. Cover:
- Federal Reserve: latest statements, Fed speakers scheduled, rate expectations
- ECB, BOJ, BOE, PBOC: any policy changes or signals
- Economic data releases this week: CPI, PPI, NFP, GDP, ISM, retail sales, housing
- Inflation trends: latest readings, market expectations, breakevens
- Employment: jobless claims, ADP, labor market signals
- Consumer spending, confidence, credit card data
- Manufacturing PMIs globally
- Government fiscal policy: spending bills, tax changes, deficit
- Debt ceiling, government shutdown risks
- Treasury auction results, demand trends

For each data point: what does it mean for rates, equities, and specific sectors?

Return in <research> tags a detailed analysis.`,
  },
  {
    name: "Corporate & Earnings",
    system: `You are a corporate intelligence analyst. Search for company-specific news that moves stocks.`,
    query: (date: string) => `Search for ALL major corporate developments as of ${date}. Cover:
- Earnings reports: who reported recently, beats/misses, guidance changes
- Upcoming earnings this week: which companies, consensus expectations
- M&A activity: deals announced, rumors, regulatory approvals/blocks
- CEO/CFO changes, activist investor campaigns, board shakeups
- Product launches, FDA approvals, patent rulings
- Major contract wins/losses (defense, tech, pharma)
- Layoffs, restructuring, cost-cutting announcements
- Insider buying/selling patterns (unusual activity)
- Short interest spikes, short squeeze candidates
- Stock buyback announcements, dividend changes
- Bankruptcies, debt restructuring, credit downgrades
- IPOs, SPACs, secondary offerings this week

For each: which stock, what direction, how significant?

Return in <research> tags a detailed analysis.`,
  },
  {
    name: "Tech & AI & Supply Chain",
    system: `You are a technology sector analyst covering semiconductors, AI, cloud, and global supply chains.`,
    query: (date: string) => `Search for ALL technology and supply chain developments as of ${date}. Cover:
- AI developments: new model releases, enterprise adoption, regulation
- Semiconductor: TSMC, NVIDIA, AMD, Intel — orders, capacity, export controls
- Big Tech: AAPL, MSFT, GOOG, AMZN, META — product news, regulatory pressure
- Cloud spending trends, enterprise IT budgets
- Chip export controls: US-China tech war updates
- Supply chain disruptions: shipping, ports, manufacturing
- Cybersecurity incidents, data breaches
- Antitrust actions against tech companies
- EV/battery: Tesla, BYD, lithium supply
- Renewable energy policy changes, solar/wind developments
- Telecom, 5G/6G developments

For each: specific tickers affected, direction, magnitude of impact.

Return in <research> tags a detailed analysis.`,
  },
  {
    name: "Energy & Commodities",
    system: `You are an energy and commodities analyst covering oil, gas, metals, agriculture, and crypto.`,
    query: (date: string) => `Search for ALL energy, commodities, and crypto developments as of ${date}. Cover:
- Oil: OPEC+ decisions, production cuts/increases, inventory data, Iran sanctions
- Natural gas: storage, LNG exports, weather demand
- Gold/silver: safe haven flows, central bank buying, ETF flows
- Copper, lithium, rare earths: EV demand, mining supply
- Agricultural commodities: weather events, export bans, food inflation
- Uranium: nuclear energy policy, reactor construction
- Crypto: Bitcoin, Ethereum — ETF flows, regulatory news, whale movements
- DeFi developments, stablecoin regulation
- Shipping rates: Baltic Dry Index, container rates, port congestion
- Weather events: hurricanes, droughts, freezes affecting supply

For each: price direction, which companies are most exposed (producers, consumers, ETFs)?

Return in <research> tags a detailed analysis.`,
  },
  {
    name: "Policy & Regulation",
    system: `You are a regulatory and policy analyst covering government actions that impact markets.`,
    query: (date: string) => `Search for ALL regulatory and policy developments as of ${date}. Cover:
- Tariffs: new tariffs proposed/enacted, trade negotiations, retaliatory measures
- SEC enforcement actions, new rules, crypto regulation
- Antitrust: DOJ/FTC actions, merger challenges
- Healthcare policy: drug pricing, Medicare/Medicaid changes
- Environmental regulation: EPA rules, carbon credits, ESG mandates
- Banking regulation: capital requirements, stress tests
- Tax policy: corporate tax changes, capital gains proposals
- Immigration policy affecting labor markets
- State-level regulation: California, Texas, Florida tech/energy laws
- International trade agreements, WTO disputes
- Consumer protection: CFPB actions, data privacy laws

For each: which sectors/companies directly affected, positive or negative?

Return in <research> tags a detailed analysis.`,
  },
];

// Phase 1 also gathers market signals
const SIGNALS_SYSTEM = `You are SIGNAL's market data scanner. Gather comprehensive real-time global market data and return it as structured JSON. Search MULTIPLE times across different sources. Accuracy is critical.`;

const SIGNALS_QUERY = (date: string) => `Gather all global market signals as of ${date}. Search for:
- S&P 500, Nasdaq, Dow, Russell futures
- VIX level and term structure
- Treasury yields (2Y, 10Y, 30Y), yield curve
- Dollar index, EUR/USD, USD/JPY
- Oil (WTI, Brent), gold, copper, natural gas
- International markets (Nikkei, DAX, FTSE, China, EM)
- Credit spreads (HY, IG)
- Market breadth (advance/decline, new highs/lows)
- Sector ETFs (XLK, XLF, XLE, XLV, etc.)
- Sentiment (AAII, CNN Fear/Greed)
- Bitcoin, Ethereum
- Economic calendar this week
- Fed funds futures, SOFR

Return ONLY JSON in <signals> tags with these fields (use 0 for unknown numbers, "" for strings, false for booleans):
<signals>{"spFuturesChange":0,"nasdaqFuturesChange":0,"dowFuturesChange":0,"russellFuturesChange":0,"vixFuturesChange":0,"vix":0,"vixChange":0,"vixTermStructure":"contango","vix9d":0,"vix3m":0,"skewIndex":0,"putCallRatio":0,"spxGammaExposure":"neutral","tenYearYield":0,"tenYearYieldChange":0,"twoYearYield":0,"twoYearYieldChange":0,"thirtyYearYield":0,"threeMonthYield":0,"twoTenSpread":0,"threeMoTenYrSpread":0,"realYield10Y":0,"fedFundsRate":0,"fedFundsExpected":0,"dollarIndex":0,"dollarIndexChange":0,"eurUsd":0,"eurUsdChange":0,"usdJpy":0,"usdJpyChange":0,"usdCny":0,"usdCnyChange":0,"oilWTI":0,"oilChange":0,"brentOil":0,"brentOilChange":0,"natGasChange":0,"goldPrice":0,"goldChange":0,"silverChange":0,"copperChange":0,"ironOreChange":0,"wheatChange":0,"uraniumChange":0,"balticDryIndex":0,"balticDryChange":0,"nikkeiChange":0,"daxChange":0,"ftseChange":0,"shanghaiChange":0,"hangSengChange":0,"kospiChange":0,"emChange":0,"euroStoxx50Change":0,"highYieldSpread":0,"spreadChange":0,"igSpread":0,"igSpreadChange":0,"cdsIndex":0,"tedSpread":0,"mbs30YrSpread":0,"advanceDeclineRatio":0,"newHighsNewLows":0,"percentAbove200DMA":0,"percentAbove50DMA":0,"mcclellanOscillator":0,"xlkChange":0,"xlfChange":0,"xleChange":0,"xlvChange":0,"xlpChange":0,"xluChange":0,"xlreChange":0,"xliChange":0,"xlbChange":0,"xlcChange":0,"xlyChange":0,"smhChange":0,"aaiiBullBear":0,"cnnFearGreed":0,"naaim":0,"marginDebt":"flat","etfFlows":"flat","bitcoinChange":0,"ethereumChange":0,"btcDominance":0,"cryptoTotalMarketCapChange":0,"sofr":0,"repoRate":0,"fedBalanceSheet":"flat","tgaBalance":"flat","hasMajorEconData":false,"econDataType":"","hasEarningsOfNote":false,"earningsNames":"","isOpexWeek":false,"isOpexDay":false,"isMonthEnd":false,"isQuarterEnd":false,"daysToFOMC":0,"daysToNextCPI":0,"daysToNextNFP":0,"isExDividendHeavy":false,"geopoliticalRisk":"low","geopoliticalEvents":"","spConsecutiveUpDays":0,"spConsecutiveDownDays":0,"sp5DayReturn":0,"sp20DayReturn":0,"nasdaqVsRussell5d":0,"sp52WeekRange":0,"spDistanceFrom200DMA":0,"spDistanceFrom50DMA":0}</signals>`;

// --- Main: 5-Phase Deep Research Pipeline ---

async function main() {
  const now = new Date();
  const dateKey = now.toISOString().split("T")[0];
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  mkdirSync(DATA_DIR, { recursive: true });

  console.log(`\n========================================`);
  console.log(`  SIGNAL Deep Research Intelligence`);
  console.log(`========================================`);
  console.log(`Date: ${dateStr} (${dateKey})`);
  console.log(`Model: ${MODEL}`);
  console.log(`Output: ${DATA_DIR}\n`);

  // ============================================================
  // PHASE 1: DEEP WORLD RESEARCH
  // Multiple Opus web searches across 6 domains + market signals
  // ============================================================
  console.log(`\n=== PHASE 1: DEEP WORLD RESEARCH ===`);
  console.log(`Launching ${RESEARCH_DOMAINS.length} research domains + market signals...\n`);

  // Run all research domains sequentially (rate limiting)
  const researchResults: { name: string; content: string }[] = [];
  for (const domain of RESEARCH_DOMAINS) {
    console.log(`  [${domain.name}] Searching...`);
    const t = Date.now();
    try {
      const text = await callClaude(domain.system, domain.query(dateStr));
      const elapsed = ((Date.now() - t) / 1000).toFixed(0);
      // Extract from <research> tags or use full text
      const resMatch = text.match(/<research>([\s\S]*?)<\/research>/);
      const content = resMatch ? resMatch[1].trim() : text;
      researchResults.push({ name: domain.name, content });
      console.log(`  [${domain.name}] Done (${elapsed}s) — ${content.length} chars`);
    } catch (err) {
      console.error(`  [${domain.name}] FAILED: ${err}`);
      researchResults.push({ name: domain.name, content: "Research failed for this domain." });
    }
  }

  // Market signals
  console.log(`\n  [Market Signals] Gathering numerical data...`);
  const sigT = Date.now();
  const signalsText = await callClaude(SIGNALS_SYSTEM, SIGNALS_QUERY(dateStr));
  console.log(`  [Market Signals] Done (${((Date.now() - sigT) / 1000).toFixed(0)}s)`);

  const signalsJson = extractJson(signalsText, "signals");
  const signals: GlobalSignals = JSON.parse(signalsJson);
  const nonDefault = Object.entries(signals).filter(([, v]) => v !== 0 && v !== "" && v !== false && v !== "flat" && v !== "neutral" && v !== "contango" && v !== "low").length;
  console.log(`  Parsed ${nonDefault} non-default signal fields`);

  // Regime classification (local, instant)
  const regime = classifyRegime(signals);
  const stressIndex = computeStressIndex(signals);
  const riskAppetiteIndex = computeRiskAppetiteIndex(signals);
  console.log(`  Regime: ${regime.regime} (${regime.confidence}%) | Stress: ${stressIndex} | Appetite: ${riskAppetiteIndex}`);

  // Leading indicators
  const history = loadSignalHistory().filter(r => r.date !== dateKey);
  const indicators = computeLeadingIndicators(history, signals, dateKey);
  const indicatorPrompt = buildLeadingIndicatorPrompt(indicators);
  const regimePrompt = buildRegimePrompt(regime);

  // Save signals
  saveSignalHistory({ date: dateKey, signals, regime: regime.regime, stressIndex, riskAppetiteIndex });
  writeData("regime-latest.json", { ...regime, globalSignals: signals, regimePrompt, leadingIndicators: indicators, indicatorPrompt });
  writeData(`regime-${dateKey}.json`, { ...regime, globalSignals: signals, regimePrompt, leadingIndicators: indicators, indicatorPrompt });

  // Compile all research into a single document
  const fullResearch = researchResults.map(r => `\n=== ${r.name.toUpperCase()} ===\n${r.content}`).join("\n");
  writeData(`research-${dateKey}.json`, { date: dateKey, generatedAt: now.toISOString(), domains: researchResults });

  console.log(`\n  Phase 1 complete: ${researchResults.length} domains researched`);

  // ============================================================
  // PHASE 2: IMPACT ANALYSIS
  // Opus identifies which companies/sectors are most affected
  // ============================================================
  console.log(`\n=== PHASE 2: IMPACT ANALYSIS ===`);
  console.log(`  Opus analyzing sector & company impact...\n`);

  const impactText = await callClaude(
    `You are SIGNAL's chief strategist — an elite analyst who connects world events to specific stock market opportunities. You have deep knowledge of which companies have exposure to geopolitical events, policy changes, supply chains, and macro shifts.

Your job: take the raw research below and identify the TOP 15-20 companies/ETFs most likely to move significantly today or this week. Think beyond the obvious — find the second and third-order effects that most traders miss.

--- MARKET REGIME ---
${regimePrompt}
Stress: ${stressIndex}/100 | Risk Appetite: ${riskAppetiteIndex}/100
--- END REGIME ---`,
    `Here is today's deep research across 6 domains:

${fullResearch}

Based on ALL of this research, identify:

1. **SECTORS**: Rank the 11 GICS sectors from most bullish to most bearish today, with 1-sentence reasoning for each.

2. **HIGH-IMPACT COMPANIES** (15-20): For each, specify:
   - Ticker and company name
   - Direction (bullish/bearish) and magnitude (1-5 scale, 5 = massive move)
   - The specific catalyst from the research
   - First-order effect (obvious) AND second/third-order effects (less obvious)
   - Timeframe: today, this week, or developing

3. **CONTRARIAN OPPORTUNITIES**: What is everyone focused on (war, obvious news) vs what is being MISSED that could move markets more?

4. **RISK EVENTS**: What could go wrong today? What would cause a reversal?

Return in <json> tags:
<json>{
  "sectorRankings": [{"sector": "Technology", "bias": "bullish", "magnitude": 3, "reasoning": "..."}],
  "highImpactCompanies": [{"ticker": "XYZ", "name": "Company", "direction": "bullish", "magnitude": 4, "catalyst": "...", "firstOrder": "...", "secondOrder": "...", "timeframe": "today"}],
  "contrarian": "What is being missed...",
  "riskEvents": ["Risk 1", "Risk 2"]
}</json>`,
    16384,
  );

  let impactAnalysis: any;
  try {
    impactAnalysis = JSON.parse(extractJson(impactText, "json"));
    console.log(`  Sectors ranked: ${impactAnalysis.sectorRankings?.length || 0}`);
    console.log(`  High-impact companies: ${impactAnalysis.highImpactCompanies?.length || 0}`);
    if (impactAnalysis.highImpactCompanies) {
      for (const c of impactAnalysis.highImpactCompanies.slice(0, 5)) {
        console.log(`    ${c.direction === "bullish" ? "+" : "-"} ${c.ticker} (${c.magnitude}/5): ${c.catalyst?.slice(0, 80)}`);
      }
      if (impactAnalysis.highImpactCompanies.length > 5) console.log(`    ... and ${impactAnalysis.highImpactCompanies.length - 5} more`);
    }
  } catch {
    console.error("  Failed to parse impact analysis — using raw text");
    impactAnalysis = { raw: impactText };
  }

  writeData(`impact-${dateKey}.json`, { date: dateKey, analysis: impactAnalysis });

  // ============================================================
  // PHASE 3: TRADE CANDIDATE RESEARCH
  // Opus pulls prices, technicals, and catalysts for candidates
  // ============================================================
  console.log(`\n=== PHASE 3: TRADE CANDIDATE RESEARCH ===`);

  const candidates = impactAnalysis.highImpactCompanies
    ?.filter((c: any) => c.magnitude >= 3)
    ?.map((c: any) => c.ticker)
    ?.slice(0, 12) || [];

  console.log(`  Researching ${candidates.length} high-conviction candidates: ${candidates.join(", ")}\n`);

  const tradeResearchText = await callClaude(
    `You are SIGNAL's trade research analyst. For each candidate stock, search for current price, recent price action, key support/resistance levels, volume trends, and any additional catalysts. Use web_search to get REAL current data.`,
    `Research these trade candidates for ${dateStr}: ${candidates.join(", ")}

For EACH candidate, search for and provide:
1. Current/last price and recent % change (1d, 5d, 1m)
2. Key support and resistance levels
3. Average daily volume vs recent volume (unusual activity?)
4. Analyst consensus: buy/hold/sell, average price target
5. Options activity: unusual put/call volume?
6. Upcoming catalysts: earnings date, ex-dividend, FDA date, etc.
7. Short interest: days to cover, % float short

Also search for any ADDITIONAL companies that should be on our radar based on today's news that weren't in the initial list.

Return in <json> tags:
<json>{
  "candidates": [
    {
      "ticker": "XYZ",
      "price": 100.00,
      "change1d": -2.5,
      "change5d": -8.0,
      "change1m": -15.0,
      "support": [95, 90],
      "resistance": [105, 110],
      "avgVolume": "5M",
      "recentVolume": "8M",
      "volumeSignal": "elevated",
      "analystConsensus": "buy",
      "priceTarget": 120,
      "shortInterest": "3.5% float",
      "upcomingCatalyst": "Earnings April 15",
      "optionsActivity": "Unusual call buying at 110 strike",
      "additionalNotes": "..."
    }
  ],
  "additionalCandidates": [{"ticker": "NEW", "reasoning": "..."}]
}</json>`,
    16384,
  );

  let tradeResearch: any;
  try {
    tradeResearch = JSON.parse(extractJson(tradeResearchText, "json"));
    console.log(`  Researched ${tradeResearch.candidates?.length || 0} candidates`);
    if (tradeResearch.additionalCandidates?.length) {
      console.log(`  Additional candidates found: ${tradeResearch.additionalCandidates.map((c: any) => c.ticker).join(", ")}`);
    }
  } catch {
    console.error("  Failed to parse trade research — using raw text");
    tradeResearch = { raw: tradeResearchText };
  }

  writeData(`trade-research-${dateKey}.json`, { date: dateKey, research: tradeResearch });

  // ============================================================
  // PHASE 4: CONVICTION SCORING & RECOMMENDATIONS
  // Opus scores each trade on confidence, risk/reward, timing
  // ============================================================
  console.log(`\n=== PHASE 4: CONVICTION SCORING ===`);
  console.log(`  Opus generating final trade recommendations...\n`);

  const convictionText = await callClaude(
    `You are SIGNAL's portfolio manager — the final decision maker. You have all the research, impact analysis, and trade data. Your job is to select the BEST 3-7 trades for today with full conviction scoring.

RULES:
- Day trades: open and close same day
- Max stop loss: 3% for equities, 5% for leveraged/volatile names
- Minimum risk/reward ratio: 1.5:1
- Position sizing: never more than 5% of portfolio per trade
- Regime-aligned: trades must match the current market regime
- EVERY trade must have a specific, time-bound catalyst

--- REGIME ---
${regimePrompt}
Stress: ${stressIndex}/100 | Risk Appetite: ${riskAppetiteIndex}/100
--- END REGIME ---

Score each trade on these conviction dimensions (0-100):
- catalystClarity: How clear and time-bound is the catalyst?
- technicalSetup: Are price levels, volume, momentum supportive?
- riskReward: Is the R:R ratio favorable? Are stops well-placed?
- volumeLiquidity: Can we enter/exit cleanly?
- marketAlignment: Does this trade align with the regime?
- informationEdge: Do we know something the market hasn't priced?
- timingUrgency: Why today specifically?`,
    `Here is everything we know:

RESEARCH SUMMARY:
${researchResults.map(r => `[${r.name}]: ${r.content.slice(0, 500)}`).join("\n\n")}

IMPACT ANALYSIS:
${JSON.stringify(impactAnalysis, null, 2).slice(0, 3000)}

TRADE RESEARCH:
${JSON.stringify(tradeResearch, null, 2).slice(0, 4000)}

Generate your FINAL trade recommendations. Be selective — only recommend trades where conviction is genuinely high. It's better to recommend 2 great trades than 7 mediocre ones. "No trade" is also a valid position if nothing meets our bar.

For each trade, provide:
1. Full entry/target/stop with specific prices
2. Conviction scores across all 7 dimensions
3. Detailed reasoning connecting research → impact → trade
4. What could go wrong (the bear case)
5. Position size recommendation (% of portfolio)

Return in <json> tags:
<json>{
  "marketOutlook": "1-2 sentence overall view",
  "riskLevel": "low" | "moderate" | "elevated" | "high",
  "recommendations": [
    {
      "ticker": "XYZ",
      "direction": "long",
      "entryPrice": 100.00,
      "targetPrice": 104.00,
      "stopPrice": 97.50,
      "riskRewardRatio": 1.6,
      "positionSize": "3% of portfolio",
      "catalyst": "Specific catalyst",
      "reasoning": "Full reasoning chain from research to trade",
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
  "watchlist": [
    {"ticker": "ABC", "trigger": "Buy if price drops to $X", "reasoning": "..."}
  ],
  "avoidList": [
    {"ticker": "DEF", "reasoning": "Looks tempting but..."}
  ]
}</json>`,
    16384,
  );

  let recommendations: any;
  try {
    recommendations = JSON.parse(extractJson(convictionText, "json"));
    console.log(`  Market outlook: ${recommendations.marketOutlook}`);
    console.log(`  Risk level: ${recommendations.riskLevel}`);
    console.log(`  Recommendations: ${recommendations.recommendations?.length || 0}`);
    if (recommendations.recommendations) {
      for (const r of recommendations.recommendations) {
        const avg = r.compositeScore || Math.round(Object.values(r.conviction || {}).reduce((s: number, v: any) => s + v, 0) / 7);
        console.log(`    ${r.direction.toUpperCase()} ${r.ticker} @ $${r.entryPrice} → $${r.targetPrice} (stop $${r.stopPrice}) | R:R ${r.riskRewardRatio} | Conviction: ${avg}/100`);
      }
    }
    if (recommendations.watchlist?.length) {
      console.log(`  Watchlist: ${recommendations.watchlist.map((w: any) => w.ticker).join(", ")}`);
    }
  } catch {
    console.error("  Failed to parse recommendations — using raw text");
    recommendations = { raw: convictionText };
  }

  writeData(`recommendations-${dateKey}.json`, { date: dateKey, recommendations });

  // ============================================================
  // PHASE 5: COMPILE & SURFACE
  // Build the final briefing with all context for human review
  // ============================================================
  console.log(`\n=== PHASE 5: COMPILE & SURFACE ===`);

  const storedBriefing = {
    id: `briefing-${dateKey}-${Date.now()}`,
    date: dateKey,
    generatedAt: now.toISOString(),
    model: MODEL,
    summary: recommendations.marketOutlook || "Briefing generated.",
    marketCondition: recommendations.riskLevel === "high" ? "volatile" :
      recommendations.riskLevel === "elevated" ? "volatile" :
      regime.regime === "risk-on" ? "bullish" :
      regime.regime === "risk-off" ? "bearish" : "neutral",
    sections: [
      // Build sections from research
      ...researchResults.map(r => ({
        title: r.name,
        content: r.content.slice(0, 2000),
        importance: (r.name === "Geopolitics & War" || r.name === "Macro & Central Banks") ? "high" as const : "medium" as const,
      })),
      // Impact analysis section
      {
        title: "Sector & Company Impact Analysis",
        content: impactAnalysis.contrarian
          ? `Contrarian view: ${impactAnalysis.contrarian}\n\nTop impacts: ${(impactAnalysis.highImpactCompanies || []).slice(0, 8).map((c: any) => `${c.ticker} (${c.direction}, ${c.magnitude}/5): ${c.catalyst}`).join("; ")}`
          : "Impact analysis completed — see recommendations.",
        importance: "high" as const,
      },
      // Risk events
      {
        title: "Risk Events & What Could Go Wrong",
        content: (impactAnalysis.riskEvents || []).join("\n- ") || "No major risk events identified.",
        importance: "high" as const,
      },
    ],
    scenarios: (recommendations.recommendations || []).map((r: any) => ({
      event: `${r.direction.toUpperCase()} ${r.ticker} @ $${r.entryPrice}`,
      scenarios: [
        { condition: `Price reaches target $${r.targetPrice}`, implication: `+${((r.targetPrice - r.entryPrice) / r.entryPrice * 100 * (r.direction === "short" ? -1 : 1)).toFixed(1)}% gain`, trade: r.reasoning },
        { condition: `Price hits stop $${r.stopPrice}`, implication: r.bearCase || "Position closed at loss", trade: `Stop loss at ${((r.stopPrice - r.entryPrice) / r.entryPrice * 100).toFixed(1)}%` },
      ],
    })),
    regimeType: regime.regime,
    regimeConfidence: regime.confidence,
    // Extended data for the app
    researchDomains: researchResults.map(r => ({ name: r.name, length: r.content.length })),
    impactAnalysis: {
      sectorRankings: impactAnalysis.sectorRankings,
      topCompanies: (impactAnalysis.highImpactCompanies || []).slice(0, 10),
    },
    recommendations: recommendations.recommendations || [],
    watchlist: recommendations.watchlist || [],
    avoidList: recommendations.avoidList || [],
  };

  writeData("briefing-latest.json", storedBriefing);
  writeData(`briefing-${dateKey}.json`, storedBriefing);

  console.log(`\n========================================`);
  console.log(`  PIPELINE COMPLETE`);
  console.log(`========================================`);
  console.log(`  Research domains: ${researchResults.length}`);
  console.log(`  Regime: ${regime.regime} (${regime.confidence}%)`);
  console.log(`  Stress: ${stressIndex}/100 | Appetite: ${riskAppetiteIndex}/100`);
  console.log(`  High-impact companies: ${impactAnalysis.highImpactCompanies?.length || 0}`);
  console.log(`  Trade recommendations: ${recommendations.recommendations?.length || 0}`);
  console.log(`  Watchlist: ${recommendations.watchlist?.length || 0}`);
  console.log(`  Output: ${DATA_DIR}/briefing-${dateKey}.json`);
  if (indicators.patterns.length > 0) {
    console.log(`  Patterns: ${indicators.patterns.map(p => `[${p.severity}] ${p.name}`).join(", ")}`);
  }
  console.log(`\n  Ready for your review.`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message || err}`);
  process.exit(1);
});
