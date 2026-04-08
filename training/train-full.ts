#!/usr/bin/env npx tsx
// ============================================================
// SIGNAL - Full-Depth Training Engine
// ============================================================
// Runs the COMPLETE production intelligence pipeline for a
// historical date, producing briefings indistinguishable from
// daily production briefings — plus outcome scoring.
//
//   Phase 1: Composite Signals (Yahoo + FRED + Calendar)
//   Phase 2: Regime Classification + Stress + Risk Appetite
//   Phase 3: Leading Indicators (if history exists)
//   Phase 4: 6-Domain Deep Research (Opus + web search)
//   Phase 5: Impact + Trade Research + Conviction (Opus + web search)
//   Phase 6: Anti-Leakage Verification
//   Phase 7: Outcome Scoring (Yahoo Finance, deterministic)
//   Phase 8: Write Output (briefing + training record)
//
// Runs ONE trial per invocation. Designed for GitHub Actions.
// Usage: ANTHROPIC_API_KEY=sk-... npx tsx training/train-full.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const TRAINING_DATA_DIR = path.join(DATA_DIR, "training");

import { scoreRecommendations, calculateScores, analyzeDimensions } from "./lib/scorer.ts";
import { getRandomTradingDays, getAllTradingDays } from "./lib/dates.ts";
import { verifyRecommendations } from "./lib/anti-leakage.ts";
import { classifyRegime, buildRegimePrompt } from "../src/lib/market-regime.ts";
import type { GlobalSignals, RegimeAssessment } from "../src/lib/market-regime.ts";
import {
  computeLeadingIndicators,
  computeStressIndex,
  computeRiskAppetiteIndex,
  buildLeadingIndicatorPrompt,
  type DailySignalRecord,
} from "../src/lib/leading-indicators.ts";
import { fetchCompositeSignals } from "./lib/composite-signals.ts";
import { calculateCompositeScore } from "./lib/scorer-v2.ts";
import { DEFAULT_WEIGHTS } from "./lib/optimizer.ts";
import { createDefaultTable } from "./lib/regime-weights.ts";
import { loadRegistry, getActivePromptFragments } from "./lib/insight-registry.ts";
import type {
  TradeRecommendation, TrialResult, TrainingState, ConvictionWeights,
  TrainingRegime,
} from "./lib/types.ts";

// --- Config ---
const API_KEY = process.env.ANTHROPIC_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY;
const MODEL = process.env.BRIEFING_MODEL || "claude-opus-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_RETRIES = 5;
const TOTAL_TRIALS = parseInt(process.env.TOTAL_TRIALS || "100", 10);
const STATE_FILE = path.join(__dirname, "results", "training-state.json");
const LOG_FILE = path.join(__dirname, "results", "training-full-log.txt");
const START_DATE = "2024-06-01";
const END_DATE = "2026-03-28";
const FULL_DEPTH_SEED = 100; // Different from lightweight (seed=42)

