/** Small text utilities shared by keyword, content and audit modules. */

export const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have how i if in into is it its of on or our " +
    "so that the their them then there these they this to us was we what when where which who why " +
    "will with you your can do does did not no yes than too very just more most all any each also " +
    "about after before over under up down out off again further once here both few other some such " +
    "only own same s t don should now get got make made like one two new best top vs versus"
  ).split(" "),
);

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokens(s: string, { keepStopwords = false } = {}): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && (keepStopwords || !STOPWORDS.has(t)));
}

/** Crude English stemmer — enough to match "services"/"service", "building"/"build". */
export function stem(t: string): string {
  if (t.length <= 4) return t;
  return t.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "");
}

export const stems = (s: string): string[] => tokens(s).map(stem);

export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Word n-grams (stopwords removed) — used for seed keyword extraction. */
export function ngrams(s: string, n: number): string[] {
  const t = tokens(s);
  const out: string[] = [];
  for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n).join(" "));
  return out;
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function sentences(s: string): string[] {
  return s
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const round = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
