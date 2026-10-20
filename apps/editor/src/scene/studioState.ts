// SPDX-License-Identifier: Apache-2.0
/**
 * One state call for an agent. It gives the project, the open scene, the selection and the entities at the root of
 * the scene. It also gives the prefabs, the open sequence, the problems of the last rule check and the switch of the
 * session. The answer is small (less than 4 KB for the showroom). The agent calls it first in a session
 * (`studio_state`).
 */
import type { StudioState } from "@scenity/bridge";
import type { ProposalMode } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { currentShell } from "../studio/shell/shell";

/** The most root entities of the answer. */
export const TOP_MAX = 40;

/** The parts of the page that the state reads. */
export interface StudioStateParts {
  readonly project: string;
  document(): SceneDocument;
  file(): { readonly path: string; readonly dirty: boolean };
  selection(): readonly string[];
  prefabs(): readonly string[];
  sequence(): string | null;
  mode(): ProposalMode;
}

let parts: StudioStateParts | null = null;

/** Give the state the parts of the page (the edit mode). */
export function startStudioState(next: StudioStateParts): void {
  parts = next;
}

/** The root entities of a scene in their order, with their components and their child counts. */
export function topEntities(doc: SceneDocument, max = TOP_MAX): { top: StudioState["top"]; more: boolean } {
  const entries = Object.entries(doc.entities);
  const roots = entries.filter(([, entity]) => entity.parent === null).sort(([, a], [, b]) => a.index - b.index);
  const children = (id: string): number => entries.filter(([, entity]) => entity.parent === id).length;
  const top = roots.slice(0, max).map(([id, entity]) => ({
    id,
    name: entity.name ?? null,
    components: Object.keys(entity.components),
    children: children(id),
  }));
  return { top, more: roots.length > max };
}

/** The current state of the editor. */
export function studioState(): StudioState {
  if (parts === null) throw new Error("The scene page has no editor: open it with edit=1.");
  const doc = parts.document();
  const file = parts.file();
  return {
    project: parts.project,
    scene: {
      path: file.path,
      id: doc.id,
      name: doc.name ?? null,
      entities: Object.keys(doc.entities).length,
      dirty: file.dirty,
    },
    selection: parts.selection(),
    ...topEntities(doc),
    prefabs: parts.prefabs(),
    sequence: parts.sequence(),
    problems: currentShell()?.status.values.problems ?? null,
    agentMode: parts.mode(),
  };
}
