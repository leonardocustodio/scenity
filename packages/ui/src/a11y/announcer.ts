// SPDX-License-Identifier: Apache-2.0
/**
 * Screen-reader announcements for Vue.
 *
 * The app makes one announcer, installs it (`app.use(announcer)`) and renders `<LiveRegions />` once,
 * near the root. Components call `useAnnouncer()` and give text to the polite or the assertive queue.
 */
import { inject, shallowRef, type App, type InjectionKey, type ShallowRef } from "vue";
import { AnnouncerQueue, type AnnounceOptions, type AnnouncerQueueOptions, type Announcement } from "./announcerQueue";

export interface Announcer {
  /** Status text: order states, NPC lines. */
  polite(text: string, options?: Omit<AnnounceOptions, "politeness">): void;
  /** Urgent text: a new high-priority alarm, a team question that needs an answer. */
  assertive(text: string, options?: Omit<AnnounceOptions, "politeness">): void;
  /** Remove every item that waits. */
  clear(): void;
}

export interface AnnouncerController extends Announcer {
  /** The last item of each region. LiveRegions shows it. */
  readonly current: Readonly<Record<"polite" | "assertive", ShallowRef<Announcement | null>>>;
  /** The Vue plugin that provides the announcer to every component. */
  install(app: App): void;
  dispose(): void;
}

export const ANNOUNCER_KEY: InjectionKey<AnnouncerController> = Symbol("scenity.announcer");

/** Make an announcer. The options set the minimum interval and the time to live (tests give a fake clock). */
export function createAnnouncer(options: AnnouncerQueueOptions = {}): AnnouncerController {
  const current = { polite: shallowRef<Announcement | null>(null), assertive: shallowRef<Announcement | null>(null) };
  const queue = new AnnouncerQueue((item) => {
    current[item.politeness].value = item;
  }, options);
  const controller: AnnouncerController = {
    current,
    polite: (text, opts) => {
      queue.announce(text, { ...opts, politeness: "polite" });
    },
    assertive: (text, opts) => {
      queue.announce(text, { ...opts, politeness: "assertive" });
    },
    clear: () => {
      queue.clear();
    },
    install: (app) => {
      app.provide(ANNOUNCER_KEY, controller);
    },
    dispose: () => {
      queue.dispose();
    },
  };
  return controller;
}

const SILENT: Announcer = { polite: () => undefined, assertive: () => undefined, clear: () => undefined };

/** The announcer of the app, or a silent announcer when the app has none (component tests, the gallery). */
export function useAnnouncer(): Announcer {
  return inject(ANNOUNCER_KEY, SILENT);
}
