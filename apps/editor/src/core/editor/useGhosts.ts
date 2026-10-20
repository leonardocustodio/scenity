// SPDX-License-Identifier: Apache-2.0
/**
 * The ghosts of the lab page. The ghost list (ghosts.ts) has the proposals that wait and the drag that the owner
 * stages. The list goes to the room view at each change, and a new view gets it again. The view gives it to the core.
 * The core draws it in each pane and hides it in its pictures.
 *
 * The script API (`globalThis.__room3dLab`) gets `ghosts()` (the ghosts as the core draws them: the meshes of each copy
 * and its box) and `ghostSpecs()` (the list that the page sends).
 */
import { tunables, type GhostSpec, type GhostView } from "@scenity/runtime-dev";
import { computed, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import { proposalGhosts, type StagedDrag } from "./ghosts";
import type { Proposal } from "./useCommands";

/** The parts of the room view (LabsRoomView) that the ghosts use. */
export interface GhostViewHandle {
  ghosts?(specs: readonly GhostSpec[]): void;
  listGhosts?(): Promise<readonly GhostView[]>;
}

/** The ghost methods of the script API. */
export interface LabGhostApi {
  /** The ghosts as the core draws them (an empty list without the labs renderer). */
  ghosts(): Promise<GhostView[]>;
  /** The ghost list that the page sends to the core. */
  ghostSpecs(): GhostSpec[];
}

export interface GhostParts {
  readonly proposals: ShallowRef<readonly Proposal[]>;
  readonly tunes: Ref<Record<string, number>>;
  readonly staged: ShallowRef<StagedDrag | null>;
  readonly view: () => GhostViewHandle | null;
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

export function useProposalGhosts(parts: GhostParts): ComputedRef<GhostSpec[]> {
  const defaults = new Map(tunables().map((item) => [item.path, item.default]));
  const specs = computed(() => proposalGhosts(parts.proposals.value, parts.tunes.value, defaults, parts.staged.value));
  // A plain copy, because the worker message cannot hold the reactive values of the page.
  const send = (): void => parts.view()?.ghosts?.(structuredClone(specs.value));
  watch(() => JSON.stringify(specs.value), send);
  watch(parts.view, send);
  if (parts.api !== false) {
    const api: LabGhostApi = {
      ghosts: async () => [...((await parts.view()?.listGhosts?.()) ?? [])],
      ghostSpecs: () => structuredClone(specs.value),
    };
    installApi(api);
  }
  return specs;
}
