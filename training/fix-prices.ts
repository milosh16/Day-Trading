#!/usr/bin/env npx tsx
// Fix entry prices in trial-research.json using Yahoo Finance prior closes.
// Reads /tmp/trial-signals.json (for date) and /tmp/trial-research.json (agent output).
// Overwrites entry prices with exact prior closes, adjusts targets/stops proportionally.
// This eliminates the #1 cause of trade discard at verification.

import * as fs from "fs";

async function main() {
  const signalData = JSON.parse(fs.readFileSync("/tmp/trial-signals.json", "utf-8"));
  const research = JSON.parse(fs.readFileSync("/tmp/trial-research.json", "utf-8"));
  const date = signalData.date;

  const { getPriorClose } = await import("./lib/market-data.ts");

  const recs = research.recommendations || [];
  let fixed = 0;
  let failed = 0;

  for (const rec of recs) {
    const ticker = rec.ticker || rec.symbol;
    if (!ticker) continue;

    try {
      const realClose = await getPriorClose(ticker, date);
      if (!realClose || realClose <= 0) {
        console.log(`  ${ticker}: Yahoo returned no data — keeping agent price $${rec.entryPrice}`);
        failed++;
        continue;
      }

      const agentEntry = rec.entryPrice;
      const isLong = (rec.direction || "long").toLowerCase() === "long";

      // If agent left price null/0, set entry and compute default target/stop from direction
      if (!agentEntry || agentEntry <= 0) {
        rec.entryPrice = Math.round(realClose * 100) / 100;
        if (isLong) {
          rec.targetPrice = rec.targetPrice || Math.round(realClose * 1.025 * 100) / 100;
          rec.stopPrice = rec.stopPrice || Math.round(realClose * 0.985 * 100) / 100;
        } else {
          rec.targetPrice = rec.targetPrice || Math.round(realClose * 0.975 * 100) / 100;
          rec.stopPrice = rec.stopPrice || Math.round(realClose * 1.015 * 100) / 100;
        }
        console.log(`  ${ticker}: null → $${rec.entryPrice} | target $${rec.targetPrice} | stop $${rec.stopPrice} (defaults applied)`);
        fixed++;
        continue;
      }

      const deviation = Math.abs((agentEntry - realClose) / realClose) * 100;

      if (deviation < 0.5) {
        console.log(`  ${ticker}: $${agentEntry} ✓ (${deviation.toFixed(1)}% off, no fix needed)`);
        continue;
      }

      // Preserve the agent's R:R ratio and trade structure, just shift to real price
      const ratio = realClose / agentEntry;
      const oldTarget = rec.targetPrice;
      const oldStop = rec.stopPrice;

      rec.entryPrice = Math.round(realClose * 100) / 100;
      rec.targetPrice = Math.round(oldTarget * ratio * 100) / 100;
      rec.stopPrice = Math.round(oldStop * ratio * 100) / 100;

      // Sanity check: if targets/stops are NaN or nonsensical, apply defaults
      if (!rec.targetPrice || isNaN(rec.targetPrice) || !rec.stopPrice || isNaN(rec.stopPrice)) {
        if (isLong) {
          rec.targetPrice = Math.round(realClose * 1.025 * 100) / 100;
          rec.stopPrice = Math.round(realClose * 0.985 * 100) / 100;
        } else {
          rec.targetPrice = Math.round(realClose * 0.975 * 100) / 100;
          rec.stopPrice = Math.round(realClose * 1.015 * 100) / 100;
        }
      }

      console.log(`  ${ticker}: $${agentEntry} → $${rec.entryPrice} (was ${deviation.toFixed(1)}% off) | target $${oldTarget}→$${rec.targetPrice} | stop $${oldStop}→$${rec.stopPrice}`);
      fixed++;
    } catch (e) {
      console.log(`  ${ticker}: Yahoo error — keeping agent price $${rec.entryPrice}`);
      failed++;
    }
  }

  fs.writeFileSync("/tmp/trial-research.json", JSON.stringify(research, null, 2));
  console.log(`\nFixed ${fixed} prices, ${failed} failures, ${recs.length - fixed - failed} already accurate.`);
}

main().catch(e => { console.error(e); process.exit(1); });