if (!API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

// --- Logging ---
function log(msg: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// --- State Management ---
function loadState(): TrainingState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return {
    currentTrial: 0,
    totalTrials: 500,
    weights: { ...DEFAULT_WEIGHTS },
    results: [],
    bestScore: 0,
    bestWeights: { ...DEFAULT_WEIGHTS },
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    totalTokensUsed: 0,
    weightHistory: [],
    regimeWeightTable: createDefaultTable(),
    dateSequence: [],
    completedDates: [],
    fullDepthCurrentTrial: 0,
    fullDepthTotalTrials: TOTAL_TRIALS,
    fullDepthDateSequence: [],
    fullDepthCompletedDates: [],
  };
}

function saveState(state: TrainingState): void {
  state.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Graceful shutdown
let currentState: TrainingState | null = null;
function handleShutdown(signal: string): void {
  console.log(`\nReceived ${signal} — saving state and exiting gracefully...`);
  if (currentState) {
    saveState(currentState);
    console.log(`State saved at full-depth trial ${currentState.fullDepthCurrentTrial}. Will resume on next run.`);
  }
  process.exit(0);
}
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

function commitAndPush(message: string): void {
  const branch = process.env.GITHUB_REF_NAME || "main";
  try {
    execSync(
      `git add training/results/ public/data/training/ public/data/briefing-*.json 2>/dev/null; ` +
      `git diff --staged --quiet || ` +
      `(git commit -m "${message}" && ` +
      `git pull origin ${branch} --rebase 2>/dev/null; ` +
      `git push origin HEAD:${branch})`,
      { stdio: "pipe", timeout: 120000 },
    );
  } catch (e) {
    console.error(`Git commit/push failed: ${e}`);
  }
}

// --- Claude API (direct, Opus, SSE streaming, web_search) ---
// Copied from generate-briefing.ts — NOT from training/lib/api.ts

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
          await new Promise((r) => setTimeout(r, wait));
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
          } catch {
            /* skip */
          }
        }
      }

      if (!text) throw new Error("Empty response from Claude");
      return text;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const wait = Math.pow(2, attempt) * 3000;
      const msg = err instanceof Error ? `${err.message} (cause: ${err.cause || 'none'})` : String(err);
      console.error(`  Error [attempt ${attempt}/${MAX_RETRIES}]: ${msg}. Retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Research Domains (from generate-briefing.ts) ---

const RESEARCH_DOMAINS = [
  {
    name: "Geopolitics & War",
    system: `You are a geopolitical intelligence analyst. Search DEEPLY for current geopolitical events and their market implications. Do NOT give surface-level summaries — dig into second and third-order effects.`,
    query: (date: string) =>
      `Search for ALL major geopolitical developments as of ${date}. Cover:
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
    query: (date: string) =>
      `Search for ALL macroeconomic developments as of ${date}. Cover:
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
    query: (date: string) =>
      `Search for ALL major corporate developments as of ${date}. Cover:
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
    query: (date: string) =>
      `Search for ALL technology and supply chain developments as of ${date}. Cover:
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
    query: (date: string) =>
      `Search for ALL energy, commodities, and crypto developments as of ${date}. Cover:
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
    query: (date: string) =>
      `Search for ALL regulatory and policy developments as of ${date}. Cover:
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

// --- Temporal Adaptation for Historical Research ---

function adaptResearchDomain(
  domain: { name: string; system: string; query: (date: string) => string },
  historicalDate: string,
): { system: string; query: string } {
  const tradingDate = new Date(historicalDate + "T12:00:00Z");
  const priorDate = new Date(tradingDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) {
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  }
  const priorStr = priorDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const dateStr = tradingDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    system:
      domain.system +
      `\n\nTEMPORAL CONSTRAINT: You are researching as of ${priorStr}. Do NOT include any information from ${dateStr} or later. Search for "${priorDate.toISOString().split("T")[0]} ${domain.name.toLowerCase()}" specifically.`,
    query: domain.query(priorStr),
  };
}

// --- Signal History (for leading indicators) ---

function loadSignalHistory(): DailySignalRecord[] {
  try {
    const historyDir = path.join(DATA_DIR, "history");
    if (!fs.existsSync(historyDir)) return [];
    const files = fs
      .readdirSync(historyDir)
      .filter((f) => f.startsWith("signals-") && f.endsWith(".json"))
      .sort()
      .slice(-20);
    return files.map((f) => {
      const content = fs.readFileSync(path.join(historyDir, f), "utf-8");
      return JSON.parse(content) as DailySignalRecord;
    });
  } catch {
    return [];
  }
}

// --- Main Pipeline ---

async function runFullDepthTrial(): Promise<void> {
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });

  log("=== SIGNAL Full-Depth Training Engine ===");
  log(`Model: ${MODEL}`);

  const state = loadState();
  currentState = state;

  // Initialize full-depth counters if needed
  if (state.fullDepthCurrentTrial === undefined) state.fullDepthCurrentTrial = 0;
  if (state.fullDepthTotalTrials === undefined) state.fullDepthTotalTrials = TOTAL_TRIALS;
  state.fullDepthTotalTrials = TOTAL_TRIALS; // Allow override via env

  // Generate date sequence: last 45 calendar days guaranteed + random fill
  if (!state.fullDepthDateSequence || state.fullDepthDateSequence.length === 0) {
    // Recent dates: every trading day in the last 45 calendar days
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 45);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const todayStr = today.toISOString().split("T")[0];
    const recentDays = getAllTradingDays(cutoffStr, END_DATE < todayStr ? END_DATE : todayStr);

    // Random fill: remaining slots from the broader range, excluding recent days
    const recentSet = new Set(recentDays);
    const remainingSlots = Math.max(0, TOTAL_TRIALS - recentDays.length);
    const randomPool = getRandomTradingDays(remainingSlots + 50, START_DATE, END_DATE, FULL_DEPTH_SEED)
      .filter(d => !recentSet.has(d))
      .slice(0, remainingSlots);

    // Combine: recent days first (chronological), then random days (shuffled)
    state.fullDepthDateSequence = [...recentDays, ...randomPool];
    state.fullDepthCompletedDates = state.fullDepthCompletedDates || [];
    saveState(state);
    log(`Generated full-depth date schedule: ${recentDays.length} recent + ${randomPool.length} random = ${state.fullDepthDateSequence.length} dates`);
  }

  if (state.fullDepthCurrentTrial! >= state.fullDepthTotalTrials!) {
    log("All full-depth trials complete!");
    return;
  }

  const trialNum = state.fullDepthCurrentTrial! + 1;
  const date = state.fullDepthDateSequence![state.fullDepthCurrentTrial!];
  const dateKey = date;
  const tradingDate = new Date(date + "T12:00:00Z");
  const dateStr = tradingDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  log(`\nFull-depth trial ${trialNum}/${state.fullDepthTotalTrials} for ${date} (${dateStr})`);

  // ============================================================
  // PHASE 1: COMPOSITE SIGNALS (Yahoo + FRED + Calendar)
  // ============================================================
  log(`\n  Phase 1: Composite Signals (Yahoo + FRED + Calendar)...`);
  const sigT = Date.now();
  const compositeResult = await fetchCompositeSignals(date);
  const signals: GlobalSignals = compositeResult.signals;
  log(`  Signals: ${compositeResult.fieldsPopulated} fields populated (${((Date.now() - sigT) / 1000).toFixed(0)}s)`);
  if (compositeResult.warnings.length > 0) {
    for (const w of compositeResult.warnings) log(`    WARNING: ${w}`);
  }

  // ============================================================
  // PHASE 2: REGIME CLASSIFICATION
  // ============================================================
  log(`  Phase 2: Regime Classification...`);
  const regimeResult: RegimeAssessment = classifyRegime(signals);
  const stressIndex = computeStressIndex(signals);
  const riskAppetiteIndex = computeRiskAppetiteIndex(signals);
  const regimePrompt = buildRegimePrompt(regimeResult);
  const regime: TrainingRegime = {
    regime: regimeResult.regime,
    confidence: regimeResult.confidence,
    directionalBias: String(regimeResult.directionalBias),
    volatilityRegime: regimeResult.volatilityRegime,
    stressIndex,
    riskAppetiteIndex,
    sectorTilts: Object.fromEntries(regimeResult.sectorTilts.map((t) => [t.sector, t.bias])),
  };
  log(`  Regime: ${regime.regime} (${regime.confidence}%) | Stress: ${stressIndex} | Appetite: ${riskAppetiteIndex}`);

  // ============================================================
  // PHASE 3: LEADING INDICATORS
  // ============================================================
  log(`  Phase 3: Leading Indicators...`);
  const history = loadSignalHistory().filter((r) => r.date !== dateKey);
  const indicators = computeLeadingIndicators(history, signals, dateKey);
  const indicatorPrompt = buildLeadingIndicatorPrompt(indicators);
  log(`  Leading indicators: ${indicators.patterns.length} patterns detected`);

  // Rate limit gap before research call
  await sleep(6000);

  // ============================================================
  // PHASE 4: 6-DOMAIN DEEP RESEARCH (adapted for historical date)
  // ============================================================
  log(`\n  Phase 4: 6-Domain Deep Research (Opus + web search)...`);
  const researchT = Date.now();

  // Build adapted prompts with temporal constraints
  const adaptedDomains = RESEARCH_DOMAINS.map((d) => adaptResearchDomain(d, date));
  const allDomainsPrompt = RESEARCH_DOMAINS.map((d, i) => {
    const adapted = adaptedDomains[i];
    return `## DOMAIN ${i + 1}: ${d.name.toUpperCase()}\n${adapted.query}`;
  }).join("\n\n---\n\n");

  const priorDate = new Date(tradingDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  while (priorDate.getUTCDay() === 0 || priorDate.getUTCDay() === 6) {
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  }
  const priorDateDisplay = priorDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const megaResearchText = await callClaude(
    `You are an elite multi-domain intelligence analyst. You must research ALL of the following domains using web_search extensively. Search DEEPLY — not surface-level summaries. For each domain, find specific companies, tickers, and quantify impact where possible. Use web_search multiple times across different queries to be thorough.

TEMPORAL CONSTRAINT: You are researching as of ${priorDateDisplay}. Only include information that was available BEFORE market open on ${dateStr}. Search for "${priorDate.toISOString().split("T")[0]}" dates specifically, NOT "${dateKey}".`,
    `Research ALL of the following 6 domains as of ${priorDateDisplay} (for trading on ${dateStr}). Use web_search for EACH domain. Be thorough and specific.

${allDomainsPrompt}

Return your findings in this EXACT format — one <domain> block per domain:

<domain name="Geopolitics & War">
Your detailed findings here...
</domain>

<domain name="Macro & Central Banks">
Your detailed findings here...
</domain>

<domain name="Corporate & Earnings">
Your detailed findings here...
</domain>

<domain name="Tech & AI & Supply Chain">
Your detailed findings here...
</domain>

<domain name="Energy & Commodities">
Your detailed findings here...
</domain>

<domain name="Policy & Regulation">
Your detailed findings here...
</domain>`,
    32000,
  );
  log(`  Research done (${((Date.now() - researchT) / 1000).toFixed(0)}s) — ${megaResearchText.length} chars`);

  // Parse domain results
  const researchResults: { name: string; content: string }[] = [];
  for (const domain of RESEARCH_DOMAINS) {
    const domainMatch = megaResearchText.match(
      new RegExp(`<domain name="${domain.name}">([\\s\\S]*?)</domain>`),
    );
    const content = domainMatch ? domainMatch[1].trim() : "";
    researchResults.push({ name: domain.name, content: content || "Domain not parsed from mega-research." });
    log(`    ${domain.name}: ${content.length} chars`);
  }

  const fullResearch = researchResults.map((r) => `\n=== ${r.name.toUpperCase()} ===\n${r.content}`).join("\n");

  // Rate limit gap before impact call
  await sleep(6000);

  // ============================================================
  // PHASE 5: IMPACT + TRADE RESEARCH + CONVICTION
  // ============================================================
  log(`\n  Phase 5: Impact Analysis + Trade Research + Conviction...`);

  // Build training insights context
  const trainingInsights = (() => {
    try {
      const registry = loadRegistry();
      const convictionInsights = getActivePromptFragments(registry, "conviction_prompt");
      const tradeInsights = getActivePromptFragments(registry, "trade_selection");
      const combined = [convictionInsights, tradeInsights].filter(Boolean).join("\n");
      return combined
        ? `\nTRAINING-DERIVED INSIGHTS (from ${registry.insights.filter((i) => i.active).length} active insights):\n${combined}\n`
        : "";
    } catch {
      return "";
    }
  })();

  const phase5T = Date.now();
  const combinedText = await callClaude(
    `You are SIGNAL — an elite trading intelligence system that combines world-class research analysis with portfolio management. You will perform THREE tasks in sequence:

1. IMPACT ANALYSIS: Connect world events to specific companies/sectors
2. TRADE RESEARCH: Use web_search to get current prices, technicals, and data for top candidates
3. CONVICTION SCORING: Score and recommend the best 3-7 day trades

TEMPORAL CONSTRAINT: You are generating recommendations for trading on ${dateStr}. Only use information available BEFORE market open on ${dateStr}. When searching for prices, search for "${priorDate.toISOString().split("T")[0]} stock price" specifically.

TRADING RULES:
- Day trades: open and close same day
- Max stop loss: 3% for equities, 5% for leveraged/volatile names
- Minimum risk/reward ratio: 1.5:1
- Position sizing: never more than 5% of portfolio per trade
- Regime-aligned: trades must match the current market regime
- EVERY trade must have a specific, time-bound catalyst

--- MARKET REGIME ---
${regimePrompt}
Stress: ${stressIndex}/100 | Risk Appetite: ${riskAppetiteIndex}/100
${indicatorPrompt}
--- END REGIME ---
${trainingInsights}
Score each trade on these conviction dimensions (0-100):
- catalystClarity: How clear and time-bound is the catalyst?
- technicalSetup: Are price levels, volume, momentum supportive?
- riskReward: Is the R:R ratio favorable? Are stops well-placed?
- volumeLiquidity: Can we enter/exit cleanly?
- marketAlignment: Does this trade align with the regime?
- informationEdge: Do we know something the market hasn't priced?
- timingUrgency: Why today specifically?`,
    `Here is the deep research across 6 domains for ${dateStr}:

${fullResearch}

Now perform all 3 tasks:

**TASK 1 — IMPACT ANALYSIS:**
- Rank the 11 GICS sectors from most bullish to most bearish today
- Identify the TOP 15-20 companies/ETFs most likely to move significantly
- Find contrarian opportunities: what is everyone focused on vs what is being MISSED
- List risk events that could cause reversals

**TASK 2 — TRADE RESEARCH:**
For the top 10-12 highest-conviction candidates from Task 1, use web_search to find:
- Current/last price and recent % change (1d, 5d)
- Key support and resistance levels
- Analyst consensus and price targets
- Any unusual options or volume activity
- Upcoming catalysts (earnings, ex-div, FDA, etc.)

**TASK 3 — CONVICTION SCORING (ALL candidates):**
Score EVERY candidate from Task 2 (all 10-12) with full conviction dimensions and entry/target/stop.
Output ALL of them in "allEvaluated" — even the ones you would NOT recommend trading.
Then separately list ONLY the trades that pass your conviction gate in "recommendations".

CONVICTION GATE: A trade needs a composite conviction score of 70+ to be recommended.
On range-bound or low-conviction days, it is COMPLETELY VALID to recommend ZERO trades.
2 great trades > 7 mediocre ones. Sitting out preserves capital.

Return ALL results in a single <json> block:
<json>{
  "sectorRankings": [{"sector": "Technology", "bias": "bullish", "magnitude": 3, "reasoning": "..."}],
  "highImpactCompanies": [{"ticker": "XYZ", "name": "Company", "direction": "bullish", "magnitude": 4, "catalyst": "...", "firstOrder": "...", "secondOrder": "...", "timeframe": "today"}],
  "contrarian": "What is being missed...",
  "riskEvents": ["Risk 1", "Risk 2"],
  "tradeResearch": [{"ticker": "XYZ", "price": 100.00, "change1d": -2.5, "change5d": -8.0, "support": [95, 90], "resistance": [105, 110], "analystConsensus": "buy", "priceTarget": 120, "upcomingCatalyst": "...", "optionsActivity": "..."}],
  "marketOutlook": "1-2 sentence overall view",
  "riskLevel": "low|moderate|elevated|high",
  "allEvaluated": [
    {
      "ticker": "XYZ",
      "direction": "long",
      "entryPrice": 100.00,
      "targetPrice": 104.00,
      "stopPrice": 97.50,
      "riskRewardRatio": 1.6,
      "positionSize": "3% of portfolio",
      "catalyst": "Specific catalyst",
      "reasoning": "Full reasoning chain",
      "bearCase": "What could go wrong",
      "recommended": true,
      "rejectionReason": null,
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
    },
    {
      "ticker": "ABC",
      "direction": "long",
      "entryPrice": 50.00,
      "targetPrice": 52.00,
      "stopPrice": 48.50,
      "riskRewardRatio": 1.3,
      "positionSize": "2% of portfolio",
      "catalyst": "Weak catalyst",
      "reasoning": "Reasoning chain",
      "bearCase": "What could go wrong",
      "recommended": false,
      "rejectionReason": "Low catalyst clarity, weak R:R in range-bound regime",
      "conviction": {
        "catalystClarity": 40,
        "technicalSetup": 55,
        "riskReward": 50,
        "volumeLiquidity": 80,
        "marketAlignment": 35,
        "informationEdge": 30,
        "timingUrgency": 45
      },
      "compositeScore": 48
    }
  ],
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
      "reasoning": "Full reasoning chain",
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
  "watchlist": [{"ticker": "ABC", "trigger": "Buy if price drops to $X", "reasoning": "..."}],
  "avoidList": [{"ticker": "DEF", "reasoning": "Looks tempting but..."}]
}</json>`,
    32000,
  );

  log(`  Phase 5 done (${((Date.now() - phase5T) / 1000).toFixed(0)}s) — ${combinedText.length} chars`);

  // Parse combined results
  let impactAnalysis: any = {};
  let tradeResearch: any = {};
  let recommendations: any = {};
  try {
    const parsed = JSON.parse(extractJson(combinedText, "json"));
    impactAnalysis = {
      sectorRankings: parsed.sectorRankings,
      highImpactCompanies: parsed.highImpactCompanies,
      contrarian: parsed.contrarian,
      riskEvents: parsed.riskEvents,
    };
    tradeResearch = { candidates: parsed.tradeResearch };
    recommendations = {
      marketOutlook: parsed.marketOutlook,
      riskLevel: parsed.riskLevel,
      allEvaluated: parsed.allEvaluated || [],
      recommendations: parsed.recommendations,
      watchlist: parsed.watchlist,
      avoidList: parsed.avoidList,
    };

    log(`  Sectors ranked: ${impactAnalysis.sectorRankings?.length || 0}`);
    log(`  High-impact companies: ${impactAnalysis.highImpactCompanies?.length || 0}`);
    log(`  Market outlook: ${recommendations.marketOutlook}`);
    log(`  All evaluated: ${recommendations.allEvaluated?.length || 0}`);
    log(`  Recommended (passed gate): ${recommendations.recommendations?.length || 0}`);
    if (recommendations.recommendations) {
      for (const r of recommendations.recommendations) {
        const avg =
          r.compositeScore ||
          Math.round(Object.values(r.conviction || {}).reduce((s: number, v: any) => s + v, 0) / 7);
        log(
          `    ${r.direction.toUpperCase()} ${r.ticker} @ $${r.entryPrice} -> $${r.targetPrice} (stop $${r.stopPrice}) | Conviction: ${avg}/100`,
        );
      }
    }
  } catch (e) {
    log(`  Failed to parse combined results: ${e}`);
    impactAnalysis = { raw: combinedText };
    recommendations = { raw: combinedText };
    tradeResearch = { raw: combinedText };
  }

  // Convert recommendations to TradeRecommendation format
  const tradeRecs: TradeRecommendation[] = (recommendations.recommendations || []).map((r: any) => ({
    symbol: r.ticker,
    direction: r.direction as "long" | "short",
    entryPrice: r.entryPrice,
    targetPrice: r.targetPrice,
    stopLoss: r.stopPrice,
    thesis: r.reasoning || "",
    catalyst: r.catalyst || "",
    conviction: {
      catalystClarity: { score: r.conviction?.catalystClarity || 50, reasoning: "" },
      technicalSetup: { score: r.conviction?.technicalSetup || 50, reasoning: "" },
      riskReward: { score: r.conviction?.riskReward || 50, reasoning: "" },
      volumeLiquidity: { score: r.conviction?.volumeLiquidity || 50, reasoning: "" },
      marketAlignment: { score: r.conviction?.marketAlignment || 50, reasoning: "" },
      informationEdge: { score: r.conviction?.informationEdge || 50, reasoning: "" },
      timingUrgency: { score: r.conviction?.timingUrgency || 50, reasoning: "" },
    },
  }));

  log(`  Converted ${tradeRecs.length} trade recommendations`);

  if (tradeRecs.length === 0) {
    log(`  No recommendations — writing neutral result`);
    writeOutputs(state, trialNum, date, dateKey, dateStr, signals, regime, regimeResult, researchResults, impactAnalysis, recommendations, tradeRecs, [], {
      directionAccuracy: 0, targetHitRate: 0, stopHitRate: 0, avgReturnPercent: 0,
      profitFactor: 0, winRate: 0, totalScore: 50,
    }, {}, undefined, undefined, undefined);
    state.fullDepthCurrentTrial = trialNum;
    state.fullDepthCompletedDates = state.fullDepthCompletedDates || [];
    state.fullDepthCompletedDates.push(date);
    saveState(state);
    commitAndPush(`Full-depth trial ${trialNum}: ${date} (no trades, score: 50)`);
    return;
  }

  // Rate limit gap before anti-leakage
  await sleep(6000);

  // ============================================================
  // PHASE 6: ANTI-LEAKAGE VERIFICATION
  // ============================================================
  log(`\n  Phase 6: Anti-Leakage Verification (${tradeRecs.length} recs)...`);
  const { cleanRecs, flaggedCount, priceDeviations, tokensUsed: verifyTokens } =
    await verifyRecommendations(date, tradeRecs);
  if (flaggedCount > 0)
    log(`  Filtered ${flaggedCount} trades for leakage -> ${cleanRecs.length} clean`);

  const verifiedRecs = cleanRecs.length > 0 ? cleanRecs : [];
  if (verifiedRecs.length === 0) {
    log(`  All recommendations flagged — writing neutral result`);
    writeOutputs(state, trialNum, date, dateKey, dateStr, signals, regime, regimeResult, researchResults, impactAnalysis, recommendations, tradeRecs, [], {
      directionAccuracy: 0, targetHitRate: 0, stopHitRate: 0, avgReturnPercent: 0,
      profitFactor: 0, winRate: 0, totalScore: 50,
    }, {}, undefined, undefined, undefined);
    state.fullDepthCurrentTrial = trialNum;
    state.fullDepthCompletedDates = state.fullDepthCompletedDates || [];
    state.fullDepthCompletedDates.push(date);
    saveState(state);
    commitAndPush(`Full-depth trial ${trialNum}: ${date} (all flagged, score: 50)`);
    return;
  }

  // ============================================================
  // PHASE 7: OUTCOME SCORING (Yahoo Finance, deterministic)
  // ============================================================
  log(`\n  Phase 7: Outcome Scoring (${verifiedRecs.length} trades)...`);
  const { outcomes } = await scoreRecommendations(date, verifiedRecs);
  const scores = calculateScores(verifiedRecs, outcomes);
  scores.totalScore = calculateCompositeScore(scores);
  const dimensionAnalysis = analyzeDimensions(verifiedRecs, outcomes);
  log(`  Score: ${scores.totalScore} | Win: ${scores.winRate}% | Dir: ${scores.directionAccuracy}% | PF: ${scores.profitFactor}`);

  // Benchmark: SPY return
  let spyReturn: number | undefined;
  let alpha: number | undefined;
  try {
    const { getOHLC } = await import("./lib/market-data.ts");
    const spyData = await getOHLC("SPY", date);
    if (spyData && spyData.open > 0) {
      spyReturn = Math.round(((spyData.close - spyData.open) / spyData.open) * 100 * 100) / 100;
      scores.benchmarkReturn = spyReturn;
      alpha = Math.round((scores.avgReturnPercent - spyReturn) * 100) / 100;
      scores.alpha = alpha;
      log(`  Benchmark: SPY ${spyReturn > 0 ? "+" : ""}${spyReturn.toFixed(2)}% | Alpha: ${alpha > 0 ? "+" : ""}${alpha.toFixed(2)}%`);
    }
  } catch {
    /* SPY data not available */
  }

  // ============================================================
  // PHASE 8: WRITE OUTPUT
  // ============================================================
  log(`\n  Phase 8: Writing outputs...`);
  writeOutputs(
    state, trialNum, date, dateKey, dateStr, signals, regime, regimeResult,
    researchResults, impactAnalysis, recommendations, verifiedRecs, outcomes,
    scores, dimensionAnalysis, spyReturn, alpha, { scoredOutcomes: outcomes, compositeScores: scores, dimAnalysis: dimensionAnalysis },
  );

  // Update state
  state.fullDepthCurrentTrial = trialNum;
  state.fullDepthCompletedDates = state.fullDepthCompletedDates || [];
  state.fullDepthCompletedDates.push(date);

  // Also store as a TrialResult in the shared results array with fullDepth flag
  const trialResult: TrialResult & { fullDepth?: boolean } = {
    trialId: 10000 + trialNum, // Offset to avoid collision with lightweight trials
    date,
    generatedAt: new Date().toISOString(),
    signals: signals as unknown as Record<string, unknown>,
    regime,
    briefing: {
      summary: recommendations.marketOutlook || "Full-depth briefing generated.",
      marketCondition:
        recommendations.riskLevel === "high" || recommendations.riskLevel === "elevated"
          ? "volatile"
          : regimeResult.regime === "risk-on"
            ? "bullish"
            : regimeResult.regime === "risk-off"
              ? "bearish"
              : "neutral",
      sections: researchResults.map((r) => ({
        title: r.name,
        content: r.content.slice(0, 2000),
        importance: (r.name === "Geopolitics & War" || r.name === "Macro & Central Banks" ? "high" : "medium") as
          | "high"
          | "medium"
          | "low",
      })),
      scenarios: (recommendations.recommendations || []).map((r: any) => ({
        event: `${r.direction.toUpperCase()} ${r.ticker} @ $${r.entryPrice}`,
        scenarios: [
          {
            condition: `Price reaches target $${r.targetPrice}`,
            implication: `+${(((r.targetPrice - r.entryPrice) / r.entryPrice) * 100 * (r.direction === "short" ? -1 : 1)).toFixed(1)}% gain`,
            trade: r.reasoning,
          },
          {
            condition: `Price hits stop $${r.stopPrice}`,
            implication: r.bearCase || "Position closed at loss",
            trade: `Stop loss at ${(((r.stopPrice - r.entryPrice) / r.entryPrice) * 100).toFixed(1)}%`,
          },
        ],
      })),
    },
    recommendations: verifiedRecs,
    outcomes,
    scores,
    dimensionAnalysis,
    weights: state.weights,
    totalTokensUsed: 0,
  };
  (trialResult as any).fullDepth = true;
  state.results.push(trialResult);

  if (scores.totalScore > state.bestScore) {
    state.bestScore = scores.totalScore;
    state.bestWeights = { ...state.weights };
    log(`  New best score: ${state.bestScore}`);
  }

  saveState(state);
  log(`\nFull-depth trial ${trialNum} complete — score: ${scores.totalScore}`);
  commitAndPush(`Full-depth trial ${trialNum}: ${date} (score: ${scores.totalScore})`);
}

