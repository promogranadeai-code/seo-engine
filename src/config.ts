import fs from "node:fs";
import path from "node:path";

/** Minimal .env loader so the CLI works without extra dependencies. Existing env wins. */
export function loadDotEnv(file = ".env"): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m;
    if (key && process.env[key] === undefined) {
      process.env[key] = (raw ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

export const dataDir = (): string => path.resolve(process.env.SEO_DATA_DIR ?? "data");

/** Writing / analysis model. Claude Opus 5.5 by default; override with SEO_MODEL. */
export const writerModel = (): string => process.env.SEO_MODEL ?? "claude-opus-5-5";

export function dataForSeoAuth(): string | null {
  if (process.env.DATAFORSEO_API_KEY) return process.env.DATAFORSEO_API_KEY;
  const { DATAFORSEO_LOGIN: login, DATAFORSEO_PASSWORD: pass } = process.env;
  if (login && pass) return Buffer.from(`${login}:${pass}`).toString("base64");
  return null;
}

/** Common Google markets. DataForSEO location codes. */
export const MARKETS: Record<string, { locationCode: number; languageCode: string; label: string }> = {
  us: { locationCode: 2840, languageCode: "en", label: "United States" },
  uk: { locationCode: 2826, languageCode: "en", label: "United Kingdom" },
  in: { locationCode: 2356, languageCode: "en", label: "India" },
  ae: { locationCode: 2784, languageCode: "en", label: "United Arab Emirates" },
  au: { locationCode: 2036, languageCode: "en", label: "Australia" },
  ca: { locationCode: 2124, languageCode: "en", label: "Canada" },
  sg: { locationCode: 2702, languageCode: "en", label: "Singapore" },
};

export function market(code: string) {
  const m = MARKETS[code.toLowerCase()];
  if (!m) throw new Error(`Unknown market "${code}". Use one of: ${Object.keys(MARKETS).join(", ")}`);
  return m;
}
