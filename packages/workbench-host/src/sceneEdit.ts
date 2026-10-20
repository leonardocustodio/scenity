// SPDX-License-Identifier: Apache-2.0
/**
 * The scene edit events of the lab frame:
 *
 * - `ask`: the owner typed a request about the picked item in the selection card. The host types it into the newest
 *   live Claude terminal of the checkout (then Enter), else gives it to the newest chat session. The prompt hook adds
 *   the context packet, and the packet has the "picked" block of the selection, so the request needs no more words.
 * - `placement`: "Save placement". The host runs `labs tune-apply` with the place values of the lab (a run of the Runs
 *   tab: the dry run first, then the real one). It returns the output to the lab card (`placementResult`), so the
 *   owner sees the lines that change before the apply. The Changes tab shows the changed source after the apply.
 *   A placement that the owner saves while a layout check fails carries the reason
 *   (`override`). The output of the placement starts with it, for the commit message of the owner.
 *
 * - `camera`: "Save camera". The host runs `labs camera-save <name> --view=<view>` (a run of the Runs tab: the dry
 *   run with the lines that change, then the write into the cameras of the editor plugin). It returns the output to
 *   the View tab of the lab (`cameraResult`).
 *
 * - `layout`: "Save layout as". The host runs `labs layout-save <name> --tunes=<text>` (a run of the Runs tab: the
 *   dry run, then the write of apps/editor/src/core/layouts/<name>.json). It returns the output to the lab
 *   (`layoutResult`). `variants` gives the variants of a layout search to the picker (`offer`).
 *
 * - `promote`: "Promote to the room" of a scratch prop (promoteRun.ts). A dry run returns the "what will
 *   change" list to the card. A real run makes a project asset of the model and an entity at the place of the
 *   scratch prop in the scene document. The host writes no Claude prompt.
 *
 * The lab gets the answer of each event through its bridge (`askResult`, `placementResult`, `cameraResult`,
 * `promoteResult`).
 */
import type { PromoteProject } from "./promote";
import { promoteImport, type PromoteDeps } from "./promoteRun";
import {
  isLayoutTuneText,
  type BridgeCameraEvent,
  type BridgeLayoutEvent,
  type BridgeVariantsEvent,
} from "@scenity/bridge";
import { layoutSaveArgs } from "./layoutProtocol";
import { pluginPaths } from "./plugins";
import type { BridgeEvent, BridgePromoteEvent, HostEvent, PromoteResult, SurfaceWhere } from "./protocol";
import type { RunResult } from "./runs";
import type { SurfacePort } from "./tools/context";

/** The wait between the text of a request and its Enter in the Claude terminal (ms): the CLI reads them apart. */
export const ASK_ENTER_MS = 150;

/** The parts of the host that the scene edit events use. A test gives fakes. */
export interface SceneEditDeps {
  readonly terminals: {
    claudeTerminals(): readonly {
      readonly id: string;
      readonly checkout: string;
      readonly startedMs: number;
      readonly live: boolean;
    }[];
    input(id: string, data: string): void;
  };
  readonly chat: {
    live(): readonly { readonly info: { readonly session: string; readonly checkout: string } }[];
    get(id: string): { prompt(text: string): void };
  };
  readonly runs: {
    start(
      checkout: string,
      command: string,
      args: readonly unknown[],
      options?: { onOutput?(stream: "stdout" | "stderr", text: string): void },
    ): { run: string; done: Promise<RunResult> };
  };
  current(): string;
  /** The port of the visible lab frame (its bridge calls). */
  lab(): SurfacePort;
  /** The ID of the scene surface, whose visible frame sends the events. Absent: each visible frame (a test). */
  scene?(): string | null;
  /** A wait (a test gives one that does not wait). */
  readonly delay?: (ms: number) => Promise<void>;
  /** The folder of the imports in the state folder (imports.ts `ImportJobs.folder`). */
  readonly importsDir?: string;
  /** The project of the open checkout (the target of a promote). Absent: the checkout. */
  project?(): PromoteProject;
  /** Send an event to the pages (the `scene.saved` of a promote). */
  readonly broadcast?: (event: HostEvent) => void;
  /** The picker keeps the variants of a layout search as candidates (picker.ts). */
  readonly offer?: (event: BridgeVariantsEvent) => void;
  /**
   * Keep the reason of a layout override of a real apply that passed, for the commit message proposal
   * (commitNotes.ts). Absent: the reason shows only in the output.
   */
  readonly noteOverride?: (reason: string) => void;
}

/** Where an `ask` went: the Claude terminal, the chat, or nowhere (no live session). */
export type AskTarget = "terminal" | "chat" | null;

