// SPDX-License-Identifier: Apache-2.0
/**
 * The adapters of the agent benchmark. An adapter gives a task to an agent in a project and returns what the agent
 * said and what it used.
 *
 * - `files`: Claude Code with no studio, in the project folder, with the file tools and `bun` (the `scenity` command).
 *   This is the path for a person with Claude Code, a project and no studio: the agent edits the JSON documents.
 * - `studio`: a session of Scenity Studio with its tools and an editor window (studio.ts).
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKOUT, type BenchProject } from "./project";

export interface AdapterOptions {
  /** The cost limit of one case in US dollars. */
  readonly budget: number;
  readonly turns: number;
  readonly minutes: number;
  /** The model name for `--model`. No value gives the default of the CLI. */
  readonly model?: string;
}

export interface AdapterRun {
  /** The last text of the agent. */
  readonly answer: string;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly toolCalls: number;
  readonly durationMs: number;
  readonly model: string | null;
  readonly error: string | null;
  /** The approval cards that the person answered (the studio adapter). */
  readonly reviews?: number;
}

export type Adapter = (project: BenchProject, prompt: string, transcript: string) => Promise<AdapterRun>;

/** The words that every case starts with: where the documents, the docs and the command are. */
export function preamble(): string {
  return [
    "You work in a Scenity project: the current folder. Its documents are JSON files: scenity.project.json,",
    "scenes/*.scene.json, sequences/*.sequence.json, and the asset records (*.meta.json) beside the source files.",
    "The docs are in .bench/docs: formats.md gives every document format; plugins.md, cli.md and editor.md give more.",
    `The scenity command is: bun ${join(CHECKOUT, "packages", "cli", "src", "cli.ts")} <command> (for example`,
    "check, build, assets import). Change the files of this folder only. Do the task with no questions, check your",
    "result, then answer in one or two sentences.",
  ].join(" ");
}

interface StreamLine {
  type?: string;
  subtype?: string;
  model?: string;
  message?: { content?: { type?: string }[] };
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
}

/** Read the stream-json lines of `claude -p`. */
export function readStream(lines: readonly string[]): Omit<AdapterRun, "durationMs" | "error"> & { failed: boolean } {
  let model: string | null = null;
  let toolCalls = 0;
  let result: StreamLine | null = null;
  for (const line of lines) {
    let item: StreamLine;
    try {
      item = JSON.parse(line) as StreamLine;
    } catch {
      continue;
    }
    if (item.type === "system" && item.subtype === "init") model = item.model ?? null;
    if (item.type === "assistant")
      toolCalls += (item.message?.content ?? []).filter((c) => c.type === "tool_use").length;
    if (item.type === "result") result = item;
  }
  return {
    answer: result?.result ?? "",
    costUsd: result?.total_cost_usd ?? null,
    turns: result?.num_turns ?? null,
    toolCalls,
    model,
    failed: result === null || result.is_error === true,
  };
}

/** The `files` adapter: `claude -p` in the project folder. */
export function filesAdapter(options: AdapterOptions): Adapter {
  return (project, prompt, transcript) =>
    new Promise((done) => {
      const args = [
        "-p",
        `${preamble()}\n\nThe task: ${prompt}`,
        "--output-format",
        "stream-json",
        "--verbose",
        "--max-turns",
        String(options.turns),
        "--max-budget-usd",
        String(options.budget),
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read",
        "Edit",
        "Write",
        "Glob",
        "Grep",
        "Bash(bun:*)",
        "Bash(ls:*)",
        "--no-session-persistence",
        ...(options.model === undefined ? [] : ["--model", options.model]),
      ];
      const start = performance.now();
      const child = spawn("claude", args, { cwd: project.dir, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      const timer = setTimeout(() => child.kill("SIGTERM"), options.minutes * 60_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        writeFileSync(transcript, out);
        const read = readStream(out.split("\n"));
        const error = read.failed ? `exit ${String(code)}: ${err.slice(-300) || "no result line"}` : null;
        done({ ...read, durationMs: Math.round(performance.now() - start), error });
      });
    });
}
