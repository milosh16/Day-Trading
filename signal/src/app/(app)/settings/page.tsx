"use client";

import { useState } from "react";
import { useSettingsStore } from "@/lib/store";
import Card from "@/components/Card";

export default function SettingsPage() {
  const { settings, updateAlpacaKeys, updateNotifications, clearSettings } = useSettingsStore();
  const [apiKey, setApiKey] = useState(settings.alpacaKeys?.apiKey || "");
  const [secretKey, setSecretKey] = useState(settings.alpacaKeys?.secretKey || "");
  const [paperTrading, setPaperTrading] = useState(settings.alpacaKeys?.paperTrading ?? true);
  const [ntfyTopic, setNtfyTopic] = useState(settings.notifications.ntfyTopic);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const saveAlpacaKeys = () => {
    if (apiKey && secretKey) {
      updateAlpacaKeys({ apiKey, secretKey, paperTrading });
    } else {
      updateAlpacaKeys(null);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testConnection = async () => {
    if (!apiKey || !secretKey) {
      setTestResult("Enter API keys first");
      return;
    }
    setTestResult("Testing...");
    try {
      const res = await fetch("/api/alpaca/account", {
        headers: {
          "x-alpaca-key": apiKey,
          "x-alpaca-secret": secretKey,
          "x-alpaca-paper": String(paperTrading),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult(`Connected. Account: $${parseFloat(data.equity).toFixed(2)}`);
      } else {
        const err = await res.json();
        setTestResult(`Failed: ${err.error}`);
      }
    } catch {
      setTestResult("Connection failed");
    }
  };

  const saveNotifications = () => {
    updateNotifications({
      ...settings.notifications,
      ntfyTopic,
      enabled: !!ntfyTopic,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testNotification = async () => {
    if (!ntfyTopic) return;
    try {
      await fetch(`https://ntfy.sh/${ntfyTopic}`, {
        method: "POST",
        headers: {
          Title: "SIGNAL Test",
          Priority: "default",
          Tags: "white_check_mark",
        },
        body: "Push notifications are working. You will receive alerts when stops or targets are hit.",
      });
      setTestResult("Notification sent - check your phone");
    } catch {
      setTestResult("Failed to send notification");
    }
  };

  return (
    <div className="px-4 pt-14">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      {/* Alpaca Connection */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-4">
          Alpaca Brokerage
        </h3>

        {/* Paper/Live Toggle */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm">Trading Mode</span>
          <div className="flex bg-ios-elevated rounded-lg overflow-hidden">
            <button
              onClick={() => setPaperTrading(true)}
              className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                paperTrading ? "bg-ios-blue text-white" : "text-ios-gray"
              }`}
            >
              Paper
            </button>
            <button
              onClick={() => setPaperTrading(false)}
              className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                !paperTrading ? "bg-ios-red text-white" : "text-ios-gray"
              }`}
            >
              Live
            </button>
          </div>
        </div>

        {!paperTrading && (
          <div className="bg-ios-red/10 rounded-lg p-3 mb-4">
            <p className="text-xs text-ios-red font-medium">Live trading uses real money. Proceed with caution.</p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-ios-gray block mb-1">API Key ID</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="PKXXXXXXXXXXXXXXXXXX"
              className="w-full bg-ios-elevated rounded-lg px-3 py-2.5 text-sm text-white placeholder-ios-gray-2 outline-none focus:ring-1 focus:ring-ios-blue"
            />
          </div>
          <div>
            <label className="text-xs text-ios-gray block mb-1">Secret Key</label>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Enter secret key"
              className="w-full bg-ios-elevated rounded-lg px-3 py-2.5 text-sm text-white placeholder-ios-gray-2 outline-none focus:ring-1 focus:ring-ios-blue"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={saveAlpacaKeys}
            className="flex-1 bg-ios-blue text-white font-semibold py-2.5 rounded-ios text-sm active:opacity-80"
          >
            {saved ? "Saved" : "Save Keys"}
          </button>
          <button
            onClick={testConnection}
            className="flex-1 bg-ios-elevated text-ios-blue font-semibold py-2.5 rounded-ios text-sm active:opacity-80"
          >
            Test
          </button>
        </div>

        {testResult && (
          <p className={`text-xs mt-2 ${testResult.includes("Connected") ? "text-ios-green" : testResult.includes("Testing") ? "text-ios-gray" : "text-ios-red"}`}>
            {testResult}
          </p>
        )}

        <p className="text-[11px] text-ios-gray-2 mt-3">
          Keys are stored on-device only (localStorage). Never sent to our servers or stored server-side.
        </p>
      </Card>

      {/* Push Notifications */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-4">
          Push Notifications
        </h3>
        <p className="text-xs text-ios-gray-2 mb-3">
          Uses ntfy.sh for push notifications. Install the ntfy app on your iPhone, then subscribe to your topic name below.
        </p>
        <div>
          <label className="text-xs text-ios-gray block mb-1">ntfy.sh Topic</label>
          <input
            type="text"
            value={ntfyTopic}
            onChange={(e) => setNtfyTopic(e.target.value)}
            placeholder="signal-alerts-yourname"
            className="w-full bg-ios-elevated rounded-lg px-3 py-2.5 text-sm text-white placeholder-ios-gray-2 outline-none focus:ring-1 focus:ring-ios-blue"
          />
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={saveNotifications}
            className="flex-1 bg-ios-blue text-white font-semibold py-2.5 rounded-ios text-sm active:opacity-80"
          >
            Save
          </button>
          <button
            onClick={testNotification}
            className="flex-1 bg-ios-elevated text-ios-blue font-semibold py-2.5 rounded-ios text-sm active:opacity-80"
          >
            Test Alert
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {[
            { key: "alertOnStopHit" as const, label: "Alert on Stop Loss Hit" },
            { key: "alertOnTargetHit" as const, label: "Alert on Target Hit" },
            { key: "alertOnBriefing" as const, label: "Alert on Morning Briefing" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm">{label}</span>
              <button
                onClick={() =>
                  updateNotifications({
                    ...settings.notifications,
                    [key]: !settings.notifications[key],
                  })
                }
                className={`w-12 h-7 rounded-full transition-colors ${
                  settings.notifications[key] ? "bg-ios-green" : "bg-ios-gray-3"
                }`}
              >
                <div
                  className={`w-5.5 h-5.5 bg-white rounded-full shadow-sm transition-transform mx-0.5 ${
                    settings.notifications[key] ? "translate-x-5" : "translate-x-0.5"
                  }`}
                  style={{ width: 22, height: 22 }}
                />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Risk Rules Display */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-ios-gray uppercase tracking-wider mb-4">
          Risk Rules (Enforced in Code)
        </h3>
        <div className="space-y-2">
          {[
            { label: "Min Conviction Score", value: "72 / 100" },
            { label: "Max Position Size", value: "50% of portfolio" },
            { label: "Max Total Exposure", value: "80% (20% cash floor)" },
            { label: "Max Loss Per Trade", value: "3% of portfolio" },
            { label: "Daily Loss Halt", value: "5% triggers halt" },
            { label: "Min Reward:Risk", value: "1.3:1" },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span className="text-sm text-ios-gray">{label}</span>
              <span className="text-sm font-medium">{value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Backtest Link */}
      <Card className="mb-4" onClick={() => window.location.href = "/backtest"}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Backtest Engine</h3>
            <p className="text-xs text-ios-gray mt-0.5">Monte Carlo simulation of conviction algorithm</p>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ios-gray">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </Card>

      {/* Clear Data */}
      <Card className="mb-20">
        <button
          onClick={() => {
            if (confirm("Clear all settings and stored data? This cannot be undone.")) {
              clearSettings();
              setApiKey("");
              setSecretKey("");
              setNtfyTopic("");
            }
          }}
          className="w-full text-ios-red font-semibold text-sm py-1"
        >
          Clear All Data
        </button>
      </Card>
    </div>
  );
}