/** One line for the Claude terminal: the line breaks of the request become spaces, so Enter sends all of it. */
export function askLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Give the request to the newest live Claude terminal of the checkout, else to the newest chat session. */
export async function sendAsk(deps: SceneEditDeps, text: string): Promise<AskTarget> {
  const line = askLine(text);
  if (line === "") return null;
  const checkout = deps.current();
  const terminal = deps.terminals
    .claudeTerminals()
    .filter((item) => item.live && item.checkout === checkout)
    .sort((a, b) => b.startedMs - a.startedMs)[0];
  if (terminal !== undefined) {
    deps.terminals.input(terminal.id, line);
    await (deps.delay ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(ASK_ENTER_MS);
    deps.terminals.input(terminal.id, "\r");
    return "terminal";
  }
  const session = deps.chat
    .live()
    .filter((item) => item.info.checkout === checkout)
    .at(-1);
  if (session !== undefined) {
    deps.chat.get(session.info.session).prompt(text.trim());
    return "chat";
  }
  return null;
}

/** The selection of a lab URL (`sel=<kind>:<id>`), or null. */
function selectionOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).searchParams.get("sel");
  } catch {
    return null;
  }
}

/**
 * True when a URL of the visible lab has another selection than the last packet. Then the packet must build again,
 * also in the quiet time after a build. The quiet time stops the clock moves of the `check` of the packet. A pick of
 * the owner is not one of them, and the next prompt needs its picked block.
 */
export function selectionMoved(packetUrl: string | null, next: string): boolean {
  return selectionOf(packetUrl) !== selectionOf(next);
}

/**
 * The tune paths that a placement can write (for example the prop places, the bends of the cable routes, the hand
 * targets and the light). The host plugin gives them (`paths.placement`). The lab has
 * the same list (`EDITOR_PREFIXES` of the editor plugin), and a test of the plugin keeps the two the same.
 */
export function placementPaths(): readonly RegExp[] {
  return pluginPaths().placement ?? [];
}

/** The place values of a placement: only the pairs of `placementPaths` with a number pass (a lab frame gives the text). */
export function placementPairs(values: string): string {
  const rules = placementPaths();
  return values
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => {
      const cut = pair.lastIndexOf(":");
      const path = pair.slice(0, cut);
      const value = pair.slice(cut + 1);
      return cut > 0 && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value) && rules.some((rule) => rule.test(path));
    })
    .join(",");
}

/** The answer of a placement to the lab card. */
export interface PlacementResult {
  readonly run: string | null;
  readonly dry: boolean;
  readonly status: string;
  readonly output: string;
  /** The reason of the owner to save while a layout check fails, or absent. */
  readonly override?: string;
}

/** The first line of the output of a placement with a layout override. */
export function overrideLine(reason: string): string {
  // The host puts the reason into the commit message proposal of the Changes tab.
  return `Layout checks overridden: ${reason.replace(/\s+/g, " ").trim()} (the commit message proposal has this reason).`;
}

/**
 * The last line of the output of a real apply: each place value is a tunable of the runtime source of the
 * room plugin, so the runtime gates run before the commit.
 */
export const RUNTIME_GATES_LINE =
  "Runtime change: run the runtime gates before the commit: bun run build && bun run size, bun run labs parity, " +
  "bun run labs verify --visual.";

/**
 * Run `labs tune-apply` of the place values, dry or real, and give the output when the run ends. With a
 * layout override, the output starts with its reason.
 */
export async function runPlacement(
  deps: SceneEditDeps,
  values: string,
  dry: boolean,
  override?: string,
): Promise<PlacementResult> {
  const reason = override?.trim() ?? "";
  const applied = await tuneApply(deps, values, dry);
  const passed = !dry && applied.status === "passed";
  const done = passed ? { ...applied, output: `${applied.output}\n${RUNTIME_GATES_LINE}` } : applied;
  if (passed && reason !== "") deps.noteOverride?.(reason);
  return reason === "" ? done : { ...done, override: reason, output: `${overrideLine(reason)}\n${done.output}` };
}

/** Run `labs tune-apply` of the place values, dry or real. */
async function tuneApply(deps: SceneEditDeps, values: string, dry: boolean): Promise<PlacementResult> {
  const pairs = placementPairs(values);
  if (pairs === "") return { run: null, dry, status: "failed", output: "No place values to save." };
  let output = "";
  const { run, done } = deps.runs.start(deps.current(), "tune-apply", dry ? [pairs, "--dry"] : [pairs], {
    onOutput: (_stream, text) => {
      output += text;
    },
  });
  const result = await done;
  return { run, dry, status: result.status, output: output.trim() || result.summary };
}

/** The answer of a camera save to the View tab of the lab. */
export interface CameraResult {
  readonly run: string | null;
  readonly dry: boolean;
  readonly status: string;
  readonly output: string;
}