// --- Output Writer ---

function writeOutputs(
  state: TrainingState,
  trialNum: number,
  date: string,
  dateKey: string,
  dateStr: string,
  signals: GlobalSignals,
  regime: TrainingRegime,
  regimeResult: RegimeAssessment,
  researchResults: { name: string; content: string }[],
  impactAnalysis: any,
  recommendations: any,
  verifiedRecs: TradeRecommendation[],
  outcomes: any[],
  scores: any,
  dimensionAnalysis: any,
  spyReturn?: number,
  alpha?: number,
  trainingExtras?: { scoredOutcomes: any; compositeScores: any; dimAnalysis: any },
): void {
  // 1. Write production-format briefing to public/data/briefing-{date}.json
  const storedBriefing: any = {
    id: `briefing-${dateKey}-${Date.now()}`,
    date: dateKey,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    summary: recommendations.marketOutlook || "Briefing generated.",
    marketCondition:
      recommendations.riskLevel === "high"
        ? "volatile"
        : recommendations.riskLevel === "elevated"
          ? "volatile"
          : regimeResult.regime === "risk-on"
            ? "bullish"
            : regimeResult.regime === "risk-off"
              ? "bearish"
              : "neutral",
    sections: [
      ...researchResults.map((r) => ({
        title: r.name,
        content: r.content.slice(0, 2000),
        importance:
          r.name === "Geopolitics & War" || r.name === "Macro & Central Banks" ? "high" : "medium",
      })),
      {
        title: "Sector & Company Impact Analysis",
        content: impactAnalysis.contrarian
          ? `Contrarian view: ${impactAnalysis.contrarian}\n\nTop impacts: ${(impactAnalysis.highImpactCompanies || [])
              .slice(0, 8)
              .map((c: any) => `${c.ticker} (${c.direction}, ${c.magnitude}/5): ${c.catalyst}`)
              .join("; ")}`
          : "Impact analysis completed — see recommendations.",
        importance: "high",
      },
      {
        title: "Risk Events & What Could Go Wrong",
        content: (impactAnalysis.riskEvents || []).join("\n- ") || "No major risk events identified.",
        importance: "high",
      },
    ],
    scenarios: (recommendations.recommendations || []).map((r: any) => ({
      event: `${r.direction.toUpperCase()} ${r.ticker} @ $${r.entryPrice}`,
      scenarios: [
        {
          condition: `Price reaches target $${r.targetPrice}`,
          implication: `+${(((r.targetPrice - r.entryPrice) / r.entryPrice) * 100 * (r.direction === "short" ? -1 : 1)).toFixed(1)}% gain`,
          trade: r.reasoning,
        },
        {
          condition: `Price hits stop $${r.stopPrice}`,
          implication: r.bearCase || "Position closed at loss",
          trade: `Stop loss at ${(((r.stopPrice - r.entryPrice) / r.entryPrice) * 100).toFixed(1)}%`,
        },
      ],
    })),
    regimeType: regimeResult.regime,
    regimeConfidence: regimeResult.confidence,
    researchDomains: researchResults.map((r) => ({ name: r.name, length: r.content.length })),
    impactAnalysis: {
      sectorRankings: impactAnalysis.sectorRankings,
      topCompanies: (impactAnalysis.highImpactCompanies || []).slice(0, 10),
    },
    allEvaluated: recommendations.allEvaluated || [],
    recommendations: recommendations.recommendations || [],
    watchlist: recommendations.watchlist || [],
    avoidList: recommendations.avoidList || [],
    // Training data addition
    trainingData: {
      trialId: trialNum,
      outcomes: trainingExtras?.scoredOutcomes || outcomes,
      scores: trainingExtras?.compositeScores || scores,
      dimensionAnalysis: trainingExtras?.dimAnalysis || dimensionAnalysis,
      benchmarkReturn: spyReturn,
      alpha: alpha,
      fullDepth: true,
    },
  };

  const briefingPath = path.join(DATA_DIR, `briefing-${dateKey}.json`);
  fs.writeFileSync(briefingPath, JSON.stringify(storedBriefing, null, 2));
  log(`  Wrote ${briefingPath}`);

  // 2. Write training-format record to public/data/training/day-{trialId}-{date}.json
  const trainingRecord = {
    trialId: 10000 + trialNum,
    date,
    dateDisplay: dateStr,
    generatedAt: new Date().toISOString(),
    fullDepth: true,
    pipeline: {
      signals: signals as unknown as Record<string, unknown>,
      regime,
      briefing: {
        summary: recommendations.marketOutlook || "",
        marketCondition: storedBriefing.marketCondition,
        sections: storedBriefing.sections,
        scenarios: storedBriefing.scenarios,
      },
    },
    researchDomains: researchResults,
    impactAnalysis,
    allEvaluated: recommendations.allEvaluated || [],
    recommendations: verifiedRecs,
    outcomes,
    scores,
    dimensionAnalysis,
    weights: state.weights,
    benchmarkReturn: spyReturn,
    alpha,
  };

  const trainingPath = path.join(TRAINING_DATA_DIR, `day-${10000 + trialNum}-${date}.json`);
  fs.writeFileSync(trainingPath, JSON.stringify(trainingRecord, null, 2));
  log(`  Wrote ${trainingPath}`);

  // 3. Update training index
  updateTrainingIndex(trialNum, date, regime, scores);
}

