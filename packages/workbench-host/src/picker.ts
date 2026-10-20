// SPDX-License-Identifier: Apache-2.0
/**
 * The picker of the workbench: N candidates as tiles, each
 * with a contact sheet of the same window and cameras, and one key per pick. A candidate is a set of tune values of
 * the lab (its sheet comes from the shadow frame with the `sheet` call of the bridge, as `lab_sheet`) or a worktree of
 * a background run (its sheet is a run of `labs sheet` in that worktree). A pick writes pairwise labels (the winner
 * against each other candidate) to `apps/editor/intents/<intent>/labels.jsonl` of the open checkout.
 *
 * The layout variants are also tune candidates: the saved layouts of the checkout and
 * the variants of the last layout search of the lab (`offer`, layoutCandidates.ts).
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PictureSink } from "./agent/messages";
import {
  isCaptureMime,
  isIntentId,
  isRecord,
  labelsPath,
  type HostEvent,
  type PickCandidate,
  type PickSheet,
  type PickWindow,
} from "./protocol";
import { WEB_DIR } from "./runArgs";
import { offeredCandidates, savedLayoutCandidates } from "./layoutCandidates";
import type { LayoutVariantOffer } from "@scenity/bridge";
import type { LoopRuns } from "./loopRun";
import { startWhenFree } from "./stopGate";
import type { SurfacePort, ToolIndex } from "./tools/context";
import { indexSheetOf } from "./tools/indexTools";
import { FRAME_TIMEOUT_MS, labUrlFacts, pictureBytes, record } from "./tools/kit";
import { MAX_SHEET_CELLS, sheetTimes } from "./tools/sheet";

/** The width of one sheet of a tile (px). */
export const TILE_SHEET_WIDTH = 960;
/** The most candidates of one pick: the keys 1 to 9. */
export const MAX_CANDIDATES = 9;

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const TUNE_PAIR = /^[A-Za-z0-9_.[\]-]+:-?\d+(\.\d+)?(e-?\d+)?$/;

/** Check the window of a pick. Throw an error for a bad window. */
export function checkWindow(window: unknown): PickWindow {
  if (!isRecord(window)) throw new Error('The parameter "window" must be an object.');
  const { take, from, to, step, cameras } = window;
  if (typeof take !== "string" || !NAME.test(take)) throw new Error("The take of the window is not valid.");
  const times = sheetTimes(Number(from), Number(to), Number(step));
  const list = Array.isArray(cameras) ? cameras : [];
  if (list.length === 0 || list.length > 4 || !list.every((name) => typeof name === "string" && NAME.test(name))) {
    throw new Error("The window needs 1 to 4 named cameras.");
  }
  if (times.length * list.length > MAX_SHEET_CELLS) {
    throw new Error(`At most ${String(MAX_SHEET_CELLS)} cells (times × cameras); use a larger step.`);
  }
  return { take, from: Number(from), to: Number(to), step: Number(step), cameras: list as string[] };
}

/** Read a tune text `path:value,path:value` into pairs. Throw an error for a bad pair. */
export function tunePairs(tune: string): [string, number][] {
  if (tune.trim() === "") return [];
  return tune.split(",").map((pair) => {
    const text = pair.trim();
    if (!TUNE_PAIR.test(text)) throw new Error(`Not a tune value "path:number": ${text}`);
    const at = text.lastIndexOf(":");
    return [text.slice(0, at), Number(text.slice(at + 1))];
  });
}

/** Check the candidates of a pick. */
export function checkCandidates(value: unknown): PickCandidate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CANDIDATES) {
    throw new Error(`A pick needs 2 to ${String(MAX_CANDIDATES)} candidates.`);
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !NAME.test(item.id) || ids.has(item.id)) {
      throw new Error("Each candidate needs its own ID (letters, digits, _ and -).");
    }
    ids.add(item.id);
    const label = typeof item.label === "string" ? item.label.slice(0, 120) : item.id;
    if (item.kind === "tune") {
      const tune = typeof item.tune === "string" ? item.tune : "";
      tunePairs(tune);
      return { id: item.id, label, kind: "tune", tune };
    }
    if (item.kind === "worktree" && typeof item.path === "string" && item.path.startsWith("/")) {
      return { id: item.id, label, kind: "worktree", path: item.path };
    }
    throw new Error(`The candidate ${item.id} needs the kind "tune" or "worktree" with its value.`);
  });
}

