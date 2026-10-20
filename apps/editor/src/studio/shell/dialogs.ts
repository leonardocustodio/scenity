// SPDX-License-Identifier: Apache-2.0
/**
 * The dialogs, the toasts and the banners of the editor window.
 *
 * - A dialog asks one thing: a confirm, a choice of two or three actions, or a prompt with a text field. It names its
 *   spec ID (`confirm.closeUnsaved`), tells what occurs, and gives the focus to the safe action. One dialog shows at a
 *   time. A new dialog replaces the dialog that shows, and the answer of the old dialog is null.
 * - A toast tells a short fact (saved, imported). It never takes the focus and disappears after 5 s.
 * - A banner across the top of the dock tells a state of the window (play mode, restricted mode) until it is removed.
 */
import type { Component } from "vue";
import { markRaw, shallowReactive } from "vue";

/** An action of a dialog. */
/**
 * Lines that a disclosure of the dialog shows (the semantic diff of a conflict), with its label. A view of the same
 * lines (a component and its props) can show in place of the lines.
 */
export interface DialogDetails {
  readonly label: string;
  readonly lines: readonly string[];
  readonly view?: { readonly component: Component; readonly props: Readonly<Record<string, unknown>> };
}

export interface DialogAction {
  readonly id: string;
  readonly label: string;
  /** The test ID of the button. */
  readonly testId?: string;
  /** "danger" for an action that loses work (Discard, Overwrite). */
  readonly tone?: "primary" | "danger" | "plain";
  /** True: the action waits for a text in the field that is not empty. */
  readonly needsText?: boolean;
}

export interface DialogRequest {
  /** The spec ID, for example `confirm.discardDraft`. */
  readonly spec: string;
  readonly title: string;
  readonly text: string;
  /** The test ID and the kind of the dialog element (the specs read them). */
  readonly testId?: string;
  readonly kind?: string;
  readonly textTestId?: string;
  readonly input?: { readonly label: string; readonly testId?: string; readonly value?: string };
  /** Lines that a disclosure of the dialog shows (the semantic diff of a conflict), with its label. */
  readonly details?: DialogDetails;
  readonly actions: readonly DialogAction[];
  /** The ID of the action that gets the focus (the safe action). The default is the first action. */
  readonly safe?: string;
  /** The ID of the action of Escape and of a close of the dialog. Null when the dialog cannot close that way. */
  readonly dismiss?: string | null;
}

/** The answer of a dialog: the action and the text of the field. Null when a different dialog replaced it. */
export interface DialogAnswer {
  readonly action: string;
  readonly text: string;
}

export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly text?: string;
  readonly tone?: "status" | "alert";
}

export interface Banner {
  readonly id: string;
  readonly text: string;
  readonly tone: "info" | "caution" | "play";
  readonly action?: { readonly label: string; readonly testId?: string; readonly run: () => void };
}

interface Open {
  readonly request: DialogRequest;
  readonly done: (answer: DialogAnswer | null) => void;
}

/** The time on screen of a toast (ms). */
export const TOAST_MS = 5000;

/** The dialogs, toasts and banners of one window. The shell shows them (DialogHost.vue). */
export class WindowNotices {
  readonly state = shallowReactive<{ dialog: Open | null; toasts: readonly Toast[]; banners: readonly Banner[] }>({
    dialog: null,
    toasts: [],
    banners: [],
  });
  #next = 1;

  constructor() {
    markRaw(this);
  }

  /** Show a dialog. The promise gives the answer. */
  ask(request: DialogRequest): Promise<DialogAnswer | null> {
    this.state.dialog?.done(null);
    return new Promise((resolve) => {
      this.state.dialog = { request: markRaw(request), done: resolve };
    });
  }

  /** The dialog that shows, or null. */
  get dialog(): DialogRequest | null {
    return this.state.dialog?.request ?? null;
  }

  /** Answer the dialog that shows (the host calls it). */
  answer(action: string, text = ""): void {
    const open = this.state.dialog;
    if (open === null) return;
    this.state.dialog = null;
    open.done({ action, text });
  }

  /** Close the dialog that shows with no answer. */
  close(): void {
    const open = this.state.dialog;
    if (open === null) return;
    this.state.dialog = null;
    open.done(null);
  }

  /** Show a toast for a short fact. */
  toast(title: string, text?: string, tone: Toast["tone"] = "status"): void {
    const toast: Toast = { id: this.#next++, title, ...(text === undefined ? {} : { text }), tone };
    this.state.toasts = [...this.state.toasts, toast];
    setTimeout(() => this.dropToast(toast.id), TOAST_MS);
  }

  dropToast(id: number): void {
    this.state.toasts = this.state.toasts.filter((toast) => toast.id !== id);
  }

  /** Show a banner (it replaces a banner with the same ID). The result removes it. */
  banner(banner: Banner): () => void {
    this.state.banners = [...this.state.banners.filter((item) => item.id !== banner.id), markRaw(banner)];
    return () => {
      this.state.banners = this.state.banners.filter((item) => item !== banner);
    };
  }
}
