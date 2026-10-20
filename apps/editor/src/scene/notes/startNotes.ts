// SPDX-License-Identifier: Apache-2.0
/**
 * The notes of the editor window: the note file of the open scene (pageNotes.ts), the pins of the notes in the Scene
 * view (notePins.ts), the panel `notes` and the counts of the hierarchy rows.
 */
import { pageSettings } from "../settings/pageSettings";
import { computed, watchEffect } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import { pageView } from "../dragMath";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { pageKeys } from "../settings/pageKeys";
import { mainViewBox } from "../viewport/mainView";
import { NotePins } from "./notePins";
import NotesPanel from "./NotesPanel.vue";
import { noteItems, PageNotes, setPageNotes, type NoteItem } from "./pageNotes";
import { shallowRef } from "vue";

/** What the notes read of the page. */
export interface NotesParts {
  readonly shell: Pick<StudioShell, "setPanel" | "showPanel" | "search">;
  readonly editor: ScenePageEditor;
  readonly files: SceneFilePort;
  readonly canvas: HTMLCanvasElement;
  readonly selection: PageSelectionPort | undefined;
  /** The camera of the page, as the view of the gizmo. */
  camera(): string | null;
  editorView(): {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly fov: number;
  } | null;
}

/** Start the notes of the open scene. */
export function startNotes(parts: NotesParts): PageNotes {
  const { editor, shell } = parts;
  const notes = new PageNotes(parts.files, editor.file.path, editor.doc.id);
  setPageNotes(notes);
  void notes.load();
  const doc = shallowRef(editor.posed());
  editor.listen(() => (doc.value = editor.posed()));
  const items = computed(() => noteItems(doc.value, notes.file.value));
  const press = (item: NoteItem): void => {
    const id = item.kind === "entity" ? item.id : item.entity;
    if (id !== null) parts.selection?.set([id]);
    else shell.showPanel("notes");
  };
  const pins = new NotePins(press);
  let shown = false;
  const step = (): void => {
    // No note, or the play mode: no pin, and no work in the frame after the pins go.
    const list = editor.play.active ? [] : items.value;
    if (list.length > 0 || shown) {
      pins.show(mainViewBox(parts.canvas), pageView(editor.posed(), parts), list, notes.filter.value);
      shown = list.length > 0;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  /** The name of the person on the notes (the editor setting `notes.author`), or none. */
  const author = (): string | undefined => {
    const name = pageSettings().value.notes.author.trim();
    return name === "" ? undefined : name;
  };
  shell.setPanel("notes", {
    component: NotesPanel,
    props: {
      notes,
      items,
      press,
      add: async (text: string) => {
        const target = parts.selection?.ids[0];
        const view = parts.editorView();
        const at = target !== undefined ? `entity:${target}` : (view?.target ?? [0, 0, 0]);
        await notes.add(text, at, author());
        return notes.error.value;
      },
      // A reply in the thread of a note, with the name of the person.
      reply: async (id: string, text: string) => {
        await notes.reply(id, text, author());
        return notes.error.value;
      },
      setEntityStatus: (id: string, status: "open" | "done") =>
        void pageKeys().execute("component.set", {
          entity: id,
          component: "annotation",
          field: "status",
          value: JSON.stringify(status),
        }),
      ask: () => shell.search.ask,
    },
  });
  watchEffect(() => {
    parts.canvas.dataset.notes = String(items.value.length);
  });
  return notes;
}
