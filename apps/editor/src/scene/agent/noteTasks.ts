// SPDX-License-Identifier: Apache-2.0
/**
 * Notes as tasks. A note is an entity with the `annotation` component, on an entity (its parent) or at a point. "Send
 * the note to the agent" (the command `note.send` on the selected note) sends its text with the note and its target as
 * chips. When the turn of that prompt ends, the note gets the status "done" and the key of the turn. The key
 * (`<session>#<turn>`) identifies the change set of the turn. The update is one step of the history.
 */
import { watch } from "vue";
import type { AnnotationValue } from "@scenity/scene/components";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { t } from "../../texts";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import { mentionChip, type AgentChip } from "./agentContext";
import type { AgentStore } from "./agentStore";

/** The task of a note entity: its text and its target (the parent entity), or null for an entity with no note. */
export function noteTask(
  doc: ScenePageEditor["doc"],
  id: string,
): { readonly text: string; readonly target: string | null } | null {
  const entity = doc.entities[id];
  const note = entity?.components.annotation as AnnotationValue | undefined;
  return note === undefined ? null : { text: note.text, target: entity?.parent ?? null };
}

/** The prompt of a note. */
export function notePrompt(text: string, target: string | null): string {
  return target === null ? t("note-prompt-point", { text }) : t("note-prompt", { text, target });
}

/** The ops that mark a note done with the key of the turn that did it. */
export function doneOps(id: string, task: string): SceneOp[] {
  const path = `/entities/${id}/components/annotation`;
  return [
    { op: "set", path: `${path}/status`, value: "done" },
    { op: "set", path: `${path}/task`, value: task },
  ];
}

/** Wait for the end of the turn of a prompt of a session. Return its turn number. */
function turnOf(store: AgentStore, session: string, prompt: string): Promise<number> {
  return new Promise((resolve) => {
    const stop = watch(
      store.sessions,
      (sessions) => {
        const items = sessions.find((item) => item.id === session)?.items ?? [];
        const asked = items.findLast((item) => item.kind === "prompt" && item.text === prompt);
        const turn = asked?.kind === "prompt" ? asked.turn : undefined;
        if (turn === undefined || !items.some((item) => item.kind === "end" && item.turn === turn)) return;
        stop();
        resolve(turn);
      },
      { immediate: true },
    );
  });
}

/** The command "Send the note to the agent" on the selected note. It shows the agent panel. */
export function noteCommand(
  store: AgentStore,
  editor: ScenePageEditor,
  selection: () => readonly string[],
  show: () => void,
): PageKeyCommandSpec {
  const selected = (): string | null => {
    const [id] = selection();
    return id !== undefined && noteTask(editor.doc, id) !== null ? id : null;
  };
  return {
    id: "note.send",
    title: t("command-note-send"),
    category: "agent",
    menu: "agent",
    when: () => (selected() === null ? t("note-none") : null),
    run: async () => {
      const id = selected();
      const task = id === null ? null : noteTask(editor.doc, id);
      if (id === null || task === null) return;
      const name = (entity: string): string => editor.doc.entities[entity]?.name ?? entity;
      const prompt = notePrompt(task.text, task.target === null ? null : name(task.target));
      const chips: AgentChip[] = [mentionChip("note", id, task.text)];
      if (task.target !== null) chips.push(mentionChip("entity", task.target, name(task.target)));
      show();
      if (!(await store.sendInline(prompt, chips, name(id)))) return;
      const session = store.active.value;
      if (session === null) return;
      const turn = await turnOf(store, session, prompt);
      editor.apply(doneOps(id, `${session}#${String(turn)}`), t("note-done"));
    },
  };
}
