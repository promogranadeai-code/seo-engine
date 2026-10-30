import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

/**
 * Projects are plain JSON/Markdown folders under data/projects/<slug>/ so that
 * Claude Code (and people) can read and edit them directly.
 */
export interface Project {
  slug: string;
  url: string;
  domain: string;
  market: string;
  createdAt: string;
  /** Where the site's source code lives, if we can edit it (for `seo fix`). */
  repoPath?: string;
  business?: {
    name?: string;
    summary?: string;
    services?: string[];
    audience?: string;
    location?: string;
    /** Other spellings/names that count as a brand mention in AI answers. */
    aliases?: string[];
  };
  competitors?: string[];
  targetKeywords?: string[];
}

export const slugify = (domain: string): string =>
  domain.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function projectDir(slug: string): string {
  return path.join(dataDir(), "projects", slug);
}

export function saveProject(p: Project): void {
  writeJson(p.slug, "project.json", p);
}

export function loadProject(slug: string): Project {
  const file = path.join(projectDir(slug), "project.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No project "${slug}". Run: seo add <url>   (existing: ${listProjects().join(", ") || "none"})`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Project;
}

export function listProjects(): string[] {
  const dir = path.join(dataDir(), "projects");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "project.json")));
}

export function writeJson(slug: string, name: string, data: unknown): string {
  return writeText(slug, name, JSON.stringify(data, null, 2) + "\n");
}

export function readJson<T>(slug: string, name: string): T | null {
  const file = path.join(projectDir(slug), name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

export function writeText(slug: string, name: string, text: string): string {
  const file = path.join(projectDir(slug), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
