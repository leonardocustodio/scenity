// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the asset browser: the list of the source, the filters, the selected asset with its "used by" lines, and
 * the imports of chosen or dropped files.
 *
 * The status notes are Fluent messages of `src/i18n/en-US/assets.ftl`.
 */
import { computed, ref, shallowRef, type Ref } from "vue";
import { filterAssets, kindsOf, tagsOf, useLines, type UseScene } from "./assetFilter";
import type { AssetSource } from "./assetClient";
import { useAssetRights } from "./useAssetRights";
import { useAssetStills } from "./useAssetStills";
import type { AssetImportResult, AssetList, AssetListEntry, ImportOptions } from "./assetTypes";

/** One file of the import queue: its name, its state and the reason of a failure. */
export interface QueuedImport {
  readonly name: string;
  readonly state: "waiting" | "importing" | "done" | "failed" | "cancelled";
  readonly reason?: string;
}
import { t } from "../texts";

/** The open scene of the editor, for the "used by" lines (null: no open scene). */
export type OpenScene = () => { readonly path: string; readonly scene: UseScene } | null;

/** Toggle a value in a list of picked values. */
function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** The status note of a done import: the file, the source of the new asset and the warnings of the importer. */
function importedNote(file: string, source: string, warnings: readonly string[]): string {
  if (warnings.length === 0) return t("assets-imported", { file, source });
  return t("assets-imported-warnings", { file, source, warnings: warnings.join("; ") });
}

/** The parts of the browser state that the import queue changes. */
interface QueueParts {
  readonly queue: { value: readonly QueuedImport[] };
  readonly control: { readonly cancelled: boolean };
  readonly notes: string[];
  status(file: string): void;
}

/** Import each file of the queue in turn. Returns the IDs of the new assets, in their order. */
async function importQueue(
  files: readonly File[],
  importFile: (file: File) => Promise<AssetImportResult>,
  parts: QueueParts,
): Promise<string[]> {
  const { queue, control, notes } = parts;
  const made: string[] = [];
  queue.value = files.map((file) => ({ name: file.name, state: "waiting" }));
  const mark = (index: number, item: QueuedImport): void => {
    queue.value = queue.value.map((each, at) => (at === index ? item : each));
  };
  for (const [index, file] of files.entries()) {
    if (control.cancelled) {
      mark(index, { name: file.name, state: "cancelled" });
      continue;
    }
    parts.status(file.name);
    mark(index, { name: file.name, state: "importing" });
    const result = await importFile(file);
    if (result.ok) {
      made.push(result.asset.id);
      notes.push(importedNote(file.name, result.asset.source, result.warnings));
      mark(index, { name: file.name, state: "done" });
    } else {
      notes.push(t("assets-import-failed", { file: file.name, reason: result.reason }));
      mark(index, { name: file.name, state: "failed", reason: result.reason });
    }
  }
  return made;
}

/** The state of one browser. `tick` changes when the open scene changes. */
export function useAssetBrowser(source: AssetSource, openScene: OpenScene, tick: Ref<number>) {
  const list = shallowRef<AssetList | null>(null);
  const error = ref<string | null>(null);
  const status = ref("");
  const query = ref("");
  const kinds = ref<string[]>([]);
  const tags = ref<string[]>([]);
  const selectedId = ref<string | null>(null);
  const importing = ref(0);
  /** The files of the last import, in their order. */
  const queue = shallowRef<readonly QueuedImport[]>([]);
  const stills = useAssetStills(source, status, () => reload());
  const rights = useAssetRights(source, status, () => reload());
  /** Cancel sets `cancelled`: the queue imports no more files (the file of the current request ends first). */
  const control = { cancelled: false };

  const assets = computed<readonly AssetListEntry[]>(() => list.value?.assets ?? []);
  const shown = computed(() =>
    filterAssets(assets.value, { query: query.value, kinds: new Set(kinds.value), tags: new Set(tags.value) }),
  );
  const allKinds = computed(() => kindsOf(assets.value));
  const allTags = computed(() => tagsOf(assets.value));
  const selected = computed(() => assets.value.find((asset) => asset.id === selectedId.value) ?? null);
  // The tick is in the condition, so the lines follow each change of the open scene.
  const lines = computed(() =>
    tick.value >= 0 && selected.value !== null ? useLines(selected.value, openScene()) : [],
  );

  async function reload(): Promise<void> {
    try {
      [list.value] = await Promise.all([source.list(), stills.read(), rights.read()]);
      error.value = null;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
    }
  }

  /**
   * Import the files in sequence with the options of the import dialog, then read the list again and select the last
   * new asset. The queue has the state of each file and the reason of a failure. Cancel stops the files that wait.
   */
  async function importFiles(files: readonly File[], options: ImportOptions = {}): Promise<void> {
    if (files.length === 0) return;
    importing.value += 1;
    control.cancelled = false;
    const notes: string[] = [];
    try {
      const made = await importQueue(files, (file) => source.importFile(file, options), {
        queue,
        control,
        notes,
        status: (file) => (status.value = t("assets-importing", { file })),
      });
      await reload();
      const last = made.at(-1);
      if (last !== undefined) selectedId.value = last;
      // A new import gets its still with no command line.
      if (made.length > 0) void stills.make(made, true);
    } finally {
      importing.value -= 1;
      status.value = notes.join(" · ");
    }
  }

  return {
    ...{ list, error, status, query, kinds, tags, selectedId, importing, queue, stills, rights },
    ...{ assets, shown, allKinds, allTags, selected, lines },
    reload,
    importFiles,
    cancelImports: () => (control.cancelled = true),
    toggleKind: (kind: string) => (kinds.value = toggled(kinds.value, kind)),
    toggleTag: (tag: string) => (tags.value = toggled(tags.value, tag)),
    select: (id: string) => (selectedId.value = selectedId.value === id ? null : id),
  };
}
