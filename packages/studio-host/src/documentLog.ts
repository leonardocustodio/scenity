// SPDX-License-Identifier: Apache-2.0
/**
 * The changes of the open documents of the studio: the host gives the changes of each scene of a project one order.
 * Each change of a window or of an agent with no window gets the next version of its scene. The host keeps the last
 * steps (the version, the title, the actor and the ops), so a tool reads the changes after a version. The windows keep
 * the order of the host (apps/editor `documentSync.ts`), so each window has the same values.
 */

/** One change of a scene in the order of the host. */
export interface DocumentStep {
  readonly version: number;
  readonly title: string | null;
  /** The name of the actor: an agent session, or `window` for a person in an editor window. */
  readonly actor: string;
  readonly ops: readonly unknown[];
  readonly at: number;
}

/** The most steps that the host keeps for each scene. */
export const DOCUMENT_STEPS = 200;

const keyOf = (project: string, path: string): string => `${project}\n${path}`;

export class DocumentLog {
  readonly #docs = new Map<string, { version: number; steps: DocumentStep[] }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The current version of a scene (0 before its first change). */
  version(project: string, path: string): number {
    return this.#docs.get(keyOf(project, path))?.version ?? 0;
  }

  /** Record a change of a scene. The result is its version. */
  record(project: string, path: string, change: Omit<DocumentStep, "version" | "at">): number {
    const key = keyOf(project, path);
    const doc = this.#docs.get(key) ?? { version: 0, steps: [] };
    const version = doc.version + 1;
    const steps = [...doc.steps, { ...change, version, at: this.now() }].slice(-DOCUMENT_STEPS);
    this.#docs.set(key, { version, steps });
    return version;
  }

  /** The steps of a scene after a version (default: each step that the host keeps). */
  steps(project: string, path: string, since = 0): DocumentStep[] {
    return (this.#docs.get(keyOf(project, path))?.steps ?? []).filter((step) => step.version > since);
  }
}
