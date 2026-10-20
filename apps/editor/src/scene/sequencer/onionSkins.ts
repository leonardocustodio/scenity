// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skins of the Scene view. When the switch is on and one entity is selected, the core draws faint copies of
 * the entity. The copies are at five times round the clock time: two before, three after, 250 ms apart. The copies
 * before are blue, the copies after are orange, and a copy is fainter at a larger distance. The editor poses the open
 * sequence at each time (PosedView of `@scenity/editor-core`). Then it gives the core the world matrix of the entity
 * at that time (onionCopies.ts of `runtime-dev`). The command `view.onion` changes the switch, and the browser
 * storage keeps it.
 */
import { PosedView } from "@scenity/editor-core";
import type { OnionCopiesSpec, OnionCopy } from "@scenity/runtime-dev/document/onionCopies";
import { worldTransform } from "@scenity/scene/world";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { shallowRef, watchEffect } from "vue";
import { t } from "../../texts";
import { pageKeys } from "../settings/pageKeys";
import type { ClockState } from "./clockState";

/** The storage key of the switch of the onion skins. */
export const ONION_KEY = "scenity.scene.onion";
/** The steps of the copies (multiples of ONION_STEP ms from the clock time). */
export const ONION_STEPS = [-2, -1, 1, 2, 3] as const;
export const ONION_STEP = 250;

/** The copies of an entity at the steps round a time (a time out of the sequence, or with no place, has none). */
export function onionCopies(
  scene: SceneDocument,
  sequence: SequenceDocument,
  entity: string,
  t: number,
  view: PosedView,
): OnionCopy[] {
  return ONION_STEPS.flatMap((step): OnionCopy[] => {
    const at = Math.round(t) + step * ONION_STEP;
    if (at < 0 || at > sequence.duration) return [];
    const place = worldTransform(view.at(scene, sequence, at), entity);
    if (place === undefined) return [];
    const opacity = Math.round((0.5 - (Math.abs(step) - 1) * 0.12) * 100) / 100;
    return [{ matrix: [...place.matrix], side: step < 0 ? "before" : "after", opacity }];
  });
}

/** What the onion skins read of the page. */
export interface OnionParts {
  readonly clock: ClockState;
  /** The base scene and the open sequence. */
  scene(): SceneDocument;
  sequence(): SequenceDocument;
  /** The selected entities. */
  selected(): readonly string[];
  /** A reactive count of the edits (the copies follow each edit). */
  readonly edits: { readonly value: number };
  readonly registry: ConstructorParameters<typeof PosedView>[0];
  setOnion(spec: OnionCopiesSpec | null): void;
}

function readSwitch(): boolean {
  try {
    return globalThis.localStorage.getItem(ONION_KEY) === "on";
  } catch {
    return false;
  }
}

/** Start the onion skins and the command `view.onion`; the result is the switch. */
export function startOnionSkins(parts: OnionParts): { readonly on: { readonly value: boolean } } {
  const on = shallowRef(readSwitch());
  const view = new PosedView(parts.registry);
  let last = "";
  watchEffect(() => {
    // The count of the edits is a dependency: the copies follow each edit, a selection and a sequence change.
    if (parts.edits.value < 0) return;
    const t = parts.clock.time.value;
    const ids = parts.selected();
    const entity = on.value && ids.length === 1 ? (ids[0] ?? null) : null;
    const spec: OnionCopiesSpec | null =
      entity === null ? null : { entity, copies: onionCopies(parts.scene(), parts.sequence(), entity, t, view) };
    // The core gets a spec only when it changes.
    const key = JSON.stringify(spec);
    if (key === last) return;
    last = key;
    parts.setOnion(spec);
  });
  pageKeys().register([
    {
      id: "view.onion",
      menu: "view",
      title: t("view-onion-title"),
      agents: true,
      args: { on: { type: "boolean", description: t("view-onion-arg-on"), optional: true } },
      run: (args) => {
        on.value = typeof args.on === "boolean" ? args.on : !on.value;
        try {
          globalThis.localStorage.setItem(ONION_KEY, on.value ? "on" : "off");
        } catch {
          // No storage: the switch holds for this page only.
        }
      },
    },
  ]);
  return { on };
}
