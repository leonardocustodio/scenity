// SPDX-License-Identifier: Apache-2.0
/**
 * The pickers and the first values of the inspector: the assets of the project manifest for an asset reference, the
 * entities of the scene and their sockets for an entity reference, and the first value of a widget or of a new
 * component. No Vue import.
 */
import type { ComponentDefinition } from "@scenity/scene/components";
import { isObject } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { componentModel } from "./values";
import type { FieldModel, WidgetModel } from "./widgets";

/** One asset of the project manifest. */
export interface AssetChoice {
  readonly id: string;
  readonly kind: string;
  /** The text of the picker: the source file name, else the ID. */
  readonly label: string;
}

/** One entity of the scene with its sub-targets (the socket points). */
export interface EntityChoice {
  readonly id: string;
  readonly label: string;
  readonly subs: readonly string[];
}

/** What the pickers offer. */
export interface PickChoices {
  readonly assets: readonly AssetChoice[];
  readonly entities: readonly EntityChoice[];
}

export const NO_CHOICES: PickChoices = { assets: [], entities: [] };

/**
 * The assets of a manifest (its records), sorted by label. The label is the source path of `sources` (the asset
 * index of the project: ID → source file), else the first file of the record, else the ID.
 */
export function assetChoices(
  records: readonly { readonly id: string; readonly kind: string; readonly files?: readonly { file: string }[] }[],
  sources: Readonly<Record<string, string>> = {},
): AssetChoice[] {
  return records
    .map((record) => {
      const file = sources[record.id] ?? record.files?.[0]?.file;
      const label = file === undefined ? record.id : (file.split("/").at(-1) ?? record.id);
      return { id: record.id, kind: record.kind, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The entities of a document with the points of their `socket` component, sorted by label. */
export function entityChoices(doc: EntityDocument): EntityChoice[] {
  return Object.entries(doc.entities)
    .map(([id, entity]) => {
      const socket = entity.components.socket;
      const points = isObject(socket) && isObject(socket.points) ? Object.keys(socket.points).sort() : [];
      return { id, label: entity.name ?? id, subs: points };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The assets that fit an asset reference widget (all assets when it names no kind). */
export function assetsOfKind(choices: PickChoices, kind: string | undefined): AssetChoice[] {
  return kind === undefined ? [...choices.assets] : choices.assets.filter((asset) => asset.kind === kind);
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}

/** The first value of an object model: its required fields. */
function objectValue(fields: readonly FieldModel[], choices: PickChoices): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) if (field.required) out[field.key] = initialValue(field.widget, choices);
  return out;
}

/** The first value of a widget: a value that the schema accepts where the widget can find one. */
export function initialValue(widget: WidgetModel, choices: PickChoices = NO_CHOICES): unknown {
  switch (widget.kind) {
    case "number": {
      const start = clamp(0, widget.min, widget.max);
      // A value that must be above its minimum starts at 1 (a far plane, a radius), or a step above the minimum.
      if (widget.above !== true || start !== widget.min) return start;
      return clamp(Math.max(start + widget.step, 1), widget.min, widget.max);
    }
    case "vector":
      return Array.from({ length: widget.size }, () => clamp(0, widget.min, widget.max));
    case "quaternion":
      return [0, 0, 0, 1];
    case "colour":
      return "#ffffff";
    case "enum":
      return widget.options[0] ?? "";
    case "boolean":
      return false;
    case "string":
      return "";
    case "assetRef":
      return `asset:${assetsOfKind(choices, widget.assetKind)[0]?.id ?? "none"}`;
    case "entityRef":
      return `entity:${choices.entities[0]?.id ?? "none"}`;
    case "curve":
      return widget.form === "keys"
        ? [0, 1000].map((t, index) => ({ [widget.time]: t, [widget.value]: index }))
        : [0, 1].map((x) => Array.from({ length: widget.size }, (_, axis) => (axis === 0 ? x : 0)));
    case "list":
      return Array.from({ length: widget.min ?? 0 }, () => initialValue(widget.item, choices));
    case "map":
      return {};
    case "object":
      return objectValue(widget.fields, choices);
    case "choice":
      return widget.options[0] === undefined ? null : initialValue(widget.options[0], choices);
    case "json":
      return null;
  }
}

/**
 * The value of a new component: the required fields that the defaults do not give. A component with all fields
 * optional starts as `{}`. Thus the document keeps only what differs from the defaults.
 */
export function initialComponent(definition: ComponentDefinition, choices: PickChoices = NO_CHOICES): unknown {
  const model = componentModel(definition);
  const only = model.fields[0];
  if (only?.key === "") return definition.defaults ?? initialValue(only.widget, choices);
  const defaults = isObject(definition.defaults) ? definition.defaults : {};
  const fields = model.fields.filter((field) => !Object.hasOwn(defaults, field.key));
  return objectValue(fields, choices);
}
