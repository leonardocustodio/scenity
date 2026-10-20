// SPDX-License-Identifier: Apache-2.0
/**
 * The context packet of the workbench: the text that tells Claude what
 * the owner looks at, in at most about forty lines. The host builds it from the calls of the surface bridge (`url`,
 * `state`, `inspect`, `check`, `tunes`, `console`, `item`, `quality`, `time`, `contextLines`), Git and the state of
 * the dev server. The rows of the scene come from the host plugins, else from the entities of the inspect report
 * (contextRows.ts). The page adds its own lines (`contextLines` of its editor plugins).
 * The cache keeps the last packet: the host refreshes it on surface events, and the `UserPromptSubmit` hook only
 * reads it (the hook has a 30 s limit).
 */
import { CONTEXT_LINES_CALL, INSPECT_CALL, URL_CALL } from "@scenity/bridge";
import { entityRows } from "./contextRows";
import { allowedPaths, withoutDenied } from "./denylist";
import { hostGit as runGit } from "./git";
import { fromTop } from "./workspace";
import { CONTEXT_MAX_LINES, SCENE_CAPABILITY, type ContextPacket } from "./protocol";
import { pluginContext } from "./plugins";
import { checkLines } from "./tools/checkReport";
import type { GitSummary, ServerInfo, SurfacePort, ToolContext } from "./tools/context";
import {
  callTyped,
  errorText,
  fmt,
  joinCut,
  labUrlFacts,
  number,
  record,
  shownUrl,
  text,
  type LabUrlFacts,
} from "./tools/kit";
import { sceneLine } from "./tools/browser";
import { tuneLines } from "./tools/tune";
import { measureBlock } from "./tools/measure";
import { pickedBlock } from "./tools/picked";

/** The time for each bridge call of the packet (ms). */
const PACKET_CALL_MS = 5_000;
/** The time for the checks of the packet (ms): they draw a frame. */
const PACKET_CHECK_MS = 15_000;

/**
 * Read the Git state of a checkout: the branch and the changed files (`git status --porcelain --branch`). The paths
 * are paths from the checkout (a workspace folder below the Git top folder gives `../` for a file outside).
 */
export async function gitSummary(checkout: string): Promise<GitSummary> {
  const [out, prefix] = await Promise.all([
    runGit(checkout, ["status", "--porcelain=v1", "--branch", "--untracked-files=all"]),
    runGit(checkout, ["rev-parse", "--show-prefix"]),
  ]);
  const rel = prefix.trim().replace(/\/$/, "");
  const lines = out.split("\n").filter((line) => line !== "");
  const head = lines[0]?.startsWith("## ") === true ? (lines.shift() ?? "") : "";
  const name = head.slice(3).split("...")[0]?.trim() ?? "";
  const branch = name === "" || name.startsWith("HEAD") ? null : name.replace(/^No commits yet on /, "");
  const changed = lines.map((line) => {
    const path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    return fromTop(arrow < 0 ? path : path.slice(arrow + 4), rel);
  });
  // The packet never names a file of the denylist.
  return { branch, changed: allowedPaths(changed) };
}

/** A settled call: the value, or the error text. */
type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function valueOf<T>(result: Settled<T>): T | null {
  return result.ok ? result.value : null;
}

/** The time since an ISO time, in words: "14 s", "3 min", "2 h". */
export function agoText(at: string | number, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 1000));
  if (seconds < 120) return `${String(seconds)} s`;
  if (seconds < 7200) return `${String(Math.round(seconds / 60))} min`;
  return `${String(Math.round(seconds / 3600))} h`;
}

/** The path of a file from the checkout, or the path as it is. */
function relative(file: string, checkout: string): string {
  const root = checkout.endsWith("/") ? checkout : `${checkout}/`;
  return file.startsWith(root) ? file.slice(root.length) : file;
}

/** The state of the dev server in one line. */
export function serverLine(info: ServerInfo | null, checkout: string, now: Date): string {
  if (info === null) return "Dev server: unknown.";
  const { status, port, error } = info.server;
  const parts = [`Dev server: ${status}${port === null ? "" : ` on port ${String(port)}`}`];
  if (error !== null) parts.push(` (${error})`);
  const edit = info.lastEdit;
  if (edit !== null) {
    const reload = edit.reloaded ? ", page reload" : "";
    parts.push(`, last edit ${agoText(edit.at, now)} ago (${relative(edit.file, checkout)}${reload})`);
  }
  return `${parts.join("")}.`;
}

/** The local date and time as `2026-10-12 15:04`. */
function stamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * The renderer backend of the frame statistics: ` Backend: webgl
 * (entry_not_built; the chooser gave webgpu).`, or "" when the statistics have no backend.
 */
export function backendPart(stats: unknown): string {
  const data = record(stats);
  const backend = text(data.backend);
  if (backend === null) return "";
  const reason = text(data.backendReason) ?? "?";
  const chosen = text(data.backendChosen);
  return ` Backend: ${backend} (${reason}${chosen !== null && chosen !== backend ? `; the chooser gave ${chosen}` : ""}).`;
}

