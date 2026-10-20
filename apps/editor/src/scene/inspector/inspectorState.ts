// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the inspector panel of the scene page: the selected entities, the
 * subjects, the shared components and the edits. The model is `@scenity/editor-core` (no Vue); this module adds the
 * Vue cells. Every edit is a list of scene ops and one step of the history through the port (the scene channel of
 * the page); a drag of a number is a live drag of the channel and one step at its end.
 *
 * The prefab actions of the page (open a prefab, apply and revert overrides) are commands of the page; the
 * panel shows their refusal as its error. A change of the prefab set shows immediately (an apply, an undo).
 *
 * The titles of the edits (the history shows them) and the refusals of this module are Fluent messages of
 * `src/i18n/en-US/inspector.ftl`. The component name and the field path in a title are data.
 */
import { componentLabel } from "./componentTexts";
import {
  addableComponents,
  addComponentOps,
  entityChoices,
  fieldOps,
  fieldState,
  initialComponent,
  nameOps,
  removeComponentOps,
  resetToDefaultOps,
  resetToPrefabOps,
  SCENE_SUBJECT,
  sharedComponents,
  subjectsOf,
  type AssetChoice,
  type FieldState,
  type InspectorSource,
  type PickChoices,
  type Subject,
} from "@scenity/editor-core";
import type { ComponentDefinition, ComponentRegistry } from "@scenity/scene/components";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { computed, inject, ref, shallowRef, type InjectionKey } from "vue";
import { t } from "../../texts";
import type { PrefabActions } from "../prefabs/prefabTools";
import { copiedComponent, copyComponent, jsonOps, tagOps, visibleOps } from "./entityEdits";

/** What the inspector needs of the page. */
export interface InspectorPort {
  readonly registry: ComponentRegistry;
  /** The assets of the project manifest for the asset pickers. */
  readonly assets: readonly AssetChoice[];
  doc(): SceneDocument;
  /** Call `listener` after each change of the document; the result stops it. */
  listen(listener: (doc: SceneDocument) => void): () => void;
  /** Apply ops as one step of the history; the reason of a refusal, or null. */
  edit(ops: readonly SceneOp[], title: string): string | null;
  /** A live drag: `begin`, ops with `move` (no step), and one step at `end` (`cancel` restores the start). */
  begin(): void;
  move(ops: readonly SceneOp[]): string | null;
  end(cancel: boolean): void;
  /** The prefab document of a `prefab.source` value, if the page has it. */
  prefab?(source: string): PrefabDocument | undefined;
  /** Show the selection in the view (the selection outline). */
  select?(ids: readonly string[]): void;
  /** Call `listener` after each change of the prefab set; the result stops it. */
  listenPrefabs?(listener: () => void): () => void;
  /** The prefab actions of the page (absent before the edit mode makes them). */
  prefabs?(): PrefabActions | undefined;
  /** The next click in the Scene view names a part of a model (null: no model part, or Escape). */
  pickPart?(): Promise<PickedPart | null>;
  /** The override keys of the parts of the model of an entity (`mesh:<node>`, the material names). */
  partKeys?(entity: string): Promise<readonly string[]>;
}

/** A part of a model that a click in the view names: the entity and the glTF node of the mesh. */
export interface PickedPart {
  readonly entity: string;
  readonly part: string;
}

/** The scope of a prefab action: the instance, else the entity of the prefab, the component and the field. */
export interface PrefabScopeArgs {
  readonly instance: string;
  readonly entity?: string;
  readonly component?: string;
  readonly field?: string;
}

/** A field path: the tokens under the value of a component ([] is the whole value). */
export type FieldPath = readonly string[];

/** The kinds of a field edit: a new value, a reset to the default, a revert to the prefab value. */
type FieldEdit = "set" | "reset" | "revert";

/** The message IDs of the title of a field edit: with a field path, and for the whole value. */
const FIELD_TITLES: Readonly<Record<FieldEdit, readonly [string, string]>> = {
  set: ["inspector-edit-field", "inspector-edit-value"],
  reset: ["inspector-edit-reset-field", "inspector-edit-reset-value"],
  revert: ["inspector-edit-revert-field", "inspector-edit-revert-value"],
};

