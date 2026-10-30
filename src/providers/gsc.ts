import { createSign } from "node:crypto";
import fs from "node:fs";

/**
 * Google Search Console (first-party, free) via a service account.
 * Add the service account email as a user on the GSC property first.
 */
export interface GscRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(`Google auth failed: ${json.error_description ?? res.status}`);
  return json.access_token;
}

export function gscConfigured(): boolean {
  return !!process.env.GSC_CREDENTIALS_PATH && fs.existsSync(process.env.GSC_CREDENTIALS_PATH);
}

/** Last `days` of query×page performance. siteUrl: "sc-domain:example.com" or "https://example.com/". */
export async function gscQueryPages(siteUrl: string, days = 90, rowLimit = 5000): Promise<GscRow[]> {
  const sa = JSON.parse(fs.readFileSync(process.env.GSC_CREDENTIALS_PATH!, "utf8")) as ServiceAccount;
  const token = await accessToken(sa);
  const end = new Date(Date.now() - 2 * 86400_000);
  const start = new Date(end.getTime() - days * 86400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ startDate: iso(start), endDate: iso(end), dimensions: ["query", "page"], rowLimit }),
  });
  if (!res.ok) throw new Error(`Search Console ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };
  return (json.rows ?? []).map((r) => ({ query: r.keys[0]!, page: r.keys[1]!, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
}
