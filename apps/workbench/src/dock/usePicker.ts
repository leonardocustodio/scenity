// SPDX-License-Identifier: Apache-2.0
/**
 * The picker in Vue refs: the candidates, the sheets of the last job
 * (`picker.sheet` events), the pick and the skip. A pick writes the pairwise labels to `labels.jsonl` of the intent.
 */
import type { PickCandidate, PickSheet, PickWindow } from "@scenity/workbench-host/protocol";
import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import type { DockHost } from "./dockHost";

export interface PickerApi {
  /** The candidates that the host knows and the ones that the owner added. */
  readonly candidates: Ref<PickCandidate[]>;
  /** The candidates of the job now, in the order of the keys 1 to 9. */
  readonly shown: Ref<PickCandidate[]>;
  readonly sheets: Ref<Record<string, PickSheet>>;
  readonly window: Ref<PickWindow | null>;
  readonly notice: Ref<string | null>;
  readonly error: Ref<string | null>;
  load(): Promise<void>;
  /** Add a tune candidate (a tune text `path:value,…`). */
  addTune(label: string, tune: string): void;
  /** Make the sheets of the chosen candidates over one window. */
  run(window: PickWindow, chosen: readonly PickCandidate[]): Promise<void>;
  /** Pick a candidate (an index of `shown`), or skip with null. */
  pick(intent: string, index: number | null, why: string): Promise<boolean>;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * The picture of a sheet: the ID of the shadow sheet in the picture store of the host, or null. PictureImg.vue shows
 * the ID as an object URL. A worktree sheet has null and loads as a run file.
 */
export function sheetPicture(sheet: PickSheet): string | null {
  return sheet.picture;
}

export function usePicker(host: Pick<DockHost, "request" | "on">): PickerApi {
  const candidates = ref<PickCandidate[]>([]);
  const shown = ref<PickCandidate[]>([]);
  const sheets = ref<Record<string, PickSheet>>({});
  const window = ref<PickWindow | null>(null);
  const notice = ref<string | null>(null);
  const error = ref<string | null>(null);
  let job: string | null = null;
  let added = 0;

  const stop = host.on("picker.sheet", ({ sheet }) => {
    if (sheet.job === job) sheets.value = { ...sheets.value, [sheet.candidate]: sheet };
  });
  if (getCurrentScope() !== undefined) onScopeDispose(stop);

  async function load(): Promise<void> {
    try {
      const known = await host.request("picker.candidates", {});
      const own = candidates.value.filter((item) => item.id.startsWith("own-"));
      candidates.value = [...known, ...own];
      error.value = null;
    } catch (reason) {
      error.value = message(reason);
    }
  }

  function addTune(label: string, tune: string): void {
    added += 1;
    const id = `own-${String(added)}`;
    candidates.value = [...candidates.value, { id, label: label.trim() || tune, kind: "tune", tune: tune.trim() }];
  }

  async function run(next: PickWindow, chosen: readonly PickCandidate[]): Promise<void> {
    error.value = null;
    notice.value = null;
    try {
      const answer = await host.request("picker.sheets", { window: next, candidates: [...chosen] });
      job = answer.job;
      shown.value = [...chosen];
      sheets.value = {};
      window.value = next;
    } catch (reason) {
      error.value = message(reason);
    }
  }

  async function pick(intent: string, index: number | null, why: string): Promise<boolean> {
    const winner = index === null ? null : (shown.value[index]?.id ?? undefined);
    if (winner === undefined || window.value === null) return false;
    try {
      const params = { intent, window: window.value, candidates: shown.value, winner, ...(why === "" ? {} : { why }) };
      const answer = await host.request("picker.pick", params);
      notice.value =
        winner === null ? `Skipped: ${answer.file}` : `${String(answer.labels)} labels for ${winner}: ${answer.file}`;
      error.value = null;
      return true;
    } catch (reason) {
      error.value = message(reason);
      return false;
    }
  }

  void load();
  return { candidates, shown, sheets, window, notice, error, load, addTune, run, pick };
}