/** The history title of a field edit, for example "Light: intensity" or "Reset Light: value". */
function fieldTitle(kind: FieldEdit, definition: ComponentDefinition, path: FieldPath): string {
  const [field, whole] = FIELD_TITLES[kind];
  const component = componentLabel(definition.id, definition.editor.label);
  const joined = path.join(".");
  return joined === "" ? t(whole, { component }) : t(field, { component, path: joined });
}

function makeEdits(
  port: InspectorPort,
  source: () => InspectorSource,
  subjects: () => Subject[],
  choices: () => PickChoices,
  fail: (reason: string | null) => void,
) {
  const run = (ops: readonly SceneOp[], title: string): void => {
    if (ops.length > 0) fail(port.edit(ops, title));
  };
  let dragging = false;
  return {
    set(definition: ComponentDefinition, path: FieldPath, value: unknown): void {
      run(fieldOps(source(), subjects(), definition, path, value), fieldTitle("set", definition, path));
    },
    reset(definition: ComponentDefinition, path: FieldPath): void {
      run(resetToDefaultOps(source(), subjects(), definition, path), fieldTitle("reset", definition, path));
    },
    resetPrefab(definition: ComponentDefinition, path: FieldPath): void {
      run(resetToPrefabOps(subjects(), definition, path), fieldTitle("revert", definition, path));
    },
    rename(name: string): void {
      run(nameOps(subjects(), name), t("inspector-edit-rename"));
    },
    add(definition: ComponentDefinition): void {
      const value = initialComponent(definition, choices());
      run(
        addComponentOps(subjects(), definition, value),
        t("inspector-edit-add", { component: componentLabel(definition.id, definition.editor.label) }),
      );
    },
    remove(definition: ComponentDefinition): void {
      run(
        removeComponentOps(subjects(), definition),
        t("inspector-edit-remove", { component: componentLabel(definition.id, definition.editor.label) }),
      );
    },
    /** Put the copied values of a component on the subjects (one step). */
    pasteValues(definition: ComponentDefinition): void {
      const copy = copiedComponent();
      if (copy?.component !== definition.id) return;
      run(
        fieldOps(source(), subjects(), definition, [], copy.value),
        t("inspector-edit-paste", { component: componentLabel(definition.id, definition.editor.label) }),
      );
    },
    /** A drag of a number starts: each `dragTo` changes the value immediately, and `dragEnd` makes one step. */
    dragStart(): void {
      if (dragging) return;
      dragging = true;
      port.begin();
    },
    dragTo(definition: ComponentDefinition, path: FieldPath, value: unknown): void {
      if (!dragging) return;
      const ops = fieldOps(source(), subjects(), definition, path, value);
      if (ops.length > 0) fail(port.move(ops));
    },
    dragEnd(cancel: boolean): void {
      if (!dragging) return;
      dragging = false;
      port.end(cancel);
    },
  };
}

