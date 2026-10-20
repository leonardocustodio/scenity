// SPDX-License-Identifier: Apache-2.0
/**
 * Toast messages (Reka UI Toast). The Toaster component provides `useToast()`. Toasts carry no critical
 * information. A domain plugin shows critical information in its own UI.
 */
import { inject, type InjectionKey } from "vue";

export interface ToastMessage {
  readonly title: string;
  readonly description?: string;
  /** "status" for a polite announcement, "alert" for an important one. */
  readonly tone?: "status" | "alert";
  /** Time on screen in ms. Default 6000. */
  readonly durationMs?: number;
}

export interface ToastApi {
  show(message: ToastMessage): void;
}

export const TOAST_KEY: InjectionKey<ToastApi> = Symbol("scenity.toast");

export function useToast(): ToastApi {
  const api = inject(TOAST_KEY, null);
  if (api === null) throw new Error("useToast: render a Toaster above this component.");
  return api;
}