function updateTrainingIndex(
  trialNum: number,
  date: string,
  regime: TrainingRegime,
  scores: any,
): void {
  const indexPath = path.join(TRAINING_DATA_DIR, "index.json");
  let index: any;

  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } else {
    index = { totalTrials: 0, lastUpdated: "", bestScore: 0, currentWeights: DEFAULT_WEIGHTS, trials: [] };
  }

  // Remove existing entry for this trial (idempotent)
  const trialId = 10000 + trialNum;
  index.trials = index.trials.filter((t: any) => t.trialId !== trialId);
  index.trials.push({
    trialId,
    date,
    regime: regime.regime,
    score: scores.totalScore,
    winRate: scores.winRate,
    profitFactor: scores.profitFactor,
    numRecs: 0, // will be filled from outcomes
    hasOpusReview: false,
    fullDepth: true,
  });
  index.trials.sort((a: any, b: any) => a.trialId - b.trialId);
  index.totalTrials = index.trials.length;
  index.lastUpdated = new Date().toISOString();
  index.bestScore = Math.max(index.bestScore, scores.totalScore);

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// --- Entry Point ---

runFullDepthTrial().catch((err) => {
  console.error(`\nFATAL: ${err.message || err}`);
  if (currentState) {
    saveState(currentState);
    console.error("State saved before exit.");
  }
  process.exit(1);
});
