// SPDX-License-Identifier: Apache-2.0
/**
 * The recent scenes of a project: the paths of the scenes that the editor opened last, newest first, in the browser
 * storage of the page. Each storage call is in a try block. A private window, a full storage or a blocked storage
 * gives an empty list, and the page continues to work. No Vue import, no DOM.
 */
import type { DraftStorage } from "../sceneFile";

/** The most recent scenes that a project keeps by default (the setting `recent.count`). */
export const RECENT_SCENES_MAX = 8;

/** The storage key of the recent scenes of a project. */
export function recentScenesKey(project: string): string {
  return `scenity.recentScenes.${project}`;
}

/** The recent scenes of one project. `max` is the count that the list keeps (an editor setting). */
export class RecentScenes {
  constructor(
    private readonly storage: Pick<DraftStorage, "getItem" | "setItem"> | null,
    private readonly project: string,
    private readonly max: number | (() => number) = RECENT_SCENES_MAX,
  ) {}

  /** The current count that the list keeps. */
  get count(): number {
    const value = typeof this.max === "function" ? this.max() : this.max;
    return Number.isInteger(value) && value > 0 ? value : RECENT_SCENES_MAX;
  }

  /** The paths, newest first (an empty list with no storage or a bad value). */
  list(): string[] {
    try {
      const text = this.storage?.getItem(recentScenesKey(this.project)) ?? null;
      const value: unknown = text === null ? [] : JSON.parse(text);
      const paths = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      return paths.slice(0, this.count);
    } catch {
      return [];
    }
  }

  /** Put `path` at the top of the list. */
  touch(path: string): void {
    this.#write([path, ...this.list().filter((item) => item !== path)]);
  }

  /** After a save as: the new path takes the place of the old path at the top of the list. */
  rename(from: string, to: string): void {
    this.#write([to, ...this.list().filter((item) => item !== from && item !== to)]);
  }

  /** Remove a path (for example a file that is no longer on the disk). */
  forget(path: string): void {
    this.#write(this.list().filter((item) => item !== path));
  }

  #write(paths: readonly string[]): void {
    try {
      this.storage?.setItem(recentScenesKey(this.project), JSON.stringify(paths.slice(0, this.count)));
    } catch {
      // A full or blocked storage keeps no list.
    }
  }
}
