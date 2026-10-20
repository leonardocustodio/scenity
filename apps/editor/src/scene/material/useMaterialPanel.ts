// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the material panel: the open material, its fields and texture slots for its type, the asset lists of the
 * pickers, the users of the asset, the parts of the selected entity, and the edits of the panel through the material
 * channel (a value, a live drag, the type, a slot). A refused edit shows its reason in the status line and changes
 * nothing.
 *
 * The status notes are Fluent messages of `src/i18n/en-US/material.ftl`.
 */
import {
  materialFields,
  materialSlots,
  materialUsers,
  setMaterialMap,
  setMaterialMapSetting,
  setMaterialValue,
  type MapSetting,
  type MaterialTarget,
} from "@scenity/editor-core";
import type { MaterialDocument, MaterialSlot } from "@scenity/scene/schema/material";
import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { MATERIAL_PRESETS, withMaterialPreset } from "./materialPresets";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import type { IndexEntry, PageMaterials } from "./pageMaterials";
import { t } from "../../texts";

/** What the panel reads of the page. */
export interface MaterialPanelParts {
  readonly materials: PageMaterials;
  readonly editor: ScenePageEditor;
  readonly selection?: PageSelectionPort | undefined;
}

/** The name of an asset of the index: its file name with no extension. */
export function assetName(entry: IndexEntry): string {
  const file = entry.path.split("/").pop() ?? entry.path;
  return file.replace(/\.material\.json$/, "").replace(/\.[^.]+$/, "");
}

/** What the panel shows of the open material: a copy after each change. */
interface Shown {
  readonly current: string | null;
  readonly doc: MaterialDocument | null;
  readonly dirty: boolean;
  readonly path: string;
  readonly users: readonly string[];
}

function shownOf({ materials, editor }: MaterialPanelParts): Shown {
  const { channel } = materials;
  const current = materials.current;
  if (current === null) return { current, doc: null, dirty: false, path: "", users: [] };
  return {
    current,
    doc: channel.doc(current),
    dirty: channel.dirty(current),
    path: channel.path(current) ?? "",
    users: materialUsers(editor.doc, current),
  };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The actions of the panel: each edit of the open material, the open, the assignment, a new material, the save. */
function panelActions(parts: MaterialPanelParts, status: Ref<string>, selected: Ref<string | null>) {
  const { materials, editor } = parts;
  const { channel } = materials;
  const edit = (next: (doc: MaterialDocument) => MaterialDocument): void => {
    const ref = materials.current;
    if (ref === null) return;
    try {
      channel.set(ref, next(channel.doc(ref)));
      status.value = "";
    } catch (error) {
      status.value = errorText(error);
    }
  };
  const report = (work: Promise<string>): void => {
    work.then(
      (text) => (status.value = text),
      (error: unknown) => (status.value = errorText(error)),
    );
  };
  return {
    setValue: (key: string, value: unknown) => edit((now) => setMaterialValue(now, key, value)),
    /** A live value of a drag: the first one starts the live change, `endLive` keeps it as one step. */
    liveValue: (key: string, value: unknown) => {
      channel.begin();
      edit((now) => setMaterialValue(now, key, value));
    },
    endLive: (cancel = false) => channel.end(cancel),
    setMap: (slot: MaterialSlot, texture: string | null) => edit((now) => setMaterialMap(now, slot, texture)),
    /** The values of a preset, as one step. */
    preset: (id: string) => {
      const found = MATERIAL_PRESETS.find((item) => item.id === id);
      if (found !== undefined) edit((now) => withMaterialPreset(now, found));
    },
    setMapSetting: (slot: MaterialSlot, key: MapSetting, value: unknown) =>
      edit((now) => setMaterialMapSetting(now, slot, key, value)),
    open: (ref: string) => report(materials.open(ref).then(() => "")),
    assign: (part: string | null) => {
      const id = selected.value;
      const ref = materials.current;
      if (id === null || ref === null) return;
      const done = (): string =>
        part === null ? t("material-assigned", { entity: id }) : t("material-assigned-part", { entity: id, part });
      report(materials.assign(id, part, ref).then(done));
    },
    create: (name: string) => report(materials.create(name).then((ref) => t("material-created", { ref }))),
    save: () =>
      report(
        editor.save().then((result) => {
          if (result.ok) return t("material-saved");
          if ("reason" in result) return t("material-not-saved", { reason: result.reason });
          return t("material-not-saved-changed");
        }),
      ),
  };
}

export function useMaterialPanel(parts: MaterialPanelParts) {
  const { materials } = parts;
  const status = ref("");
  const shown = shallowRef(shownOf(parts));
  const index = shallowRef<readonly IndexEntry[]>([]);
  const selected = ref<string | null>(parts.selection?.ids[0] ?? null);
  const targets = shallowRef<readonly MaterialTarget[]>([]);
  /** The pictures of the assets (asset ID → URL). */
  const stills = shallowRef<ReadonlyMap<string, string>>(new Map());
  const readStills = (): void => {
    void materials.stills().then((map) => (stills.value = map));
  };
  const refresh = (): void => {
    shown.value = shownOf(parts);
  };
  const readIndex = (): void => {
    materials.index().then(
      (entries) => (index.value = entries),
      (error: unknown) => (status.value = errorText(error)),
    );
  };
  const stops = [
    materials.listen(() => {
      refresh();
      readIndex();
    }),
    parts.editor.listen(refresh),
    parts.selection?.listen((ids) => (selected.value = ids[0] ?? null)) ?? (() => undefined),
  ];
  onBeforeUnmount(() => {
    for (const stop of stops) stop();
  });
  readIndex();
  readStills();
  watch(
    [selected, shown],
    async ([id]) => {
      targets.value = id === null ? [] : await materials.targets(id).catch(() => []);
    },
    { immediate: true },
  );
  const doc = computed(() => shown.value.doc);
  return {
    status,
    current: computed(() => shown.value.current),
    doc,
    fields: computed(() => (doc.value === null ? [] : materialFields(doc.value.type))),
    slots: computed((): readonly MaterialSlot[] => (doc.value === null ? [] : materialSlots(doc.value.type))),
    dirty: computed(() => shown.value.dirty),
    path: computed(() => shown.value.path),
    users: computed(() => shown.value.users),
    materialAssets: computed(() => index.value.filter((entry) => entry.kind === "material")),
    textures: computed(() => index.value.filter((entry) => entry.kind === "texture")),
    selected,
    targets,
    stills,
    ...panelActions(parts, status, selected),
  };
}
