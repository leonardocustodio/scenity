// SPDX-License-Identifier: Apache-2.0
/**
 * The surface tabs of the workbench page: the tab in front, the tabs that the owner opened, and the restart of a dev
 * server.
 *
 * The frame of a tab stays loaded after the first visit. A tab change only hides the frame. Thus the tools of the lab
 * can reach the scene frame behind another tab, and a return to a tab keeps its page state. The tabs come from the
 * project of `host.hello`: the surfaces that are not hidden, in their order, with their labels. ⌘1 to ⌘9 follow that
 * order. The frames of the scene surface and of the hidden surfaces always load. A host without a project (a fake host
 * of a test) gives a tab for each surface state.
 */
import type { HostApi } from "../host/useHost";
import {
  SCENE_CAPABILITY,
  surfaceTabs,
  surfaceWith,
  type SurfaceId,
  type SurfaceState,
} from "@scenity/workbench-host/protocol";
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

/** One tab: the ID of its surface and its label. */
export interface SurfaceTab {
  readonly id: SurfaceId;
  readonly label: string;
}

export interface SurfaceTabs {
  /** The tabs, in their order. */
  readonly tabs: ComputedRef<readonly SurfaceTab[]>;
  /** The surface ID of the tab in front (the first tab until a pick), or null without a tab. */
  readonly kind: ComputedRef<SurfaceId | null>;
  /** The surface of the tab in front, or null when the host has none. */
  readonly surface: ComputedRef<SurfaceState | null>;
  /** The surface IDs that the host lists. */
  readonly available: ComputedRef<SurfaceId[]>;
  /** The loaded frames with their surfaces: the opened tabs, the scene surface and the hidden surfaces. */
  readonly stack: ComputedRef<{ readonly kind: SurfaceId; readonly surface: SurfaceState | null }[]>;
  readonly restarting: Ref<boolean>;
  readonly restartError: Ref<string | null>;
  /** The label of a surface: the label of the manifest, else the ID. */
  readonly label: (id: SurfaceId | null) => string;
  /** Put a tab in front. */
  readonly pick: (next: SurfaceId) => void;
  /** Start the dev server of the tab in front again: open the checkout again. */
  readonly restart: () => Promise<void>;
}

type TabHost = Pick<HostApi, "surfaces" | "checkout" | "request" | "openCheckout" | "access">;

/** The tabs of the project of `host.hello`, else one tab for each surface state. */
function tabsOf(host: TabHost): SurfaceTab[] {
  const project = host.access?.value?.project;
  const list = project === undefined ? host.surfaces.value : surfaceTabs(project.surfaces);
  return list.map(({ id, label }) => ({ id, label }));
}

/** The surfaces that load without a visit: the scene surface and the hidden surfaces of the project. */
function alwaysLoaded(host: TabHost): SurfaceId[] {
  const scene = surfaceWith(host.surfaces.value, SCENE_CAPABILITY)?.id;
  const hidden = (host.access?.value?.project.surfaces ?? []).filter((item) => item.hidden).map((item) => item.id);
  return [...(scene === undefined ? [] : [scene]), ...hidden];
}

export function useSurfaceTabs(host: TabHost): SurfaceTabs {
  const tabs = computed(() => tabsOf(host));
  const picked = ref<SurfaceId | null>(null);
  // A pick of a surface that the project of a later hello does not have falls back to the first tab.
  const kind = computed(() => tabs.value.find((tab) => tab.id === picked.value)?.id ?? tabs.value[0]?.id ?? null);
  const visited = ref<SurfaceId[]>([]);
  const find = (want: SurfaceId | null): SurfaceState | null =>
    host.surfaces.value.find((entry) => entry.id === want) ?? null;
  const surface = computed(() => find(kind.value));
  const available = computed(() => host.surfaces.value.map((entry) => entry.id));
  const stack = computed(() => {
    const ids = [...(kind.value === null ? [] : [kind.value]), ...visited.value, ...alwaysLoaded(host)];
    return [...new Set(ids)].map((item) => ({ kind: item, surface: find(item) }));
  });
  const label = (id: SurfaceId | null): string =>
    tabs.value.find((tab) => tab.id === id)?.label ?? find(id)?.label ?? id ?? "surface";
  const restarting = ref(false);
  const restartError = ref<string | null>(null);

  async function run(work: () => Promise<unknown>): Promise<void> {
    restarting.value = true;
    restartError.value = null;
    try {
      await work();
    } catch (reason) {
      restartError.value = reason instanceof Error ? reason.message : String(reason);
    } finally {
      restarting.value = false;
    }
  }

  async function restart(): Promise<void> {
    const checkout = host.checkout.value;
    if (checkout === null) return;
    await run(() => host.openCheckout(checkout.path));
  }

  /** Tell the host the tab in front. The prompt hook sends the packet of that surface. */
  function announce(): void {
    if (kind.value === null) return;
    host.request("surface.front", { surface: kind.value }).catch(() => undefined);
  }
  // A new hello (a reconnect, a restarted host) gives a new checkout object: the host learns the tab again.
  watch(() => host.checkout.value, announce);

  function pick(next: SurfaceId): void {
    const before = kind.value;
    picked.value = next;
    announce();
    if (before !== null && !visited.value.includes(before)) visited.value = [...visited.value, before];
    if (!visited.value.includes(next)) visited.value = [...visited.value, next];
  }

  return { tabs, kind, surface, available, stack, restarting, restartError, label, pick, restart };
}
