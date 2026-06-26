// Fetches daily exchange rates from the free, key-less @fawazahmed0/currency-api
// and writes them to data/rates.json. Run by the GitHub Actions cron daily.
//
//   node scripts/fetch-rates.mjs
//
// Docs: https://github.com/fawazahmed0/exchange-api

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "usd";

// Primary CDN + fallback. Both are free and require no API key.
const ENDPOINTS = [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${BASE}.min.json`,
  `https://latest.currency-api.pages.dev/v1/currencies/${BASE}.min.json`,
];

async function fetchJson(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`Failed: ${url} -> ${err.message}`);
    }
  }
  throw lastErr ?? new Error("All endpoints failed");
}

async function main() {
  const data = await fetchJson(ENDPOINTS);
  const rates = data[BASE];
  if (!rates || typeof rates !== "object") {
    throw new Error("Unexpected API response shape");
  }

  const out = {
    base: BASE,
    // date reported by the upstream feed (the day the rates are for)
    date: data.date ?? null,
    // when we pulled it
    fetched_at: new Date().toISOString(),
    source: "https://github.com/fawazahmed0/exchange-api",
    rates,
  };

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(__dirname, "..", "data", "rates.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(
    `Wrote ${Object.keys(rates).length} rates to ${outPath} (feed date: ${out.date})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
