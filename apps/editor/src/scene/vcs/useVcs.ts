// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the version control panel, as in the Changes tab of the workbench. It holds the branch and the changed
 * files of the project, and the diff of the chosen file (the semantic diff of a document, else the patch). It also
 * holds the files and the message of a commit by the owner, the branches and the worktrees. The panel loads again
 * after each action and after a save of a scene file of the page (`saved`).
 */
import { computed, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { documentDiff, type DocumentDiff } from "../diff/semanticDiff";

export interface VcsFile {
  readonly path: string;
  readonly status: string;
}

export interface VcsBranch {
  readonly name: string;
  readonly current: boolean;
  readonly upstream: string | null;
  readonly date: string;
}

export interface VcsWorktree {
  readonly path: string;
  readonly branch: string | null;
  readonly head: string;
}

/** The diff of the chosen file: the patch, and the semantic diff of a document (null for another file). */
export interface VcsDiff {
  readonly path: string;
  readonly patch: string;
  readonly semantic: DocumentDiff | null;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const text = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/** The refs of the panel. */
function vcsRefs() {
  return {
    git: ref<boolean | null>(null),
    branch: ref<string | null>(null),
    files: ref<VcsFile[]>([]),
    picked: ref<string[]>([]),
    message: ref(""),
    diff: shallowRef<VcsDiff | null>(null),
    branches: ref<VcsBranch[]>([]),
    worktrees: ref<VcsWorktree[]>([]),
    busy: ref(false),
    error: ref<string | null>(null),
    /** The short ID of the last commit of the panel. */
    notice: ref<string | null>(null),
  };
}
type VcsRefs = ReturnType<typeof vcsRefs>;
type Call = <T>(path: string, body?: unknown) => Promise<T>;

/** The call of a route of the dev server. An answer that is not ok throws its reason. */
function caller(base: string, fetcher: Fetcher): Call {
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const answer = await fetcher(`${base}${path}`, {
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const data = (await answer.json()) as T & { reason?: string };
    if (!answer.ok) throw new Error(data.reason ?? `${String(answer.status)} ${answer.statusText}`);
    return data;
  };
}

/** The loads of the panel: the status, the branches and the diff of the chosen file. */
function vcsLoads(s: VcsRefs, call: Call) {
  let loaded = false;
  async function showDiff(path: string | null): Promise<void> {
    if (path === null) {
      s.diff.value = null;
      return;
    }
    try {
      const answer = await call<{ patch: string; before: string | null; after: string | null }>(
        `vcs.diff.json?path=${encodeURIComponent(path)}`,
      );
      s.diff.value = { path, patch: answer.patch, semantic: documentDiff(path, answer.before, answer.after) };
    } catch (reason) {
      s.error.value = text(reason);
    }
  }
  async function refresh(): Promise<void> {
    try {
      const [status, refs] = await Promise.all([
        call<{ git: boolean; branch: string | null; files: VcsFile[] }>("vcs.status.json"),
        call<{ branches: VcsBranch[]; worktrees: VcsWorktree[] }>("vcs.branches.json"),
      ]);
      s.git.value = status.git;
      s.branch.value = status.branch;
      s.files.value = status.files;
      s.branches.value = refs.branches;
      s.worktrees.value = refs.worktrees;
      const changed = new Set(status.files.map((file) => file.path));
      // The first load chooses no file. Later loads keep the choice of the owner.
      s.picked.value = loaded ? s.picked.value.filter((path) => changed.has(path)) : [];
      loaded = true;
      const shown = s.diff.value?.path ?? null;
      if (shown !== null) await showDiff(changed.has(shown) ? shown : null);
    } catch (reason) {
      s.error.value = text(reason);
    }
  }
  return { showDiff, refresh };
}

/** The state and the actions of the panel for the project folder `base` (its URL, with a "/" at the end). */
export function useVcs(base: string, fetcher: Fetcher = (input, init) => fetch(input, init)) {
  const s = vcsRefs();
  const call = caller(base, fetcher);
  const { showDiff, refresh } = vcsLoads(s, call);
  async function act(work: () => Promise<string | null>): Promise<void> {
    s.busy.value = true;
    s.error.value = null;
    s.notice.value = null;
    try {
      s.notice.value = await work();
    } catch (reason) {
      s.error.value = text(reason);
    } finally {
      s.busy.value = false;
      await refresh();
    }
  }
  return {
    ...s,
    canCommit: computed(
      () =>
        s.message.value.trim() !== "" && !/[\r\n]/.test(s.message.value) && s.picked.value.length > 0 && !s.busy.value,
    ),
    refresh,
    showDiff,
    commit: () =>
      act(async () => {
        const result = await call<{ commit: string }>("vcs.commit", {
          message: s.message.value.trim(),
          paths: [...s.picked.value],
        });
        s.message.value = "";
        s.picked.value = [];
        return result.commit.slice(0, 10);
      }),
    switchTo: (name: string) =>
      act(async () => {
        await call("vcs.switch", { branch: name });
        return null;
      }),
    /** A save of a file of the page: load again and show the diff of the file. */
    saved: (path: string) => {
      s.diff.value = { path, patch: "", semantic: null };
      void refresh();
    },
  };
}

export type VcsState = ReturnType<typeof useVcs>;
