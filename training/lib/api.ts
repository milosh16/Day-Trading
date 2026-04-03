// ============================================================
// Training - Anthropic API Client with Rate Limiting
// ============================================================
// Manages API calls with exponential backoff and rate limiting.
// Designed to run for hours without hitting API limits.
// ============================================================

// Use direct Anthropic API if ANTHROPIC_API_KEY is set locally,
// otherwise go through the Vercel-deployed proxy
const DIRECT_API = "https://api.anthropic.com/v1/messages";
const PROXY_API = process.env.SIGNAL_APP_URL
  ? `${process.env.SIGNAL_APP_URL}/api/anthropic`
  : "https://day-trading-sigma.vercel.app/api/anthropic";
const API_VERSION = "2023-06-01";
const MODEL = process.env.TRAINING_MODEL || "claude-opus-4-6";

function useDirectApi(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Rate limiting: minimum gap between requests
const MIN_REQUEST_GAP_MS = 6000; // 6 seconds between requests (10 RPM safe)
let lastRequestTime = 0;

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ApiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await sleep(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

export async function callClaude(opts: {
  system: string;
  messages: Message[];
  maxTokens?: number;
  useWebSearch?: boolean;
}): Promise<ApiResponse> {
  const direct = useDirectApi();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!direct && !PROXY_API) throw new Error("No API key and no proxy URL configured");

  const { system, messages, maxTokens = 4096, useWebSearch = true } = opts;

  await waitForRateLimit();

  const tools = useWebSearch
    ? [{ type: "web_search_20260209", name: "web_search" }]
    : [];

  // Build request body
  const body: Record<string, unknown> = direct
    ? {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
      }
    : {
        // Proxy mode — proxy adds model, tools, and streams
        system,
        messages,
        max_tokens: maxTokens,
        ...(tools.length > 0 ? { tools } : {}),
      };

  const url = direct ? DIRECT_API : PROXY_API;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (direct) {
    headers["x-api-key"] = apiKey!;
    headers["anthropic-version"] = API_VERSION;
  }

  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.status === 429 || response.status === 529) {
        // Rate limited or overloaded — back off
        const backoff = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s, 80s
        console.log(`  Rate limited (${response.status}), backing off ${backoff / 1000}s...`);
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let textContent = "";
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;

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
              textContent += event.delta.text;
            }
            if (event.type === "message_start" && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens || 0;
            }
            if (event.type === "message_delta" && event.usage) {
              outputTokens = event.usage.output_tokens || 0;
            }
          } catch { /* skip */ }
        }
      }

      return { text: textContent, inputTokens, outputTokens };
    } catch (err) {
      const msg = err instanceof Error ? `${err.message} (${err.cause || ''})` : String(err);
      if (attempt === maxRetries) {
        console.error(`  FATAL after ${maxRetries + 1} attempts: ${msg}`);
        throw err;
      }
      const backoff = Math.pow(2, attempt + 1) * 2000;
      console.log(`  Error [attempt ${attempt + 1}/${maxRetries + 1}]: ${msg}, retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }

  throw new Error("Max retries exceeded");
}

export function extractJson<T>(text: string, arrayMode = false): T | null {
  // Try <json> tags first
  const tagMatch = text.match(/<json>([\s\S]*?)<\/json>/);
  if (tagMatch) {
    try {
      return JSON.parse(tagMatch[1]) as T;
    } catch { /* fall through */ }
  }

  // Try raw JSON
  const startChar = arrayMode ? "[" : "{";
  const endChar = arrayMode ? "]" : "}";
  const start = text.indexOf(startChar);
  const end = text.lastIndexOf(endChar);
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch { /* fall through */ }
  }

  return null;
}