export interface PickerOptions {
  /** The shadow frame of the open checkout. */
  shadow(): SurfacePort;
  /** The URL of the visible lab frame (the current tune values), or null. */
  labUrl(): string | null;
  readonly runs: LoopRuns;
  /** The worktrees of the background runs. */
  worktrees(): readonly { loop: string; path: string; prompt: string }[];
  /** The checkouts that the host knows: a worktree candidate must be one. */
  isCheckout(path: string): Promise<boolean>;
  current(): string;
  emit(event: HostEvent): void;
  readonly now?: () => Date;
  /** The picture store of the host: the sheets of the tune candidates go there. */
  readonly pictures: PictureSink;
  /** The frame index of the host: a tune sheet comes from it when every cell is there. */
  readonly index?: ToolIndex;
}

/**
 * The sheet of a tune candidate from the shadow frame: the take, the defaults, the tune values, then `sheet`. The
 * bytes go to the picture store, and the page gets the ID. The frame index gives the sheet when it has every cell
 * under the key of the shadow state (the same take, events and tune values). Else the shadow draws it.
 */
async function tuneSheet(
  port: SurfacePort,
  window: PickWindow,
  tune: string,
  pictures: PictureSink,
  index?: ToolIndex,
): Promise<{ mime: string; picture: string }> {
  await port.call("load", [window.take], { timeoutMs: FRAME_TIMEOUT_MS });
  await port.call("resetTunes", [], { timeoutMs: FRAME_TIMEOUT_MS });
  for (const [path, value] of tunePairs(tune)) await port.call("tune", [path, value], { timeoutMs: FRAME_TIMEOUT_MS });
  const times = sheetTimes(window.from, window.to, window.step);
  const indexed = index === undefined ? null : await indexSheetOf(index, port, times, window.cameras, TILE_SHEET_WIDTH);
  if (indexed !== null) return { mime: "image/jpeg", picture: pictures.put(indexed.bytes, "image/jpeg") };
  const args = { times, cameras: window.cameras, maxWidth: TILE_SHEET_WIDTH };
  const sheet = record(await port.call("sheet", [args], { timeoutMs: FRAME_TIMEOUT_MS * 4 }));
  const bytes = pictureBytes(sheet);
  if (bytes === null) throw new Error("The shadow frame gave no sheet.");
  const mime = isCaptureMime(sheet.mime) ? sheet.mime : "image/webp";
  return { mime, picture: pictures.put(bytes, mime) };
}

/** The picker of one host. */
export class Picker {
  readonly #options: PickerOptions;
  /** The variants of the last layout search of the lab. */
  #offered: PickCandidate[] = [];

  constructor(options: PickerOptions) {
    this.#options = options;
  }

