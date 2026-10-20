// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the rules panel of the scene page: the rules of the open project, scene and sequence. The core of the
 * page checks them with no render (`checkRules` of the dev document client, as the save does). The panel checks again
 * after each edit of the scene or the sequence (debounced) while it shows, and when it shows again. A pick selects the
 * entities of the rule and moves the clock to its worst time. For a rule with a sequence scope, a pick also samples
 * its value over the sequence time for the metric graph.
 */
import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { Rule } from "@scenity/scene";
import type { RuleResult } from "@scenity/rules";
import type { RuleRow } from "../../core/rules/ruleRows";
import type { RuleSeries } from "../../core/rules/ruleSeries";
import type { PageSelectionPort } from "../inspector/startInspector";
import { pageRuleSet, type PageRuleSet, type PageRulesPort } from "../pageRules";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSequence } from "../sequencer/pageSequence";
import { graphRules, graphSeries, ruleOfRow, sceneRuleRows } from "./sceneRuleRows";
import { t } from "../../texts";

/** The parts of the page that the panel reads. */
export interface SceneRulesParts {
  readonly editor: ScenePageEditor;
  readonly sequence: PageSequence | null;
  readonly selection?: PageSelectionPort | undefined;
  readonly port: PageRulesPort;
  /** The URL of the project folder, with a "/" at the end (the rules editor writes the rules files). */
  readonly base?: string;
}

export interface SceneRules {
  readonly rows: ShallowRef<readonly RuleRow[]>;
  readonly busy: Ref<boolean>;
  readonly error: Ref<string | null>;
  /** The count of the finished checks (the tests wait for it). */
  readonly checks: Ref<number>;
  readonly selected: Ref<string | null>;
  readonly series: ShallowRef<RuleSeries | null>;
  readonly graphBusy: Ref<boolean>;
  readonly graphError: Ref<string | null>;
  /** The time of the clock (ms), or null with no sequence. */
  readonly time: Ref<number | null>;
  pick(row: RuleRow): void;
  seek(ms: number): void;
  /** Tell the panel that it shows (true) or not; a change to "shows" checks when an edit came while it did not. */
  setShown(shown: boolean): void;
  /** Check again (after a write of the rules of the project). */
  recheck(): void;
}

/** The wait after an edit before the check (ms). */
export const CHECK_DELAY = 400;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The state of the panel as refs. */
function panelState(sequence: PageSequence | null) {
  return {
    rows: shallowRef<readonly RuleRow[]>([]),
    busy: ref(false),
    error: ref<string | null>(null),
    checks: ref(0),
    selected: ref<string | null>(null),
    series: shallowRef<RuleSeries | null>(null),
    graphBusy: ref(false),
    graphError: ref<string | null>(null),
    time: ref<number | null>(sequence === null ? null : sequence.time.now()),
  };
}

/** The check of the page: the current rules, and the results of a check (of `rules` in place of them for the graph). */
export function pageCheck(parts: SceneRulesParts) {
  const { editor, sequence, port } = parts;
  return async (rules?: Rule[]): Promise<{ set: PageRuleSet; results: RuleResult[] }> => {
    await editor.settled();
    await sequence?.settled();
    const files = { scene: editor.file.path, sequence: sequence?.path ?? "sequence" };
    const next = pageRuleSet(port.project, editor.doc, sequence?.channel.doc ?? null, files);
    const list = rules ?? next.rules.map((item) => item.rule);
    if (list.length === 0) return { set: next, results: [] };
    const results = await port.checkRules({ ...next.request, rules: list });
    if (results === null) throw new Error(t("rules-core-stopped"));
    return { set: next, results: [...results] };
  };
}

/** The debounced check loop: one check at a time, a new check after an edit, no check while the panel is hidden. */
export interface CheckLoop {
  readonly schedule: () => void;
  readonly setShown: (shown: boolean) => void;
  readonly stop: () => void;
}

/**
 * The check loop over `check`. `live` is true during a drag (live ops): the loop waits for the end of the drag. An edit
 * during a check asks for one more check after it.
 */
export function checkLoop(check: () => Promise<void>, live: () => boolean, delay = CHECK_DELAY): CheckLoop {
  let shown = true;
  let stale = true;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  const start = (): void => {
    if (running !== null) {
      again = true;
      return;
    }
    stale = false;
    running = check().finally(() => {
      running = null;
      if (again) {
        again = false;
        start();
      }
    });
  };
  const schedule = (): void => {
    stale = true;
    if (timer !== null) clearTimeout(timer);
    if (!shown) return;
    timer = setTimeout(() => {
      timer = null;
      if (!shown) return;
      if (live()) schedule();
      else start();
    }, delay);
  };
  return {
    schedule,
    setShown: (next) => {
      shown = next;
      if (next && stale) schedule();
      if (!next && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer);
    },
  };
}

export function useSceneRules(parts: SceneRulesParts): SceneRules {
  const { editor, sequence, port } = parts;
  const state = panelState(sequence);
  const run = pageCheck(parts);
  let set: PageRuleSet | null = null;
  let shown = true;

  async function graph(row: RuleRow): Promise<void> {
    const doc = sequence?.channel.doc ?? null;
    const rule = set === null ? undefined : ruleOfRow(set, row.id);
    if (doc === null || rule === undefined || row.sequence !== doc.id) {
      state.series.value = null;
      return;
    }
    state.graphBusy.value = true;
    try {
      state.series.value = graphSeries((await run(graphRules(rule, doc))).results, doc);
      state.graphError.value = null;
    } catch (error) {
      state.graphError.value = message(error);
    } finally {
      state.graphBusy.value = false;
    }
  }

  async function check(): Promise<void> {
    state.busy.value = true;
    try {
      const done = await run();
      set = done.set;
      state.rows.value = sceneRuleRows(done.set, done.results, editor.doc, port.project.problems);
      state.error.value = null;
    } catch (error) {
      state.error.value = message(error);
    } finally {
      state.busy.value = false;
      state.checks.value += 1;
    }
    const picked = state.rows.value.find((row) => row.id === state.selected.value);
    if (picked !== undefined) await graph(picked);
  }

  const loop = checkLoop(check, () => editor.channel.live);
  const stops = [editor.listen(loop.schedule), sequence?.channel.listen(loop.schedule) ?? (() => undefined)];
  const clock = setInterval(() => {
    if (sequence !== null && shown) state.time.value = Math.round(sequence.time.now());
  }, 100);
  onBeforeUnmount(() => {
    for (const stop of stops) stop();
    clearInterval(clock);
    loop.stop();
  });
  loop.schedule();

  return {
    ...state,
    pick: (row) => {
      state.selected.value = row.id;
      if (row.entities.length > 0) parts.selection?.set(row.entities);
      if (row.worst !== null && sequence !== null && row.sequence === sequence.channel.doc.id) {
        sequence.time.seek(row.worst);
      }
      void graph(row);
    },
    seek: (ms) => sequence?.time.seek(ms),
    setShown: (next) => {
      shown = next;
      loop.setShown(next);
    },
    recheck: () => loop.schedule(),
  };
}
