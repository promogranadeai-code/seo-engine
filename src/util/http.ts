export const USER_AGENT =
  "Mozilla/5.0 (compatible; PromogranadeSEOBot/0.1; +https://promogranade.com)";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  redirects: string[];
  headers: Record<string, string>;
  body: string;
  bytes: number;
  ms: number;
  error?: string;
}

/** GET with manual redirect following so we can record redirect chains. */
export async function fetchPage(url: string, { timeoutMs = 20_000, maxRedirects = 5 } = {}): Promise<FetchResult> {
  const started = Date.now();
  const redirects: string[] = [];
  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        redirects.push(current);
        current = new URL(location, current).toString();
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return {
        url,
        finalUrl: current,
        status: res.status,
        redirects,
        headers,
        body: buf.toString("utf8"),
        bytes: buf.length,
        ms: Date.now() - started,
      };
    }
    return { url, finalUrl: current, status: 0, redirects, headers: {}, body: "", bytes: 0, ms: Date.now() - started, error: "too many redirects" };
  } catch (e) {
    return { url, finalUrl: current, status: 0, redirects, headers: {}, body: "", bytes: 0, ms: Date.now() - started, error: (e as Error).message };
  }
}

/** Run async jobs with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export function normalizeUrl(u: string): string {
  const url = new URL(u);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.toString();
}

export const hostOf = (u: string): string => new URL(u).hostname.replace(/^www\./, "");
