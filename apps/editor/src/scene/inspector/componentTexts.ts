// SPDX-License-Identifier: Apache-2.0
/**
 * The labels of the components in the language of the page. A component schema gives its
 * label, its group and the labels of its fields in English (`@scenity/scene`, a plugin). The page shows the Fluent
 * message of each one when the editor has it: `component-<id>`, `component-group-<group>` and
 * `component-field-<id>-<path>`. `tools/component-texts.ts` writes the en-US messages of the built-in components
 * (`src/i18n/en-US/components.ftl`); a component with no message shows the label of its schema.
 */
import type { ComponentModel, FieldModel } from "@scenity/editor-core";
import { messageIdOf, textOr } from "../../texts";

/** The message ID of the label of a component. */
export const componentMessage = (id: string): string => messageIdOf("component", id);
/** The message ID of a group of components or of fields. */
export const groupMessage = (group: string): string => messageIdOf("component-group", group);
/** The message ID of the label of a field: the component ID and the keys of the path. */
export const fieldMessage = (id: string, path: readonly string[]): string =>
  messageIdOf("component-field", [id, ...path].join("."));

/** The label of a component in the language of the page. */
export function componentLabel(id: string, label: string): string {
  return textOr(componentMessage(id), label);
}

/** The name of a group in the language of the page. */
export function groupLabel(group: string): string {
  return textOr(groupMessage(group), group);
}

function pageField(id: string, parent: readonly string[], field: FieldModel): FieldModel {
  const path = field.key === "" ? parent : [...parent, field.key];
  const label = path.length === 0 ? componentLabel(id, field.label) : textOr(fieldMessage(id, path), field.label);
  const widget =
    field.widget.kind === "object"
      ? { ...field.widget, fields: field.widget.fields.map((child) => pageField(id, path, child)) }
      : field.widget;
  return { ...field, label, ...(field.group === undefined ? {} : { group: groupLabel(field.group) }), widget };
}

const models = new WeakMap<ComponentModel, ComponentModel>();

/** The model of a component with its labels in the language of the page (kept for each model). */
export function pageModel(model: ComponentModel): ComponentModel {
  const known = models.get(model);
  if (known !== undefined) return known;
  const page: ComponentModel = {
    ...model,
    label: componentLabel(model.id, model.label),
    ...(model.group === undefined ? {} : { group: groupLabel(model.group) }),
    fields: model.fields.map((field) => pageField(model.id, [], field)),
  };
  models.set(model, page);
  return page;
}
