import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { writerModel } from "../config.js";

/** Minimal LLM surface the engine needs — lets tests inject a fake. */
export interface Llm {
  text(system: string, user: string, opts?: { effort?: "low" | "medium" | "high" | "xhigh" }): Promise<string>;
  json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T>;
}

/** API key, auth token, or an `ant auth login` profile (the SDK reads all three). */
export function llmConfigured(): boolean {
  const home = process.env.HOME ?? "";
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || fs.existsSync(path.join(home, ".config", "anthropic")));
}

export class ClaudeLlm implements Llm {
  private client = new Anthropic();
  constructor(private model = writerModel()) {}

  async text(system: string, user: string, opts: { effort?: "low" | "medium" | "high" | "xhigh" } = {}): Promise<string> {
    // Streaming for long outputs; server-side fallback reroutes a refused request automatically.
    const msg = await this.client.beta.messages
      .stream({
        model: this.model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort ?? "high" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
    const out = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (msg.stop_reason === "max_tokens") throw new Error("Claude hit the output limit; shorten the brief.");
    return out;
  }

  async json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(schema as z.ZodType<T> & z.ZodObject), effort: "medium" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
    if (res.parsed_output == null) throw new Error("Claude returned output that didn't match the schema.");
    return res.parsed_output as T;
  }
}

export function requireLlm(): Llm {
  if (!llmConfigured()) throw new Error("No Anthropic credentials. Set ANTHROPIC_API_KEY in .env or run `ant auth login` to use writing features.");
  return new ClaudeLlm();
}
