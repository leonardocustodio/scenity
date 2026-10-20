// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the Changes tab: the changed files of the working tree, the turns of Claude and the files of the
 * session, the diff of the selected file, the selection and the message of a commit. The tab loads again after a turn
 * (`agent.turn`), at the end of a run (`runs.done`), after a save of a scene file (`scene.saved`) and after each
 * action. After a save of a scene file, the tab shows the diff of that file.
 */
import type { ChangedFile, RequestResult, TurnSummary } from "@scenity/workbench-host/protocol";
import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { DockHost } from "./dockHost";

type Turns = RequestResult<"git.turns">;

export interface ChangesApi {
  readonly branch: Ref<string | null>;
  readonly files: Ref<ChangedFile[]>;
  readonly turns: Ref<TurnSummary[]>;
  readonly sessionFiles: Ref<string[]>;
  readonly start: Ref<string | null>;
  readonly picked: Ref<string[]>;
  /** The commit message. The proposal of the host fills it until the owner edits it. */
  readonly message: Readonly<Ref<string>>;
  readonly diffPath: Ref<string | null>;
  readonly patch: Ref<string>;
  readonly busy: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly notice: Ref<string | null>;
  /** The commit message is one line and some files are selected. */
  readonly canCommit: ComputedRef<boolean>;
  /** The owner edits the commit message. */
  setMessage(text: string): void;
  /** The owner selects the files of the commit. */
  pick(paths: string[]): void;
  refresh(): Promise<void>;
  showDiff(path: string | null): Promise<void>;
  keep(turn: TurnSummary): Promise<void>;
  undo(turn: TurnSummary): Promise<void>;
  commit(): Promise<void>;
}

function text(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The refs of the tab and two flags: the owner edited the message; the first load is done. */
function changesRefs() {
  return {
    branch: ref<string | null>(null),
    files: ref<ChangedFile[]>([]),
    turns: ref<TurnSummary[]>([]),
    sessionFiles: ref<string[]>([]),
    start: ref<string | null>(null),
    picked: ref<string[]>([]),
    message: ref(""),
    diffPath: ref<string | null>(null),
    patch: ref(""),
    busy: ref(false),
    error: ref<string | null>(null),
    notice: ref<string | null>(null),
    flags: { edited: false, loaded: false },
  };
}
type ChangesRefs = ReturnType<typeof changesRefs>;

/** The loads of the tab: the status, the turns and the diff of the selected file. */
function makeLoads(host: DockHost, s: ChangesRefs): Pick<ChangesApi, "refresh" | "showDiff"> {
  function applyTurns(result: Turns): void {
    s.turns.value = result.turns;
    s.sessionFiles.value = result.files;
    s.start.value = result.start;
    if (!s.flags.edited) s.message.value = result.proposal;
  }

  async function showDiff(path: string | null): Promise<void> {
    s.diffPath.value = path;
    if (path === null) {
      s.patch.value = "";
      return;
    }
    try {
      s.patch.value = (await host.request("git.diff", { paths: [path] })).patch;
    } catch (reason) {
      s.error.value = text(reason);
    }
  }

  async function refresh(): Promise<void> {
    try {
      const [status, result] = await Promise.all([host.request("git.status", {}), host.request("git.turns", {})]);
      s.branch.value = status.branch;
      s.files.value = status.files;
      applyTurns(result);
      const changed = new Set(status.files.map((file) => file.path));
      // The first load selects the changed files of the session; later loads keep the choice of the owner.
      s.picked.value = s.flags.loaded
        ? s.picked.value.filter((path) => changed.has(path))
        : result.files.filter((path) => changed.has(path));
      s.flags.loaded = true;
      if (s.diffPath.value !== null) await showDiff(s.diffPath.value);
    } catch (reason) {
      s.error.value = text(reason);
    }
  }

  return { refresh, showDiff };
}

/** The actions of the tab: keep and undo a turn, commit the selected files. Each loads the tab again after. */
function makeActions(
  host: DockHost,
  s: ChangesRefs,
  refresh: () => Promise<void>,
): Pick<ChangesApi, "keep" | "undo" | "commit" | "canCommit"> {
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
    keep: (turn) =>
      act(async () => {
        await host.request("git.keepTurn", { session: turn.session, turn: turn.turn });
        return `Turn ${String(turn.turn)} kept.`;
      }),
    undo: (turn) =>
      act(async () => {
        const result = await host.request("git.undoTurn", { session: turn.session, turn: turn.turn });
        const parts = [`restored ${String(result.restored.length)}`, `deleted ${String(result.deleted.length)}`];
        if (result.skipped.length > 0) parts.push(`skipped ${result.skipped.join(", ")}`);
        return `Turn ${String(turn.turn)} undone: ${parts.join(", ")}.`;
      }),
    canCommit: computed(
      () =>
        s.message.value.trim() !== "" && !/[\r\n]/.test(s.message.value) && s.picked.value.length > 0 && !s.busy.value,
    ),
    commit: () =>
      act(async () => {
        const paths = [...s.picked.value];
        const result = await host.request("git.commit", { message: s.message.value.trim(), paths });
        s.flags.edited = false;
        s.picked.value = [];
        return `Committed ${result.commit.slice(0, 10)}.`;
      }),
  };
}

export function useChanges(host: DockHost): ChangesApi {
  const { flags, ...refs } = changesRefs();
  const s = { ...refs, flags };
  const loads = makeLoads(host, s);
  const actions = makeActions(host, s, loads.refresh);
  const stops = [
    host.on("agent.turn", () => void loads.refresh()),
    host.on("runs.done", () => void loads.refresh()),
    // A save of the editor wrote a scene file. The tab loads again and shows the JSON diff of the file.
    host.on("scene.saved", (event) => {
      s.diffPath.value = event.path;
      void loads.refresh();
    }),
  ];
  if (getCurrentScope() !== undefined) onScopeDispose(() => stops.forEach((stop) => stop()));
  void loads.refresh();
  return {
    ...refs,
    setMessage: (value: string) => {
      flags.edited = true;
      refs.message.value = value;
    },
    pick: (paths: string[]) => {
      refs.picked.value = paths;
    },
    ...loads,
    ...actions,
  };
}
