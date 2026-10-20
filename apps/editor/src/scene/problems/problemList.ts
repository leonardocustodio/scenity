// SPDX-License-Identifier: Apache-2.0
/**
 * The problems of the editor window: the failed rules, the budget overruns, the missing assets, the rights issues, the
 * unknown components, the schema findings, the plugin errors and a stale build, each from a source of the page. A
 * problem names its entities (Go to selects them and moves the clock to its time), its file, and its fixes. The list
 * checks each source again after a change; one check runs at a time.
 */
import { shallowRef, type ShallowRef } from "vue";

export const PROBLEM_KINDS = ["rule", "budget", "asset", "rights", "component", "schema", "plugin", "build"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** A fix of a problem: a label and its action. */
export interface ProblemFix {
  readonly id: string;
  readonly label: string;
  run(): unknown;
}

/** One problem. */
export interface Problem {
  /** The key of the problem in the list (stable across checks). */
  readonly key: string;
  readonly kind: ProblemKind;
  readonly level: "error" | "warn";
  readonly title: string;
  readonly detail: string | null;
  /** The entities that Go to selects. */
  readonly entities: readonly string[];
  /** The time of the worst result of a rule (ms), or null. */
  readonly time: number | null;
  /** The file of the problem (a rules file, an asset, a plugin), or null. */
  readonly file: string | null;
  readonly fixes: readonly ProblemFix[];
}

/** A source of problems: a check of the current page. */
export type ProblemSource = () => readonly Problem[] | Promise<readonly Problem[]>;

const KIND_ORDER = new Map(PROBLEM_KINDS.map((kind, index) => [kind, index]));

/** The problems of the sources, the errors first, then by kind. */
export function sortProblems(problems: readonly Problem[]): Problem[] {
  return [...problems].sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) ||
      (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0),
  );
}

/** The problems of a window. */
export class ProblemList {
  readonly problems: ShallowRef<readonly Problem[]> = shallowRef([]);
  readonly #sources = new Map<string, ProblemSource>();
  readonly #found = new Map<string, readonly Problem[]>();
  #running: Promise<void> | null = null;
  #again = false;

  /** Add a source; the result removes it. The list checks again. */
  add(id: string, source: ProblemSource): () => void {
    this.#sources.set(id, source);
    void this.refresh();
    return () => {
      this.#sources.delete(id);
      this.#found.delete(id);
      this.#publish();
    };
  }

  /** Check each source again (a check that runs takes the request after it). */
  refresh(): Promise<void> {
    if (this.#running !== null) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      do {
        this.#again = false;
        for (const [id, source] of this.#sources) {
          try {
            this.#found.set(id, await source());
          } catch {
            // A source that fails (the core stopped) keeps its last problems.
          }
        }
        this.#publish();
      } while (this.#askedAgain());
      this.#running = null;
    })();
    return this.#running;
  }

  /** The counts for the status bar: the errors and the warnings. */
  counts(): { fail: number; warn: number } {
    const all = this.problems.value;
    const fail = all.filter((problem) => problem.level === "error").length;
    return { fail, warn: all.length - fail };
  }

  /** True when a refresh came while the check ran (the flag changes during the awaits). */
  #askedAgain(): boolean {
    return this.#again;
  }

  #publish(): void {
    this.problems.value = sortProblems([...this.#found.values()].flat());
  }
}

const current = new ProblemList();

/** The problems of the page. */
export function pageProblems(): ProblemList {
  return current;
}
