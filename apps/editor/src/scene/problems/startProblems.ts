// SPDX-License-Identifier: Apache-2.0
/**
 * The Problems panel of the editor window: the sources of the page, a check again a moment after each edit and each new
 * line of the Console, the counts of the status bar (a press opens the panel), Go to and Ask the agent to fix. The rule
 * check runs only while the panel shows (it holds the frames of the scene worker).
 */
import { watch } from "vue";
import { studioHost } from "../../studio/shell/panels";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { pageConsole } from "../console/consoleStore";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { PageRulesPort } from "../pageRules";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSequence } from "../sequencer/pageSequence";
import { pageKeys } from "../settings/pageKeys";
import { pageProblems, type Problem } from "./problemList";
import ProblemsPanel from "./ProblemsPanel.vue";
import {
  assetProblems,
  componentProblems,
  healthProblems,
  pluginProblems,
  ruleProblems,
  schemaProblems,
} from "./problemSources";
import { ASSET_HEALTH_PATH, type AssetHealth, type DatabaseFix } from "../../assetBrowser/assetTypes";
import { devServerAssets } from "../../assetBrowser/assetClient";
import { checkBusy, checkProblems, checkReport, runCheckJob } from "./checkJob";
import { databaseProblems } from "./databaseProblems";

/** The wait after a change before a check (ms). */
const CHECK_DELAY = 600;

/** What the panel reads of the page. */
export interface ProblemParts {
  readonly shell: Pick<StudioShell, "setPanel" | "showPanel" | "status" | "search" | "notices">;
  readonly editor: ScenePageEditor;
  readonly sequence: PageSequence | null;
  readonly rules?: PageRulesPort | undefined;
  readonly assets: readonly { readonly id: string }[];
  readonly selection?: PageSelectionPort | undefined;
  /** The folder of the project on the dev server (`/projects/<key>/`). */
  readonly base: string;
}

/** The time that a health answer stays (ms): the rights and the build change with the files, not with the edits. */
const HEALTH_MS = 30_000;
let healthCache: { readonly at: number; readonly value: Promise<AssetHealth> } | null = null;

/** The health of the assets of the project (none: a page with no dev server answers no problem). */
function health(base: string): Promise<AssetHealth> {
  if (healthCache !== null && Date.now() - healthCache.at < HEALTH_MS) return healthCache.value;
  const value = fetch(`${base}${ASSET_HEALTH_PATH}`, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<AssetHealth>) : { rights: [], unbuilt: [] }))
    .catch(() => ({ rights: [], unbuilt: [] }));
  healthCache = { at: Date.now(), value };
  return value;
}

/**
 * Go to a problem: select its entities, move the clock to its time, frame them; a rule with no entity opens the Rules
 * panel.
 */
function goTo(parts: ProblemParts, problem: Problem): void {
  if (problem.time !== null) void globalThis.__scenity?.seek?.(problem.time);
  if (problem.entities.length > 0) {
    parts.selection?.set([...problem.entities]);
    void pageKeys().run("view.frame");
  } else if (problem.kind === "rule" || problem.kind === "budget" || problem.kind === "rights") {
    parts.shell.showPanel("rules");
  }
}

/** The prompt of Ask the agent to fix. */
function askPrompt(problem: Problem): string {
  return t("problem-ask-prompt", { title: problem.title, detail: problem.detail ?? "" }).trim();
}

/** Start the Problems panel. */
export function startProblems(parts: ProblemParts): void {
  const { shell, editor, rules } = parts;
  const list = pageProblems();
  if (rules !== undefined) {
    const check = async () => {
      const { pageCheck } = await import("../rules/useSceneRules");
      return pageCheck({ editor, sequence: parts.sequence, port: rules })();
    };
    // The rule check runs in the scene worker and holds its frames for a while: it runs only while the Problems panel
    // shows (an open of the panel checks again). At other times, the rules keep their last problems.
    let last: readonly Problem[] = [];
    list.add("rules", async () => {
      if (document.querySelector('[data-testid="problems-panel"]')?.checkVisibility() !== true) return last;
      last = await ruleProblems({ check, problems: rules.project.problems }, editor.doc);
      return last;
    });
  }
  list.add("assets", () => assetProblems(editor.doc, parts.assets));
  const remove = (entity: string, component: string) => pageKeys().execute("component.remove", { entity, component });
  list.add("components", () => componentProblems(editor.doc, editor.registry, remove));
  list.add("schema", () => schemaProblems(editor.doc, editor.registry));
  list.add("plugins", () => pluginProblems(pageConsole()));
  list.add("health", async () => healthProblems(await health(parts.base), editor.doc));
  // The problems of the asset database, with the fixes of the dev server (a relink, a new ID).
  const source = devServerAssets(parts.base);
  const fix = async (input: DatabaseFix): Promise<void> => {
    const result = await source.fix?.(input);
    if (result !== undefined && !result.ok) shell.notices.toast(t("problem-fix-failed"), result.reason, "alert");
    healthCache = null;
    await list.refresh();
  };
  // The rows of the check job that do not pass.
  list.add("check", () => checkProblems(checkReport.value?.rows ?? []));
  list.add("database", async () =>
    databaseProblems((await source.databaseProblems?.()) ?? [], editor.file.path, (input) => fix(input)),
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void list.refresh(), CHECK_DELAY);
  };
  editor.listen(schedule);
  watch(pageConsole().entries, schedule);
  watch(list.problems, () => shell.status.set("problems", list.counts()), { immediate: true });
  shell.status.onPress("problems", () => shell.showPanel("problems"), "panel.open.problems");
  shell.setPanel("problems", {
    component: ProblemsPanel,
    props: {
      list,
      goTo: (problem: Problem) => goTo(parts, problem),
      actions: [
        {
          id: "check",
          label: t("check-run"),
          busy: () => checkBusy.value,
          run: () =>
            void runCheckJob(parts.base).then(async (reason) => {
              if (reason !== null) shell.notices.toast(t("check-failed"), reason, "alert");
              await list.refresh();
            }),
        },
      ],
      ask: () => {
        const ask = shell.search.ask;
        return studioHost.value && ask !== null ? (problem: Problem) => ask(askPrompt(problem)) : null;
      },
    },
  });
}
