// SPDX-License-Identifier: Apache-2.0
/**
 * The file bar of the scene page in the edit mode: the path of the scene file, its state (saved, unsaved, a save that
 * runs, an error) and the Save button. The bar also has one notice with two buttons: the offer of a local draft
 * (Restore, Discard) or a file that changed on the disk (Reload, Overwrite). A notice is a dialog of the editor window
 * (studio/shell/dialogs.ts). A save that a failed rule stops gives a notice with a reason field (Save with the reason,
 * Cancel). A notice of the scenes of the project (New scene, Open, Save as, Close) can have a start value in its field
 * and a third action. The bar shows the path of the open scene after a switch. The texts are Fluent messages of
 * `src/i18n/en-US/scene.ftl`, and the path is a data value. The bar uses DOM nodes only (no HTML text), so the Trusted
 * Types rule of the page CSP applies to none.
 */
import { refreshWindowIdentity } from "./windowIdentity";
import type { DialogDetails, DialogRequest } from "../studio/shell/dialogs";
import { currentShell } from "../studio/shell/shell";
import { t } from "../texts";
import { placePart } from "./pageParts";
import { saveStatus } from "./statusParts";

/** A notice of the bar with its two actions (a dialog of the editor window). */
export interface BarNotice {
  readonly kind: "draft" | "conflict" | "rules" | "scene";
  /** The spec ID of the dialog; default: the one of the kind. */
  readonly spec?: string;
  /** The title of the dialog; default: the one of the kind. */
  readonly title?: string;
  readonly text: string;
  /**
   * A text field: the first action gets its text and waits for a text that is not empty. `value` is the start text of
   * the field.
   */
  readonly input?: { readonly placeholder: string; readonly testId: string; readonly value?: string };
  /** Lines that the dialog shows on request (the semantic diff of a conflict). */
  readonly details?: DialogDetails;
  readonly first: { readonly label: string; readonly testId: string; readonly run: (text: string) => void };
  readonly second: { readonly label: string; readonly testId: string; readonly run: () => void };
  /** A third action (for example Cancel of a close with unsaved changes). */
  readonly third?: { readonly label: string; readonly testId: string; readonly run: () => void };
}

/** The file bar. */
export interface SceneBar {
  /** Show the state of the file: "saved", "unsaved", "saving" or an error text (a Fluent message of the editor). */
  state(text: string, dirty: boolean): void;
  /** Show a notice, or hide it with null. */
  notice(notice: BarNotice | null): void;
  /** The kind of the current notice, or null. */
  readonly noticeKind: string | null;
  /** Show the path of the open scene (after a switch or a save as). */
  path?(path: string): void;
  /** Disable Save for a viewer of the studio; its tooltip gives the reason. */
  lock?(reason: string): void;
}

/** The dialog of each kind of notice: its spec ID, its title and the action of Escape (none: a choice is needed). */
const KINDS: Readonly<Record<BarNotice["kind"], { spec: string; title: string; dismiss: "second" | null }>> = {
  draft: { spec: "confirm.discardDraft", title: "scene-notice-title-draft", dismiss: null },
  conflict: { spec: "confirm.fileChanged", title: "scene-notice-title-conflict", dismiss: null },
  rules: { spec: "confirm.ruleOverride", title: "scene-notice-title-rules", dismiss: "second" },
  scene: { spec: "notice.scene", title: "scene-notice-title-scene", dismiss: "second" },
};

/** The actions that lose work: their buttons show the danger tone. */
const DANGER = new Set(["draft-discard", "conflict-overwrite", "close-discard"]);
const ACTION_IDS = ["first", "second", "third"] as const;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, testId: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  node.textContent = text;
  return node;
}

/** The dialog request of a notice. */
function noticeDialog(notice: BarNotice): DialogRequest {
  const kind = KINDS[notice.kind];
  const actions =
    notice.third === undefined ? [notice.first, notice.second] : [notice.first, notice.second, notice.third];
  return {
    spec: notice.spec ?? kind.spec,
    title: notice.title ?? t(kind.title),
    text: notice.text,
    testId: "scene-notice",
    kind: notice.kind,
    textTestId: "scene-notice-text",
    ...(notice.input === undefined
      ? {}
      : { input: { label: notice.input.placeholder, testId: notice.input.testId, value: notice.input.value ?? "" } }),
    ...(notice.details === undefined ? {} : { details: notice.details }),
    actions: actions.map((action, index) => ({
      id: ACTION_IDS[index] ?? "first",
      label: action.label,
      testId: action.testId,
      tone: DANGER.has(action.testId) ? "danger" : index === 0 ? "primary" : "plain",
      needsText: index === 0 && notice.input !== undefined,
    })),
    dismiss: notice.third === undefined ? kind.dismiss : "third",
  };
}

/** Make the file bar in the page; `save` runs on a click of Save. */
export function sceneBar(path: string, save: () => void): SceneBar {
  const bar = element("div", "scene-bar");
  bar.id = "scene-bar";
  const file = element("span", "scene-file");
  // The path is a data value. The layout can cut a long path with an ellipsis: the tooltip gives the whole path.
  // The inner span holds the ellipsis (scene.css).
  const text = document.createElement("span");
  text.textContent = path;
  file.append(text);
  file.setAttribute("translate", "no");
  file.title = path;
  const state = element("span", "scene-state", t("scene-state-saved"));
  const button = element("button", "scene-save", t("scene-bar-save"));
  button.type = "button";
  button.title = t("scene-bar-save-title");
  // The command of the window that does the same.
  button.dataset.command = "file.save";
  button.addEventListener("click", save);
  bar.append(file, state, button);
  // The bar goes into the toolbar of the editor window.
  placePart(bar, "bar");
  let kind: string | null = null;
  let asked: DialogRequest | null = null;
  let saving = false;
  return {
    lock(reason) {
      button.disabled = true;
      button.title = reason;
      bar.dataset.locked = "1";
    },
    state(text, dirty) {
      // A toast for a save that ends well (a short fact).
      if (saving && text === t("scene-state-saved"))
        currentShell()?.notices.toast(t("notice-saved", { path: file.title }));
      saving = text === t("scene-state-saving");
      currentShell()?.status.set("save", saveStatus(text, dirty));
      state.textContent = text;
      bar.dataset.dirty = dirty ? "1" : "0";
      // The window identity owns the title of the editor window; with none, the file bar sets it.
      if (!refreshWindowIdentity()) document.title = dirty ? t("scene-page-title-dirty") : t("scene-page-title");
    },
    // A notice is a dialog of the editor window.
    notice(notice) {
      const notices = currentShell()?.notices;
      if (notice === null) {
        if (asked !== null && notices?.dialog === asked) notices.close();
        asked = null;
        kind = null;
        return;
      }
      const request = noticeDialog(notice);
      const actions = [notice.first, notice.second, notice.third];
      kind = notice.kind;
      asked = request;
      void notices?.ask(request).then((answer) => {
        if (asked === request) {
          asked = null;
          kind = null;
        }
        if (answer === null) return;
        actions[ACTION_IDS.indexOf(answer.action as (typeof ACTION_IDS)[number])]?.run(answer.text);
      });
    },
    get noticeKind() {
      return kind;
    },
    path(text) {
      file.textContent = text;
      file.title = text;
    },
  };
}