/** The arguments of `labs camera-save` for a `camera` event (the view as one `--view=` argument). */
export function cameraSaveArgs(event: Omit<BridgeCameraEvent, "workbench">): string[] {
  return [
    event.name,
    `--view=${event.view}`,
    ...(event.doc === undefined ? [] : [`--doc=${event.doc}`]),
    ...(event.replace === true ? ["--replace"] : []),
    ...(event.dry ? ["--dry"] : []),
  ];
}

/** Run `labs camera-save` of a camera event, dry or real, and give the output when the run ends. */
export async function runCameraSave(deps: SceneEditDeps, event: BridgeCameraEvent): Promise<CameraResult> {
  let output = "";
  const { run, done } = deps.runs.start(deps.current(), "camera-save", cameraSaveArgs(event), {
    onOutput: (_stream, text) => {
      output += text;
    },
  });
  const result = await done;
  return { run, dry: event.dry, status: result.status, output: output.trim() || result.summary };
}

/** True for a tune text of the layout paths of the host plugin (empty is the layout of the code). */
export function layoutValues(text: string): boolean {
  const rule = pluginPaths().layoutPair;
  return rule === undefined ? text === "" : isLayoutTuneText(text, rule);
}

/** Run `labs layout-save` of a layout event, dry or real, and give the output when the run ends. */
export async function runLayoutSave(deps: SceneEditDeps, event: BridgeLayoutEvent): Promise<CameraResult> {
  // The bridge checks the form of each pair. The host plugin gives the paths that a layout can write.
  if (!layoutValues(event.tunes)) {
    return {
      run: null,
      dry: event.dry,
      status: "failed",
      output: "The layout values have a tune path that the plugin does not allow.",
    };
  }
  let output = "";
  const { run, done } = deps.runs.start(deps.current(), "layout-save", layoutSaveArgs(event), {
    onOutput: (_stream, text) => {
      output += text;
    },
  });
  const result = await done;
  return { run, dry: event.dry, status: result.status, output: output.trim() || result.summary };
}

/**
 * "Promote to the room" of a scratch prop: the promote of its import at its place (promoteRun.ts). A dry run gives
 * the list of the changes. A real run makes the project asset and the entity. No Claude prompt.
 */
export async function runPromote(deps: SceneEditDeps, event: BridgePromoteEvent): Promise<PromoteResult> {
  const { importsDir, broadcast, noteOverride } = deps;
  const promote: PromoteDeps = {
    current: () => deps.current(),
    ...(importsDir === undefined ? {} : { importsDir }),
    ...(deps.project === undefined
      ? {}
      : { project: () => deps.project?.() ?? { dir: deps.current(), manifest: null } }),
    ...(broadcast === undefined ? {} : { broadcast }),
    ...(noteOverride === undefined ? {} : { noteOverride }),
  };
  return promoteImport(promote, { import: event.import, at: event.at, turnDeg: event.turnDeg, dry: event.dry });
}

/** The handler of the surface events for the scene edit; the host calls it for each event of a frame. */
export function sceneEditEvents(
  deps: SceneEditDeps,
): (surface: string, where: SurfaceWhere, event: BridgeEvent) => void {
  const answer = (call: string, value: unknown): void => {
    deps
      .lab()
      .call(call, [value], { timeoutMs: 10_000 })
      .catch(() => undefined);
  };
  return (surface, where, event) => {
    if (where !== "visible" || (deps.scene !== undefined && surface !== deps.scene())) return;
    if (event.event === "ask") {
      void sendAsk(deps, event.text).then(
        (to) => answer("askResult", { to }),
        (error: unknown) => answer("askResult", { to: null, error: String(error) }),
      );
    } else if (event.event === "promote") {
      void runPromote(deps, event).then(
        (result) => answer("promoteResult", result),
        (error: unknown) =>
          answer("promoteResult", {
            ...{ dry: event.dry, refused: String(error), changes: [] },
            ...{ asset: null, entity: null, rights: null, followUp: [] },
          }),
      );
    } else if (event.event === "camera") {
      void runCameraSave(deps, event).then(
        (result) => answer("cameraResult", result),
        (error: unknown) =>
          answer("cameraResult", { run: null, dry: event.dry, status: "failed", output: String(error) }),
      );
    } else if (event.event === "layout") {
      void runLayoutSave(deps, event).then(
        (result) => answer("layoutResult", result),
        (error: unknown) =>
          answer("layoutResult", { run: null, dry: event.dry, status: "failed", output: String(error) }),
      );
    } else if (event.event === "variants") {
      deps.offer?.({ ...event, variants: event.variants.filter((variant) => layoutValues(variant.tune)) });
    } else if (event.event === "placement") {
      void runPlacement(deps, event.values, event.dry, event.override).then(
        (result) => answer("placementResult", result),
        (error: unknown) =>
          answer("placementResult", { run: null, dry: event.dry, status: "failed", output: String(error) }),
      );
    }
  };
}