/** Make the inspector state over a port, with the entity IDs that the page selects at the start. */
export function createInspector(port: InspectorPort, ids: readonly string[] = []) {
  const doc = shallowRef(port.doc());
  port.listen((next) => {
    doc.value = next;
  });
  // The prefab documents are not in the scene document: a change of the set makes a new source.
  port.listenPrefabs?.(() => {
    doc.value = { ...doc.value };
  });
  const selected = shallowRef<readonly string[]>([...ids]);
  const error = ref<string | null>(null);
  const source = computed<InspectorSource>(() => ({
    doc: doc.value,
    registry: port.registry,
    ...(port.prefab === undefined ? {} : { prefab: (from: string) => port.prefab?.(from) }),
  }));
  const subjects = computed<Subject[]>(() =>
    selected.value.length === 0 ? [SCENE_SUBJECT] : subjectsOf(source.value, selected.value),
  );
  const choices = computed<PickChoices>(() => ({ assets: port.assets, entities: entityChoices(doc.value) }));
  const fail = (reason: string | null) => {
    error.value = reason;
  };
  return {
    doc,
    selected,
    error,
    source,
    subjects,
    choices,
    /** The part of a model that the next click in the view names (null with no view). */
    pickPart: (): Promise<PickedPart | null> => port.pickPart?.() ?? Promise.resolve(null),
    /** True when the page can pick a part in the view. */
    canPickPart: port.pickPart !== undefined,
    partKeys: (entity: string): Promise<readonly string[]> => port.partKeys?.(entity) ?? Promise.resolve([]),
    components: computed(() => sharedComponents(source.value, subjects.value)),
    addable: computed(() => addableComponents(source.value, subjects.value)),
    /** Select entities of the document or prefab entities (`<instance>/<entity>`); the view shows the instance. */
    select(next: readonly string[]): void {
      selected.value = [...next];
      error.value = null;
      port.select?.([...new Set(next.map((id) => id.split("/")[0] ?? id))]);
    },
    /** Follow a selection of the page (a pick or the script API) with no new outline. */
    follow(next: readonly string[]): void {
      selected.value = [...next];
      error.value = null;
    },
    state(definition: ComponentDefinition, path: FieldPath): FieldState {
      return fieldState(source.value, subjects.value, definition, path);
    },
    /** Apply or revert the overrides of a scope, or unpack an instance (a page command, one step of the history). */
    async prefabRun(
      command: "prefab.apply" | "prefab.revert" | "prefab.unpack",
      scope: PrefabScopeArgs,
    ): Promise<void> {
      const actions = port.prefabs?.();
      error.value = actions === undefined ? t("inspector-no-prefab-tools") : await actions.run(command, { ...scope });
    },
    /** Open the prefab of an instance in the prefab mode of the page. */
    openPrefab(instance: string): void {
      const actions = port.prefabs?.();
      error.value = actions === undefined ? t("inspector-no-prefab-tools") : actions.open(instance);
    },
    ...makeEdits(
      port,
      () => source.value,
      () => subjects.value,
      () => choices.value,
      fail,
    ),
    ...entityActions(
      port,
      () => doc.value,
      () => subjects.value,
      fail,
    ),
  };
}

/** The edits of one entity (its tags, its visible switch, its raw JSON) and of the values of a component. */
function entityActions(
  port: InspectorPort,
  doc: () => SceneDocument,
  subjects: () => Subject[],
  fail: (reason: string | null) => void,
) {
  /** The one entity of the document that the inspector shows, or null (none, many, the scene, a prefab entity). */
  const one = (): string | null => {
    const list = subjects();
    const only = list.length === 1 ? list[0] : undefined;
    return only?.kind === "entity" ? only.id : null;
  };
  const run = (ops: readonly SceneOp[], title: string): void => {
    if (ops.length > 0) fail(port.edit(ops, title));
  };
  return {
    one,
    setTags(tags: readonly string[]): void {
      const id = one();
      if (id !== null) run(tagOps(doc(), id, tags), t("inspector-edit-tags"));
    },
    setVisible(visible: boolean): void {
      const id = one();
      if (id !== null) run(visibleOps(doc(), id, visible), t(visible ? "inspector-edit-show" : "inspector-edit-hide"));
    },
    /** Copy the values of a component of the one entity. */
    copyValues(definition: ComponentDefinition): void {
      const id = one();
      const value = id === null ? undefined : doc().entities[id]?.components[definition.id];
      if (value !== undefined) copyComponent({ component: definition.id, value });
    },
    /** True when the copied values are of this component. */
    canPaste: (definition: ComponentDefinition): boolean => copiedComponent()?.component === definition.id,
    /** Apply the raw JSON of the one entity; the reason of a refusal, or null. */
    applyJson(text: string): string | null {
      const id = one();
      if (id === null) return t("inspector-json-one");
      try {
        const ops = jsonOps(doc(), id, text, port.registry);
        const reason = ops.length === 0 ? null : port.edit(ops, t("inspector-edit-json"));
        fail(reason);
        return reason;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fail(reason);
        return reason;
      }
    },
  };
}

export type InspectorState = ReturnType<typeof createInspector>;

export const INSPECTOR_KEY: InjectionKey<InspectorState> = Symbol("scenity.inspector");

/** The inspector state of the panel (the panel provides it). */
export function useInspector(): InspectorState {
  const state = inject(INSPECTOR_KEY);
  if (state === undefined) throw new Error("the inspector panel provides no state");
  return state;
}
