// SPDX-License-Identifier: Apache-2.0
/**
 * The models of the scratch props in the lab page: the `preview.glb` of each import as plain meshes for the core, the
 * import facts for the card, and the failures. A page that opens with scratch props asks the workbench page for their
 * models (the bridge event `scratch`). A page without the workbench, or a model that does not come in MODEL_WAIT_MS,
 * gives a failure with a warning. Thus the frames stop their wait. The failure texts are Fluent messages of
 * `src/i18n/en-US/scratch.ftl`.
 */
import { bridgeOrigin } from "@scenity/bridge";
import type { ScratchModel } from "@scenity/runtime-dev";
import { ref, shallowRef } from "vue";
import { loadPreview } from "../importDrop/previewModel";
import { t } from "../../texts";
import { readInfo, type ScratchInfo } from "./scratchInfo";

/** The longest wait for a model that the page asked for (ms); then the wait of the frames ends. */
export const MODEL_WAIT_MS = 30_000;
/** The time between two checks for the bridge of a page in a workbench frame (ms). The bridge can start later. */
const BRIDGE_POLL_MS = 100;

/** True for a page in a frame of the workbench. Its bridge comes, possibly after the scratch list. */
function inWorkbenchFrame(): boolean {
  return bridgeOrigin(globalThis.location.search) !== null && globalThis.parent !== globalThis.window;
}

/** The model of the bytes of a `preview.glb` (metres, the base centre at the origin). */
async function modelOf(id: string, bytes: ArrayBuffer): Promise<ScratchModel> {
  const made = await loadPreview(bytes, { id, name: `${id}.glb`, at: [0, 0, 0], format: ".glb" });
  return { id, meshes: made.meshes };
}

export class ScratchModels {
  readonly infos = shallowRef<ReadonlyMap<string, ScratchInfo>>(new Map());
  readonly failures = shallowRef<ReadonlyMap<string, string>>(new Map());
  /** A new value at each new model: the models with their bitmaps are not reactive. */
  readonly version = ref(0);
  private readonly models = new Map<string, ScratchModel>();
  private readonly asked = new Set<string>();

  has(id: string): boolean {
    return this.models.has(id);
  }

  /** True when a model of the IDs is not here and did not fail (the frames wait). */
  waiting(ids: readonly string[]): boolean {
    return ids.some((id) => !this.models.has(id) && !this.failures.value.has(id));
  }

  /** The models that the page has. */
  all(): ScratchModel[] {
    return [...this.models.values()];
  }

  fail(id: string, reason: string): void {
    if (this.models.has(id) || this.failures.value.has(id)) return;
    console.warn(`Scratch prop model ${id}: ${reason}`);
    this.failures.value = new Map([...this.failures.value, [id, reason]]);
  }

  /** Keep the model of an import and its facts. A model after a failure (from a tool) removes the failure. */
  async add(id: string, bytes: ArrayBuffer, info: ScratchInfo): Promise<void> {
    this.infos.value = new Map([...this.infos.value, [id, info]]);
    if (!this.models.has(id)) this.models.set(id, await modelOf(id, bytes));
    if (this.failures.value.has(id)) {
      this.failures.value = new Map([...this.failures.value].filter(([key]) => key !== id));
    }
    this.version.value += 1;
  }

  /** The answer of the workbench page (`scratchModel`): the model, or (bytes null) the reason of a failure. */
  async receive(bytes: ArrayBuffer | null, value: unknown): Promise<void> {
    const info = readInfo(value);
    const item = (typeof value === "object" && value !== null ? value : {}) as { import?: unknown; error?: unknown };
    const id = info?.import ?? item.import;
    if (typeof id !== "string") return;
    if (bytes !== null && info !== null) await this.add(id, bytes, info);
    else this.fail(id, typeof item.error === "string" ? item.error : t("scratch-model-none"));
  }

  /** Ask the workbench page for the models of the IDs that the page does not have and did not ask for. */
  ask(ids: readonly string[], started = performance.now()): void {
    const missing = ids.filter((id) => !this.models.has(id) && !this.failures.value.has(id) && !this.asked.has(id));
    if (missing.length === 0) return;
    const bridge = globalThis.__workbench;
    if (bridge === undefined && inWorkbenchFrame() && performance.now() - started < MODEL_WAIT_MS) {
      setTimeout(() => {
        this.ask(ids, started);
      }, BRIDGE_POLL_MS);
      return;
    }
    if (bridge === undefined) {
      for (const id of missing) this.fail(id, t("scratch-model-needs-host"));
      return;
    }
    for (const id of missing) this.asked.add(id);
    bridge.emit({ event: "scratch", need: missing });
    setTimeout(() => {
      for (const id of missing) this.fail(id, t("scratch-model-timeout", { seconds: String(MODEL_WAIT_MS / 1000) }));
    }, MODEL_WAIT_MS);
  }
}
