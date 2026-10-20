// SPDX-License-Identifier: Apache-2.0
/**
 * The requests of the change loop: the Git requests of the Changes tab, the turns, the runs and the tune to code.
 * Each request works on the open checkout. A commit is always a request of the owner from the page. No run and no
 * tool commits.
 */
import { gitCommit, gitDiff, gitStatus } from "./git";
import { isRecord } from "./protocol";
import { needString, type Router } from "./router";
import { activeRunCatalog } from "./runCatalog";
import type { RunManager } from "./runs";
import type { Surface } from "./surfaces";
import type { TurnStore } from "./turns";

export interface ChangeDeps {
  readonly runs: RunManager;
  readonly turns: TurnStore;
  /** The open checkout. */
  readonly current: () => string;
  /**
   * The Git top folder of the open checkout (the default: the checkout). The Changes tab shows the paths of
   * the whole worktree, from that folder.
   */
  readonly top?: () => string;
  /** The client of the scene surface (the tune values of the lab). */
  readonly scene: () => Surface;
}

function needTurn(params: object): number {
  const turn = (params as { turn?: unknown }).turn;
  if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0) {
    throw new Error('The parameter "turn" must be a number.');
  }
  return turn;
}

function stringList(params: object, name: string, optional: boolean): string[] | undefined {
  const value = (params as Record<string, unknown>)[name];
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`The parameter "${name}" must be a list of texts.`);
  }
  return value;
}

const TUNE_PATH = /^[A-Za-z0-9_.[\]-]+$/;

/** The tune text of `labs tune-apply` from the tune values: `path:value,path:value`. */
export function formatTunes(values: unknown): string {
  if (!isRecord(values)) return "";
  return Object.entries(values)
    .filter((entry): entry is [string, number] => TUNE_PATH.test(entry[0]) && Number.isFinite(entry[1]))
    .map(([path, value]) => `${path}:${String(value)}`)
    .join(",");
}

/** The tune values of the lab: the bridge call `tunes`, else the `tune` parameter of the surface URL. */
export async function readTunes(surface: Surface): Promise<string> {
  try {
    return formatTunes(await surface.call("tunes", []));
  } catch {
    const url = surface.state.url;
    if (url === null) return "";
    const text = new URL(url).searchParams.get("tune") ?? "";
    const values = Object.fromEntries(
      text
        .split(",")
        .map((pair) => [pair.slice(0, pair.lastIndexOf(":")), Number(pair.slice(pair.lastIndexOf(":") + 1))]),
    );
    return formatTunes(values);
  }
}

/** Add the handlers of the Git requests and of the turns. */
function addGitHandlers(router: Router, deps: ChangeDeps): void {
  const { turns, current } = deps;
  const top = deps.top ?? current;
  router
    .on("git.status", () => gitStatus(top()))
    .on("git.diff", async (params) => ({ patch: await gitDiff(top(), stringList(params, "paths", true)) }))
    .on("git.turns", () => {
      const checkout = current();
      return {
        start: turns.start(checkout),
        turns: turns.list(checkout),
        files: turns.sessionFiles(checkout),
        proposal: turns.proposal(checkout),
      };
    })
    .on("git.keepTurn", async (params) => {
      await turns.keepTurn(current(), needString(params, "session"), needTurn(params));
      return null;
    })
    .on("git.undoTurn", (params) => turns.undoTurn(current(), needString(params, "session"), needTurn(params)))
    .on("git.commit", async (params) => {
      const checkout = current();
      const paths = stringList(params, "paths", false) ?? [];
      const commit = await gitCommit(top(), needString(params, "message"), paths);
      // The reasons of the layout overrides went into this commit.
      turns.notes.clear(checkout);
      return { commit };
    });
}

/** Add the handlers of the runs and of the tune to code. */
function addRunHandlers(router: Router, deps: ChangeDeps): void {
  const { runs, turns, current } = deps;
  router
    .on("runs.start", (params) => {
      const checkout = current();
      const confirm = (params as { confirm?: unknown }).confirm === true;
      const args = stringList(params, "args", true) ?? [];
      const { run } = runs.start(checkout, params.command, args, { confirm, ref: turns.start(checkout) });
      return { run };
    })
    .on("runs.cancel", (params) => {
      const run = needString(params, "run");
      if (runs.info(run) === null) throw new Error(`No run ${run}.`);
      void runs.cancel(run);
      return null;
    })
    .on("runs.list", () => runs.list())
    // The runs of the open project for the Runs tab, with a gate that is not a run of the list.
    .on("runs.commands", () => {
      const catalog = activeRunCatalog();
      const gate = catalog.gate;
      const own = gate !== null && !catalog.runs.includes(gate);
      return { runs: own ? [...catalog.runs, gate] : [...catalog.runs], gate: gate?.id ?? null };
    })
    .on("tunes.apply", async (params) => {
      const dry = (params as { dry?: unknown }).dry !== false;
      const values = await readTunes(deps.scene());
      if (values === "") throw new Error("The lab has no tune values to apply.");
      const { run } = runs.start(current(), "tune-apply", dry ? [values, "--dry"] : [values]);
      return { run, values };
    });
}

/** Add the handlers of the change loop to the router of the host. */
export function addChangeHandlers(router: Router, deps: ChangeDeps): void {
  addGitHandlers(router, deps);
  addRunHandlers(router, deps);
}