  /** The candidates that the host knows: the defaults, the current tune values of the lab, the run worktrees. */
  candidates(): PickCandidate[] {
    const list: PickCandidate[] = [{ id: "defaults", label: "Defaults (no tune)", kind: "tune", tune: "" }];
    let url: string | null = null;
    try {
      url = this.#options.labUrl();
    } catch {
      // No lab surface yet: the candidates without the lab.
    }
    const tune = labUrlFacts(url).tune;
    if (tune !== null && tune !== "") list.push({ id: "now", label: "The lab now", kind: "tune", tune });
    for (const item of this.#options.worktrees()) {
      list.push({ id: item.loop, label: item.prompt.slice(0, 80), kind: "worktree", path: item.path });
    }
    // The saved layouts of the checkout and the variants of the last layout search.
    list.push(...savedLayoutCandidates(this.#options.current()), ...this.#offered);
    return list;
  }

  /** Keep the variants of a layout search of the lab as candidates (a new search replaces them). */
  offer(seed: number, variants: readonly LayoutVariantOffer[]): void {
    this.#offered = offeredCandidates(seed, variants);
  }

  /** Start the sheets of a pick. Give the job ID; one `picker.sheet` event comes per candidate, in order. */
  async sheets(rawWindow: unknown, rawCandidates: unknown): Promise<string> {
    const window = checkWindow(rawWindow);
    const candidates = checkCandidates(rawCandidates);
    for (const item of candidates) {
      if (item.kind === "worktree" && !(await this.#options.isCheckout(item.path ?? ""))) {
        throw new Error(`The candidate ${item.id} is not a worktree of the repository.`);
      }
    }
    const job = `pick-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
    void this.#make(job, window, candidates);
    return job;
  }

  async #make(job: string, window: PickWindow, candidates: readonly PickCandidate[]): Promise<void> {
    for (const item of candidates) {
      const sheet: PickSheet = {
        job,
        candidate: item.id,
        mime: null,
        picture: null,
        run: null,
        image: null,
        error: null,
      };
      try {
        if (item.kind === "tune") {
          const { pictures, index } = this.#options;
          const made = await tuneSheet(this.#options.shadow(), window, item.tune ?? "", pictures, index);
          this.#options.emit({ type: "picker.sheet", sheet: { ...sheet, ...made } });
        } else {
          const result = await startWhenFree(this.#options.runs, item.path ?? "", "sheet", [
            ...["--take", window.take, "--from", String(window.from), "--to", String(window.to)],
            ...["--step", String(window.step), "--camera", window.cameras.join(",")],
          ]);
          const image = result.outDir === null ? null : join(result.outDir, "sheet.png");
          const error = result.status === "passed" ? null : `labs sheet ${result.status}: ${result.summary}`;
          this.#options.emit({ type: "picker.sheet", sheet: { ...sheet, run: result.run, image, error } });
        }
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason);
        this.#options.emit({ type: "picker.sheet", sheet: { ...sheet, error } });
      }
    }
    await this.#options
      .shadow()
      .call("resetTunes", [], { timeoutMs: FRAME_TIMEOUT_MS })
      .catch(() => null);
  }

  /** Record a pick: the pairwise labels of the winner, or one skip line. Give the file and the count of labels. */
  pick(params: { intent: unknown; window: unknown; candidates: unknown; winner: unknown; why?: unknown }): {
    file: string;
    labels: number;
  } {
    if (!isIntentId(params.intent)) throw new Error('The parameter "intent" is not an intent ID (a-z, 0-9 and -).');
    const window = checkWindow(params.window);
    const candidates = checkCandidates(params.candidates);
    const winner = params.winner === null ? null : candidates.find((item) => item.id === params.winner);
    if (winner === undefined) throw new Error('The parameter "winner" must be the ID of a candidate, or null.');
    const why = typeof params.why === "string" ? params.why.trim().slice(0, 500) : "";
    const file = join(this.#options.current(), WEB_DIR, labelsPath(params.intent));
    const at = (this.#options.now?.() ?? new Date()).toISOString();
    const base = { at, intent: params.intent, source: "workbench", window, candidates: candidates.map((c) => c.id) };
    const value = (item: PickCandidate): string =>
      item.kind === "tune" ? `tune:${item.tune ?? ""}` : `worktree:${item.path ?? ""}`;
    const lines =
      winner === null
        ? [{ ...base, skip: true, ...(why === "" ? {} : { why }) }]
        : candidates
            .filter((item) => item.id !== winner.id)
            .map((loser) => ({
              ...base,
              winner: winner.id,
              loser: loser.id,
              winnerValue: value(winner),
              loserValue: value(loser),
              ...(why === "" ? {} : { why }),
            }));
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    return { file, labels: winner === null ? 0 : lines.length };
  }
}
