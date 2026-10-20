// SPDX-License-Identifier: Apache-2.0
/**
 * The `studio` adapter of the agent benchmark: the task goes to an agent session of Scenity Studio, as a person gives
 * it in the studio. For each case, the adapter does these steps:
 *
 * - It starts a studio host with a state of its own and opens the project copy (with the trust: its plugins load).
 * - It shows the editor window in a headless Chromium (the tools of the scene work through the window).
 * - It makes a session in the auto mode with the limits of the case (the edits apply at once in the window).
 * - It sends the prompt and waits for the end of the turn.
 *
 * The person answers each approval card once (a review step: the write of a file that always asks, such as
 * `scenity.project.json`). Then the window saves its documents (the scene, the sequence and the materials), so the
 * check reads the files. The cost comes from the session. The transcript is its list of items.
 *
 * `SCENITY_AGENT_SCRIPT` in the environment of the run gives the script driver to the host (a test with no model).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterOptions, AdapterRun } from "./adapters";
import { CHECKOUT } from "./project";

/** The parts of Playwright that the adapter uses (it loads the package of the editor app). */
export interface Page {
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  url(): string;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  waitForURL(url: RegExp, options: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  click(selector: string, options?: { timeout: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  check(selector: string): Promise<void>;
}
interface Context {
  addCookies(cookies: readonly object[]): Promise<void>;
  newPage(): Promise<Page>;
}
export interface Browser {
  newContext(options: object): Promise<Context>;
  close(): Promise<void>;
}
interface Playwright {
  readonly chromium: { launch(options: object): Promise<Browser> };
}

/** The Playwright package of the editor app. */
export function playwright(): Playwright {
  return createRequire(join(CHECKOUT, "apps", "editor", "package.json"))("@playwright/test") as Playwright;
}

/** A headless Chromium with an editor window size, and its first page. */
export async function editorBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await playwright().chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { browser, page: await context.newPage() };
}

/** The words of a case in the studio: the window, the tools and the documents. */
export function studioPreamble(): string {
  return [
    "You work in Scenity Studio: the editor window of the project is open, with its scene.",
    "Use the scenity tools: scene_command and scene_batch change the scene and the open sequence (one undo step each),",
    "scene_query and scene_measure read it, job_run runs the scenity command (for example check, build, assets import).",
    "The file tools change the other documents of the project folder. The docs are in .bench/docs (formats.md gives",
    "every document format). Do the task with no questions, check your result, then answer in one or two sentences.",
  ].join(" ");
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** Start a host on a free port with a state folder (and the `extra` arguments). It resolves at the ready line. */
export async function startHost(
  state: string,
  extra: readonly string[] = [],
): Promise<{ child: ChildProcess; origin: string }> {
  const port = await freePort();
  const main = join(CHECKOUT, "packages", "studio-host", "src", "main.ts");
  const child = spawn("bun", [main, "--port", String(port), "--state", state, "--no-open", ...extra], {
    cwd: CHECKOUT,
    env: { ...process.env, SCENITY_SCENE_NO_WATCH: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      if (text.includes("SCENITY_STUDIO_READY")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`the studio host ended (${String(code)})`)));
  });
  return { child, origin: `http://127.0.0.1:${String(port)}` };
}

/** The secret of the host of a state folder. */
export function hostSecret(state: string): string {
  return (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
}

/** A client of the API of the host with its secret. */
export function hostApi(origin: string, secret: string) {
  return async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const answer = await fetch(`${origin}${path}`, {
      method,
      headers: { "x-studio-token": secret, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await answer.json().catch(() => ({}))) as T & { error?: string };
    if (!answer.ok) throw new Error(`${method} ${path}: ${data.error ?? String(answer.status)}`);
    return data;
  };
}

export interface SessionView {
  readonly id: string;
  readonly running: boolean;
  readonly queued: number;
  readonly costUsd: number;
  readonly model: string;
  readonly items: readonly {
    readonly kind: string;
    readonly text?: string;
    readonly turn?: number;
    readonly approval?: string;
    readonly decision?: string | null;
  }[];
}

/** A client of the API of a host. */
export type HostApi = ReturnType<typeof hostApi>;

/**
 * Wait for the end of the turns of a session. The person answers each approval card once (a review step: a write of
 * a file that always asks). After `minutes` the session stops.
 */
export async function waitForSession(
  api: HostApi,
  project: string,
  id: string,
  minutes: number,
): Promise<{ session: SessionView; timedOut: boolean; reviews: number }> {
  const deadline = Date.now() + minutes * 60_000;
  let session: SessionView | undefined;
  const answered = new Set<string>();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const list = await api<{ sessions: SessionView[] }>(`/api/agent/sessions?project=${project}`);
    session = list.sessions.find((item) => item.id === id);
    for (const item of session?.items ?? []) {
      if (item.kind !== "approval" || item.decision !== null || item.approval === undefined) continue;
      if (answered.has(item.approval)) continue;
      answered.add(item.approval);
      await api(`/api/agent/sessions/${id}/approvals/${item.approval}`, "POST", { decision: "once" });
    }
    const ended = session?.items.some((item) => item.kind === "end") === true;
    if ((ended && session?.running === false && session.queued === 0) || Date.now() > deadline) break;
  }
  const timedOut = Date.now() > deadline;
  if (timedOut) await api(`/api/agent/sessions/${id}/stop`, "POST", {}).catch(() => null);
  const empty: SessionView = { id, running: false, queued: 0, costUsd: 0, model: "", items: [] };
  return { session: session ?? empty, timedOut, reviews: answered.size };
}

/** The run of a session from its items: the last text, the cost, the tool calls and the error. */
export function runOf(session: SessionView, durationMs: number, timedOut: boolean): AdapterRun {
  const texts = session.items.filter((item) => item.kind === "text");
  const errors = session.items.filter((item) => item.kind === "error");
  const end = session.items.findLast((item) => item.kind === "end") as { reason?: string } | undefined;
  const failed = timedOut
    ? "the time limit ended the turn"
    : end?.reason === "error"
      ? (errors.at(-1)?.text ?? "an error")
      : null;
  return {
    answer: texts.at(-1)?.text ?? "",
    costUsd: session.costUsd,
    turns: null,
    toolCalls: session.items.filter((item) => item.kind === "tool").length,
    durationMs,
    model: session.model,
    error: failed,
  };
}

/** The `studio` adapter. */
export function studioAdapter(options: AdapterOptions): Adapter {
  return async (project, prompt, transcript) => {
    const start = performance.now();
    const state = mkdtempSync(join(tmpdir(), "scenity-bench-studio-"));
    const host = await startHost(state);
    let browser: Browser | null = null;
    try {
      const api = hostApi(host.origin, hostSecret(state));
      const opened = await api<{ key: string; url: string; restricted: boolean }>("/api/projects/open", "POST", {
        dir: project.dir,
      });
      if (opened.restricted) await api("/api/projects/trust", "POST", { key: opened.key });
      // The editor window: a launch link signs the browser in.
      const editor = await editorBrowser();
      browser = editor.browser;
      const page = editor.page;
      const { url: launch } = await api<{ url: string }>("/api/launch-code", "POST", {});
      await page.goto(launch);
      await page.goto(`${host.origin}${opened.url}`);
      await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
      // The auto mode: the edits of the agent apply at once in the window (the switch of the session).
      await page.evaluate(() =>
        (globalThis as { __scenity?: { setProposalMode?(mode: string): unknown } }).__scenity?.setProposalMode?.(
          "apply",
        ),
      );
      const made = await api<{ id: string }>("/api/agent/sessions", "POST", {
        project: opened.key,
        name: "bench",
        mode: "auto",
        budgetUsd: options.budget,
        maxTurns: options.turns,
        maxMinutes: options.minutes,
        ...(options.model === undefined ? {} : { model: options.model }),
      });
      await api(`/api/agent/sessions/${made.id}/prompt`, "POST", {
        text: `${studioPreamble()}\n\nThe task: ${prompt}`,
      });
      const { session, timedOut, reviews } = await waitForSession(api, opened.key, made.id, options.minutes);
      // The window saves its documents, as the person saves after the work of the agent.
      await page.evaluate(() => (globalThis as { __scenity?: { save?(): Promise<unknown> } }).__scenity?.save?.());
      writeFileSync(transcript, session.items.map((item) => JSON.stringify(item)).join("\n"));
      return { ...runOf(session, Math.round(performance.now() - start), timedOut), reviews };
    } catch (error) {
      return {
        answer: "",
        costUsd: null,
        turns: null,
        toolCalls: 0,
        durationMs: Math.round(performance.now() - start),
        model: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await browser?.close();
      host.child.kill("SIGTERM");
      rmSync(state, { recursive: true, force: true });
    }
  };
}
