// SPDX-License-Identifier: Apache-2.0
/**
 * The UI calls of the scene page (@scenity/bridge `uiCalls.ts`). An agent reads the state of the editor window and
 * shows a person a part of it. `uiReveal` selects and frames entities, opens a panel, and shows a field of the
 * inspector with a callout. `uiHighlight` puts a callout on a field, a panel or a control. `uiNotify` shows a toast.
 * The bridge calls and the script API (`__scenity.ui`) run the same functions.
 */
import type { StudioState, UiHighlight, UiNotify, UiReveal, UiRevealAnswer, UiState } from "@scenity/bridge";
import { studioState } from "./studioState";
import type { ComponentRegistry } from "@scenity/scene";
import { currentShell } from "../studio/shell/shell";
import { pageTheme } from "../studio/shell/theme";
import { fieldTestId } from "./inspector/inspectorUi";
import { pageKeys } from "./settings/pageKeys";

/** The parts of the page that the calls use. */
export interface UiParts {
  readonly registry: ComponentRegistry;
  readonly selection?: { readonly ids: readonly string[]; set(ids: readonly string[]): void };
  /** The path of the open scene file. */
  scene(): string;
  /** The time of the clock (ms), or null with no clock. */
  time(): number | null;
}

let parts: UiParts | null = null;

/** Give the calls the parts of the page (the edit mode). */
export function startUi(next: UiParts): void {
  parts = next;
}

/** The UI part of the script API (`__scenity.ui`). */
export interface UiApi {
  readonly ui: {
    state(): UiState;
    reveal(request: UiReveal): Promise<UiRevealAnswer>;
    highlight(request: UiHighlight): boolean;
    notify(request: UiNotify): boolean;
  };
  /** The one state call of an agent. */
  studioState(): StudioState;
}

/** The UI part of the script API. */
export function uiApi(): UiApi {
  return { ui: { state: uiState, reveal: uiReveal, highlight: uiHighlight, notify: uiNotify }, studioState };
}

/** How long a callout shows (ms). */
const CALLOUT_MS = 8000;
/** How long `uiReveal` waits for a field of the inspector (ms). */
const FIELD_WAIT_MS = 3000;

/** The state of the editor window. */
export function uiState(): UiState {
  const dock = currentShell()?.dock.state();
  return {
    workspace: dock?.workspace ?? "",
    panels: dock?.panels ?? [],
    activePanel: dock?.active ?? null,
    selection: parts?.selection?.ids ?? [],
    scene: parts?.scene() ?? "",
    time: parts?.time() ?? null,
    theme: pageTheme().choice.value.theme,
  };
}

/** The element of a target: a field (`component.field`), a panel, a test ID or the control of a command. */
export function targetElement(target: string): HTMLElement | null {
  const dot = target.indexOf(".");
  if (dot > 0) {
    const id = fieldTestId(target.slice(0, dot), target.slice(dot + 1).split("."));
    // A vector field has an element for each axis: its row holds the whole field.
    const field =
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`) ??
      document.querySelector<HTMLElement>(`[data-testid="${id}-row"]`);
    if (field !== null) return field;
  }
  return (
    document.querySelector<HTMLElement>(`.studio-panel[data-panel="${CSS.escape(target)}"]`) ??
    document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(target)}"]`) ??
    document.querySelector<HTMLElement>(`[data-command="${CSS.escape(target)}"]`)
  );
}

/** Put a callout on an element: a ring around it and the text adjacent to it. A press or Escape removes it. */
function callout(element: HTMLElement, text: string | undefined): void {
  document.querySelector('[data-testid="ui-callout"]')?.remove();
  const box = element.getBoundingClientRect();
  const node = document.createElement("div");
  node.className = "studio-callout";
  node.dataset.testid = "ui-callout";
  node.setAttribute("role", "status");
  Object.assign(node.style, {
    left: `${String(box.left - 4)}px`,
    top: `${String(box.top - 4)}px`,
    width: `${String(box.width + 8)}px`,
    height: `${String(box.height + 8)}px`,
  });
  if (text !== undefined && text !== "") {
    const bubble = document.createElement("p");
    bubble.className = "studio-callout-text";
    bubble.textContent = text;
    node.append(bubble);
  }
  (document.getElementById("studio") ?? document.body).append(node);
  const remove = (): void => {
    node.remove();
    window.removeEventListener("pointerdown", remove, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") remove();
  };
  window.addEventListener("pointerdown", remove, true);
  window.addEventListener("keydown", onKey, true);
  setTimeout(remove, CALLOUT_MS);
}

/** Put a callout on a target. The result is false when the window has no such part. */
export function uiHighlight(request: UiHighlight): boolean {
  const element = targetElement(request.target);
  if (element === null) return false;
  element.scrollIntoView({ block: "center" });
  callout(element, request.text);
  return true;
}

/** Show a toast. */
export function uiNotify(request: UiNotify): boolean {
  currentShell()?.notices.toast(request.text, undefined, request.tone ?? "status");
  return currentShell() !== null;
}

/** Wait for an element of a target (the inspector draws a field after a change of the selection). */
async function waitFor(target: string): Promise<HTMLElement | null> {
  const end = performance.now() + FIELD_WAIT_MS;
  for (;;) {
    const found = targetElement(target);
    if (found !== null || performance.now() > end) return found;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/** Select the subject of a field: the scene for a scene component, else the entities of the request or selection. */
function selectFor(field: string, request: UiReveal): void {
  const component = parts?.registry.get(field.split(".")[0] ?? "");
  if (request.entities === undefined && component?.site === "scene") parts?.selection?.set([]);
}

/** Show a person a part of the window: entities, a panel, a field. */
export async function uiReveal(request: UiReveal): Promise<UiRevealAnswer> {
  const done: string[] = [];
  const missing: string[] = [];
  const shell = currentShell();
  if (request.entities !== undefined) {
    parts?.selection?.set(request.entities);
    done.push(`select:${request.entities.join(",")}`);
  }
  if (request.frame === true) {
    const reason = pageKeys().run("view.frame");
    if (reason === null) done.push("frame");
    else missing.push("frame");
  }
  const panel = request.panel ?? (request.field === undefined ? undefined : "inspector");
  if (panel !== undefined && shell !== null) {
    shell.showPanel(panel);
    if (shell.dock.isOpen(panel)) done.push(`panel:${panel}`);
    else missing.push(`panel:${panel}`);
  }
  if (request.field !== undefined) {
    selectFor(request.field, request);
    const element = await waitFor(request.field);
    if (element === null) missing.push(`field:${request.field}`);
    else {
      element.scrollIntoView({ block: "center" });
      callout(element, request.text);
      done.push(`field:${request.field}`);
    }
  } else if (request.text !== undefined && panel !== undefined && uiHighlight({ target: panel, text: request.text })) {
    done.push(`callout:${panel}`);
  }
  return { done, missing };
}
