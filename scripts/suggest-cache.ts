/*
  Fill a Google Autocomplete cache for `seo keywords --free` on a machine that can reach Google, e.g.
    npx tsx scripts/suggest-cache.ts in "website development,seo services" > autocomplete-cache.json
  Copy the file to data/projects/<slug>/autocomplete-cache.json and run `seo keywords <slug> --free --seeds ...`
  with the same seeds: the research then reads the cache instead of calling Google.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { market } from "../src/config.js";
import { FreeProvider } from "../src/providers/free.js";

const [code = "in", seedList = ""] = process.argv.slice(2);
const file = path.join(os.tmpdir(), `suggest-${code}-${Date.now()}.json`);
const provider = new FreeProvider(code, { cacheFile: file });
const seeds = seedList.split(",").map((s) => s.trim()).filter(Boolean);
const ideas = await provider.keywordIdeas(seeds, market(code), 5000);
console.error(`${ideas.length} suggestions from ${seeds.length} seeds`);
process.stdout.write(fs.readFileSync(file, "utf8"));
