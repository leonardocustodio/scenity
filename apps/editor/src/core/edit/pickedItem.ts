// SPDX-License-Identifier: Apache-2.0
/**
 * The picked item of the lab: the data that the selection card shows, and the "picked" block of the context packet of
 * the workbench. The lab gives the facts of the frame (the item, its slot, asset and place, the bone, the hit point,
 * the near work points, the tune keys). The host adds the files of the item (the `picked` paths of a host plugin). The
 * lines of the picked block are Fluent messages of `src/i18n/en-US/card.ftl`. Thus the card and the ask prompt get
 * them in the page locale.
 */
import type { Room3DManifest } from "../../plugins";
import type { Vec3 } from "@scenity/character";
import type { PickResult, SelectTarget } from "@scenity/runtime-dev";
import { t } from "../../texts";
import { placeOf, placePaths, type PropPlace } from "./placeDrag";

/** The facts of a scratch prop: its import, the rights answers and the gap of the rights, or null. */
export interface PickedScratch {
  readonly import: string;
  readonly name: string;
  readonly source: string;
  readonly licence: string;
  /**
   * "no licence", a reason of the licence register or a similar text (scratch/scratchInfo.ts `rightsGap`). Null when
   * the register allows the answers.
   */
  readonly rightsGap: string | null;
}

/** The picked item: plain data, so the bridge copies it to the workbench. */
export interface PickedItem {
  readonly kind: SelectTarget["kind"];
  readonly id: string;
  /** The prop slot of a prop (its ID), else null. */
  readonly slot: string | null;
  /** The asset of the slot in the manifest and its built file (tier high), or null. */
  readonly asset: { readonly id: string; readonly file: string } | null;
  /** The current place of a prop: metres and degrees. */
  readonly place: { readonly x: number; readonly y: number; readonly z: number; readonly yawDeg: number } | null;
  /** The tune keys of the place of a prop, with their current values. */
  readonly tunes: readonly { readonly path: string; readonly value: number; readonly tuned: boolean }[];
  /** From the last pick of the item (null after a reload): the bone, the hit point and the near work points. */
  readonly bone: string | null;
  readonly point: Vec3 | null;
  readonly near: readonly { readonly name: string; readonly cm: number }[];
  readonly warnings: readonly string[];
  /** A scratch prop of the checkout, else null. */
  readonly scratch: PickedScratch | null;
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/** The asset of a prop or device slot in the manifest. */
function assetOf(manifest: Room3DManifest | null, slot: string): PickedItem["asset"] {
  const asset = manifest?.props.find((prop) => prop.slot === slot);
  if (asset === undefined) return null;
  const file = asset.tiers.high.file;
  return { id: asset.id, file };
}

/** The picked item of a selection, with the facts of its last pick (when the pick is of the same item). */
export function pickedItem(parts: {
  readonly selection: SelectTarget;
  readonly picked: PickResult | null;
  readonly tunes: Readonly<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  readonly manifest: Room3DManifest | null;
  readonly warnings?: readonly string[];
  /** The place and the import facts of the selected scratch prop. */
  readonly scratch?: { readonly place: PropPlace | null; readonly facts: PickedScratch | null } | null;
}): PickedItem {
  const { selection, tunes, defaults } = parts;
  const picked =
    parts.picked !== null && parts.picked.kind === selection.kind && parts.picked.id === selection.id
      ? parts.picked
      : null;
  const isProp = selection.kind === "prop";
  const scratch = selection.kind === "scratch" ? (parts.scratch ?? null) : null;
  const place = isProp ? placeOf(selection.id, tunes, defaults) : (scratch?.place ?? null);
  const paths = isProp ? placePaths(selection.id) : null;
  const tuneRows =
    paths === null
      ? []
      : [...paths.at, paths.yaw].map((path) => ({
          path,
          value: tunes[path] ?? defaults.get(path) ?? 0,
          tuned: Object.hasOwn(tunes, path),
        }));
  const assetSlot = isProp ? selection.id : selection.kind === "device" ? selection.id : null;
  return {
    kind: selection.kind,
    id: selection.id,
    slot: isProp ? selection.id : null,
    asset: assetSlot === null ? null : assetOf(parts.manifest, assetSlot),
    place:
      place === null
        ? null
        : {
            x: round(place.at[0], 4),
            y: round(place.at[1], 4),
            z: round(place.at[2], 4),
            yawDeg: round((place.yaw * 180) / Math.PI, 2),
          },
    tunes: tuneRows,
    bone: picked?.bone ?? null,
    point: picked === null ? null : (picked.point.map((value) => round(value, 3)) as unknown as Vec3),
    near: (picked?.near ?? []).map((near) => ({ name: near.name, cm: round(near.distance * 100, 1) })),
    warnings: [...(parts.warnings ?? [])],
    scratch: scratch?.facts ?? null,
  };
}

/** The lines of the picked block (the card and the prompt of a lab page without the workbench). */
export function pickedLines(item: PickedItem): string[] {
  const head = { kind: item.kind, id: item.id };
  const facts: string[] = [];
  if (item.asset !== null) facts.push(t("card-picked-asset", { id: item.asset.id, file: item.asset.file }));
  const scratch = item.scratch;
  if (scratch !== null) {
    facts.push(t("card-picked-scratch", { import: scratch.import, name: scratch.name }));
    const answers = { source: scratch.source, licence: scratch.licence };
    facts.push(
      scratch.rightsGap === null
        ? t("card-picked-rights", answers)
        : t("card-picked-rights-gap", { ...answers, gap: scratch.rightsGap }),
    );
  }
  if (item.place !== null) {
    const { x, y, z, yawDeg } = item.place;
    facts.push(t("card-picked-place", { x: String(x), y: String(y), z: String(z), turn: String(yawDeg) }));
  }
  if (item.tunes.length > 0) {
    const keys = item.tunes.map((row) => `${row.path}${row.tuned ? `:${String(row.value)}` : ""}`).join(", ");
    facts.push(t("card-picked-tunes", { keys }));
  }
  if (item.point !== null) facts.push(t("card-picked-point", { point: item.point.join(", ") }));
  if (item.near.length > 0) {
    const points = item.near.map((near) => `${near.name} (${String(near.cm)} cm)`).join(", ");
    facts.push(t("card-picked-near", { points }));
  }
  for (const warning of item.warnings) facts.push(t("card-picked-warning", { warning }));
  const first = item.bone === null ? t("card-picked", head) : t("card-picked-bone", { ...head, bone: item.bone });
  // The facts after the first line have an indent of two spaces.
  return [first, ...facts.map((line) => `  ${line}`)];
}

/** The prompt of an "Ask Claude" request: the text and the picked block. */
export function askPrompt(text: string, item: PickedItem | null): string {
  const asked = text.trim();
  return item === null ? asked : `${asked}\n\n${pickedLines(item).join("\n")}`;
}
