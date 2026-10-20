// SPDX-License-Identifier: Apache-2.0
/**
 * The inline prompt: ⌘I opens a small prompt field at the position of the focus, with the context of that position.
 * The context is an inspector field (the entity, the component, the field and its value), a hierarchy row (the
 * entity), an asset tile (the asset), the selection of the Scene view, or a point of the view that the person clicks
 * (the entity under it and the world point). The prompt goes to the active session, or to a new session with the name
 * of the subject. Its result is a change set in place (the marks and Accept and Reject next to the field).
 */
import { t } from "../../texts";
import { mentionChip, type AgentChip } from "./agentContext";

/** The subject of an inline prompt: its name, its chips and the position of the field. */
export interface InlineSubject {
  readonly label: string;
  readonly chips: readonly AgentChip[];
  readonly at: { readonly x: number; readonly y: number };
}

/** What the inline prompt reads of the window. */
export interface InlineSources {
  /** The selected entities. */
  selection(): readonly string[];
  name(entity: string): string;
  /** The value of a field of a component of an entity, or undefined. */
  fieldValue(entity: string, component: string, field: string): unknown;
  /** The entity and the world point under a point of the canvas (CSS pixels), or null. */
  pick(x: number, y: number): Promise<{ readonly entity: string; readonly point: readonly number[] } | null>;
  readonly canvas: HTMLElement;
}

const below = (element: Element) => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
};

/** The chip of a field of an entity. */
function fieldChip(sources: InlineSources, entity: string, component: string, field: string): AgentChip {
  const value = sources.fieldValue(entity, component, field);
  const path = field === "" ? component : `${component}.${field}`;
  return {
    key: `field:${entity}:${path}`,
    kind: "field",
    label: `${sources.name(entity)} ▸ ${path}`,
    text: `entity:${entity} "${sources.name(entity)}" component ${component}${field === "" ? "" : ` field ${field}`} = ${value === undefined ? "unset" : JSON.stringify(value)}`,
  };
}

/** The subject at the position of the focus, "point" when the person picks a point of the view, or null. */
export function focusSubject(sources: InlineSources, focus: Element | null): InlineSubject | "point" {
  const row = focus?.closest<HTMLElement>("[data-component][data-field]");
  const ids = sources.selection();
  if (row !== null && row !== undefined && ids.length > 0) {
    const component = row.dataset.component ?? "";
    const field = row.dataset.field ?? "";
    const chips = ids.map((id) => fieldChip(sources, id, component, field));
    return { label: chips[0]?.label ?? component, chips, at: below(row) };
  }
  const item = focus?.closest<HTMLElement>('[data-testid^="hierarchy-row-"]');
  const entity = item?.dataset.testid?.slice("hierarchy-row-".length);
  if (item !== null && item !== undefined && entity !== undefined) {
    return {
      label: sources.name(entity),
      chips: [mentionChip("entity", entity, sources.name(entity))],
      at: below(item),
    };
  }
  const tile = focus?.closest<HTMLElement>('[data-testid^="asset-tile-"]');
  const asset = tile?.dataset.testid?.slice("asset-tile-".length);
  if (tile !== null && tile !== undefined && asset !== undefined) {
    const shown = tile.textContent.trim();
    const name = shown === "" ? asset : shown;
    return { label: name, chips: [mentionChip("asset", asset, name)], at: below(tile) };
  }
  if (ids.length > 0) {
    const box = sources.canvas.getBoundingClientRect();
    const chips = ids.map((id) => mentionChip("entity", id, sources.name(id)));
    return {
      label: sources.name(ids[0] ?? ""),
      chips,
      at: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    };
  }
  return "point";
}

/** Let the person click a point of the view. Return the subject of the entity and the point, or null (Escape). */
export function pickPoint(sources: InlineSources): Promise<InlineSubject | null> {
  const box = sources.canvas.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "agent-region-layer";
  layer.dataset.testid = "agent-inline-point";
  layer.setAttribute("role", "application");
  layer.setAttribute("aria-label", t("agent-inline-point"));
  layer.tabIndex = -1;
  Object.assign(layer.style, {
    left: `${String(box.left)}px`,
    top: `${String(box.top)}px`,
    width: `${String(box.width)}px`,
    height: `${String(box.height)}px`,
  });
  const hint = document.createElement("p");
  hint.className = "agent-region-hint";
  hint.textContent = t("agent-inline-point");
  layer.append(hint);
  document.body.append(layer);
  layer.focus();
  return new Promise((resolve) => {
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      layer.remove();
      resolve(null);
    });
    layer.addEventListener("click", (event) => {
      layer.remove();
      const at = { x: event.clientX, y: event.clientY };
      void sources.pick(event.clientX - box.left, event.clientY - box.top).then((hit) => {
        if (hit === null) {
          resolve(null);
          return;
        }
        const point = hit.point.map((value) => Number(value.toFixed(3)));
        const chips = [
          mentionChip("entity", hit.entity, sources.name(hit.entity)),
          { key: "point", kind: "point", label: t("agent-chip-point"), text: `world point (${point.join(", ")})` },
        ];
        resolve({ label: sources.name(hit.entity), chips, at });
      });
    });
  });
}

/** Open the prompt field of a subject. `send` gives true when the prompt went. Escape or Cancel closes the field. */
export function openInlinePrompt(subject: InlineSubject, send: (text: string) => Promise<boolean>): HTMLFormElement {
  document.querySelector("#agent-inline")?.remove();
  const before = document.activeElement as HTMLElement | null;
  const form = document.createElement("form");
  form.id = "agent-inline";
  form.dataset.testid = "agent-inline";
  form.setAttribute("aria-label", t("agent-inline", { name: subject.label }));
  Object.assign(form.style, { left: `${String(subject.at.x)}px`, top: `${String(subject.at.y + 4)}px` });
  const context = document.createElement("p");
  context.dataset.testid = "agent-inline-context";
  context.textContent = subject.chips.map((chip) => chip.label).join(", ");
  const field = document.createElement("input");
  field.type = "text";
  field.dataset.testid = "agent-inline-field";
  field.placeholder = t("agent-inline-placeholder");
  field.setAttribute("aria-label", t("agent-inline", { name: subject.label }));
  const close = (): void => {
    form.remove();
    before?.focus();
  };
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    event.stopPropagation();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (field.value.trim() === "") return;
    void send(field.value).then((sent) => {
      if (sent) close();
    });
  });
  form.append(context, field);
  document.body.append(form);
  field.focus();
  return form;
}