/** The lines of the clock, the camera and the open item. */
function viewLines(facts: LabUrlFacts, time: number | null, quality: unknown, item: unknown, stats: unknown): string[] {
  const tier = text(record(quality).tier);
  const at = time ?? facts.t;
  // The packet does not build again while the clock plays, so its time is the time of the build.
  const state = facts.paused ? "paused" : "playing (the time of this packet; lab_state gives the time now)";
  const lines = [
    `Take: ${facts.take ?? "idle"}${facts.rec ? " with panel events" : ""} · source ${facts.source}. Clock: ${at === null ? "?" : fmt(at, 0)} ms, ${state}.`,
    `Camera: ${facts.camera}. Tier: ${tier ?? "?"}, ${facts.worker ? "worker" : "main thread"}.${backendPart(stats)}${facts.debug.length === 0 ? "" : ` Debug: ${facts.debug.join(", ")}.`}`,
  ];
  const open = record(item);
  const key = text(open.key);
  if (key !== null) lines.push(`Open item: ${key} (${text(open.title) ?? ""} · ${sceneLine(open.scene)})`);
  return lines;
}

type Ask = (name: string, args?: unknown[], ms?: number) => Promise<Settled<unknown>>;
type Inspect = () => Promise<Settled<unknown>>;

/**
 * The inspect report of a drawn frame. The bridge says `ready` when the lab API exists, which is before the renderer
 * draws its first frame (the WebGPU device, the assets). A report of that time has no time and no members. A stopped
 * clock gives no new packet after it, so the packet would show "On screen at ? ms" with no members. Thus a report
 * without a frame time waits for a frame (`frame`) and asks again.
 */
async function drawnReport(ask: Ask, inspect: Inspect, first: Settled<unknown>): Promise<Settled<unknown>> {
  if (first.ok && number(record(first.value).simMs) !== null) return first;
  const drawn = await ask("frame", [], PACKET_CHECK_MS);
  return drawn.ok ? inspect() : first;
}

/** The lines of the members on screen, or the reason that the packet has none. */
function screenLines(inspect: Settled<unknown>): string[] {
  const report = valueOf(inspect);
  const simMs = number(record(report).simMs);
  if (simMs === null) return [`On screen: no frame yet (${inspect.ok ? "the lab drew no frame" : inspect.error}).`];
  // A host plugin gives the rows of its scene. Else the host gives the entities of the report.
  const context = pluginContext();
  return [`On screen at ${String(simMs)} ms:`, ...(context.rows ? context.members(report) : entityRows(report))];
}

/** The lines of the surface: the frame, the members, the lines of the plugins, the checks and the tunes. */
async function surfaceLines(port: SurfacePort, url: string, ctx: ToolContext): Promise<string[]> {
  const ask: Ask = (name, args = [], ms = PACKET_CALL_MS) => settle(port.call(name, args, { timeoutMs: ms }));
  const report: Inspect = () => settle(callTyped(port, INSPECT_CALL, [], PACKET_CALL_MS));
  const facts = labUrlFacts(url);
  const [time, quality, item, state, inspect, tunes, stats, picked, measured, page] = await Promise.all([
    ask("time"),
    ask("quality"),
    ask("item"),
    ask("state"),
    report().then((first) => drawnReport(ask, report, first)),
    ask("tunes"),
    ask("stats"),
    // The item that the owner selected in the scene (an older lab page has no `picked`).
    ask("picked"),
    // The measurements in the frame (an older lab page has none).
    ask("measurements"),
    // The lines of the editor plugins of the page (an older page has none).
    settle(callTyped(port, CONTEXT_LINES_CALL, [], PACKET_CALL_MS)),
  ]);
  const lines = viewLines(facts, number(valueOf(time)), valueOf(quality), valueOf(item), valueOf(stats));
  lines.push(...pickedBlock(ctx.checkout, valueOf(picked)));
  lines.push(...measureBlock(valueOf(measured)));
  lines.push(...screenLines(inspect));
  if (state.ok) lines.push(...pluginContext().state(state.value));
  lines.push(...(valueOf(page) ?? []));
  if (facts.paused) {
    const check = await ask("check", [], PACKET_CHECK_MS);
    lines.push(
      ...(check.ok ? checkLines(check.value, { failures: 5, worst: 0 }) : [`Checks: failed (${check.error}).`]),
    );
  } else {
    lines.push("Checks: not run while the clock plays (stop the clock for them).");
  }
  lines.push(...tuneLines(record(valueOf(tunes)), 6));
  const log = await settle(ctx.consoleLog.pull(port));
  const entries = log.ok ? log.value : ctx.consoleLog.peek();
  lines.push(
    `Console: ${String(entries.errors.length)} errors, ${String(entries.warnings.length)} warnings (lab_console).`,
  );
  const last = entries.errors.at(-1);
  if (last !== undefined) lines.push(`  last error: ${last.slice(0, 200)}`);
  return lines;
}

/** The tools line of the packet. It names only core tools. The tools of the plugins come in the list. */
const TOOLS_LINE =
  "Tools: mcp__workbench__* (studio_state first, lab_frame for a picture, lab_sheet for a motion, lab_state for this packet, " +
  "scene_query, scene_commands and scene_command for the scene editor, and the tools of the project plugins).";

/** Cut the lines of a packet to CONTEXT_MAX_LINES. The function removes a line that names a file of the denylist. */
export function limitLines(input: readonly string[], max = CONTEXT_MAX_LINES): string[] {
  const lines = withoutDenied(input);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 2), `… ${String(lines.length - max + 1)} lines cut`, lines.at(-1) ?? ""];
}

/**
 * Build the context packet of the scene surface. A failed part gives a line with its error. The packet
 * names the surface by its manifest ID (a context without the ID names the capability).
 */
export async function buildPacket(ctx: ToolContext, surface = ctx.scene ?? SCENE_CAPABILITY): Promise<ContextPacket> {
  const now = ctx.now?.() ?? new Date();
  const port = ctx.surface("visible");
  const [url, gitState] = await Promise.all([
    settle(callTyped(port, URL_CALL, [], PACKET_CALL_MS)),
    settle((ctx.git ?? gitSummary)(ctx.checkout)),
  ]);
  const repo = valueOf(gitState);
  const changed = repo?.changed ?? [];
  const where =
    repo === null ? "Git unknown" : `${repo.branch ?? "detached HEAD"}, ${String(changed.length)} changed files`;
  const lines = [`Workbench context · ${stamp(now)} · checkout ${ctx.checkout} (${where})`];
  const href = url.ok ? url.value : null;
  if (href === null) {
    lines.push(`Surface: ${surface} · not ready (${url.ok ? "no URL" : url.error})`);
  } else {
    lines.push(`Surface: ${surface} · ${shownUrl(href)}`, ...(await surfaceLines(port, href, ctx)));
  }
  lines.push(serverLine(ctx.server?.() ?? null, ctx.checkout, now));
  if (changed.length > 0) lines.push(`Changed files: ${joinCut(changed, 6, "git status")}.`);
  lines.push(TOOLS_LINE);
  return { surface, made: now.toISOString(), checkout: ctx.checkout, url: href, text: limitLines(lines).join("\n") };
}

/** The cache of the packet: the host refreshes it, the hook reads it. */
export interface PacketCache {
  /** The last packet, or null. */
  current(): ContextPacket | null;
  /** Build a new packet after a short quiet time; many calls in that time give one build. */
  refresh(): void;
  /**
   * The packet for a prompt: a refresh that waits runs immediately, and a build that runs gets at most `waitMs`. The
   * answer is the newest packet at that time, or null.
   */
  read(waitMs?: number): Promise<ContextPacket | null>;
  stop(): void;
}

export interface PacketCacheOptions {
  /** The quiet time before a refresh builds (ms). */
  readonly debounceMs?: number;
  /** Called with each new packet (the host sends the `context.packet` event). */
  readonly onPacket?: (packet: ContextPacket) => void;
}

/** The search parameters of a lab URL without `t`, sorted, as one text; null for a text that is not a URL. */
function withoutTime(url: string): { readonly rest: string; readonly running: boolean } | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const running = params.get("paused") !== "1" && !params.has("freeze");
  params.delete("t");
  params.sort();
  return { rest: params.toString(), running };
}

/**
 * True when a URL change of the visible lab only moves the time `t` of a running clock (the lab writes the time
 * of a playing take into its URL). Such a change does not build the packet again: a pause, a seek of a stopped clock
 * and any other change of the URL do.
 */
export function playTick(previous: string | null, next: string): boolean {
  if (previous === null) return false;
  const before = withoutTime(previous);
  const after = withoutTime(next);
  if (before === null || after === null) return false;
  return before.running && after.running && before.rest === after.rest;
}

/** Make the cache of the packet around a build function. */
export function createPacketCache(build: () => Promise<ContextPacket>, options: PacketCacheOptions = {}): PacketCache {
  let packet: ContextPacket | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (): Promise<void> => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = build()
      .then((next) => {
        packet = next;
        options.onPacket?.(next);
      })
      .catch(() => undefined)
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void run();
        }
      });
    return running;
  };
  const flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    void run();
  };
  return {
    current: () => packet,
    refresh() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, options.debounceMs ?? 400);
    },
    async read(waitMs = 5_000) {
      flush();
      const work = running ?? (packet === null ? run() : null);
      if (work !== null) {
        let wait: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([work, new Promise((resolve) => (wait = setTimeout(resolve, waitMs)))]);
        clearTimeout(wait);
      }
      return packet;
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
