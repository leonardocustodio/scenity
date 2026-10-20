// SPDX-License-Identifier: Apache-2.0
/**
 * The Jobs panel and the Plugins window of the editor window, for the project
 * folder of the page.
 */
import type { StudioShell } from "../../studio/shell/shell";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { t } from "../../texts";
import { pageKeys } from "../settings/pageKeys";
import JobsPanel from "./JobsPanel.vue";
import { serverRows, studioRows, type ServerJob, type StudioJob } from "./useJobs";
import { servedByStudio } from "../projects/noProject";
import { csrfValue } from "../../hub/studioApi";
import PluginsPanel from "../extensions/PluginsPanel.vue";

/** The form of a command ID part: a plugin command becomes `cli.<name>`. */
const NAME = /^[a-z][a-zA-Z0-9]*$/;

/**
 * The commands of the CLI faces of the plugins as commands of the window (`cli.<name>`, with the argument
 * `args`): the search box gives them a form, and the agents find them in the catalogue. A run is a job of the dev
 * server, so the Jobs panel shows it.
 */
async function startPluginCommands(base: string): Promise<void> {
  const answer = await fetch(`${base}cli.commands.json`, { cache: "no-store" }).catch(() => null);
  if (answer?.ok !== true) return;
  const { commands } = (await answer.json()) as { commands: { name: string; summary: string }[] };
  pageKeys().register(
    commands
      .filter((command) => NAME.test(command.name))
      .map((command) => ({
        id: `cli.${command.name}`,
        title: t("jobs-cli-command", { name: command.name, summary: command.summary }),
        category: "plugin",
        agents: true,
        args: { args: { type: "string" as const, description: t("jobs-command-args"), optional: true } },
        run: async (args: Readonly<Record<string, unknown>>) => {
          await fetch(`${base}cli.run`, {
            method: "POST",
            headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
            body: JSON.stringify({ name: command.name, args: typeof args.args === "string" ? args.args : "" }),
          });
        },
      })),
  );
}

/** How often the status bar reads the jobs (ms). */
const STATUS_MS = 3000;

/** The count of the jobs that run or wait in the status bar; a press opens the Jobs panel. */
function startJobStatus(shell: Pick<StudioShell, "status" | "showPanel">): void {
  const read = async (): Promise<void> => {
    const server = await fetch("/jobs.json", { cache: "no-store" })
      .then((answer) => (answer.ok ? (answer.json() as Promise<{ jobs: ServerJob[] }>) : { jobs: [] }))
      .catch(() => ({ jobs: [] }));
    const host = (await servedByStudio())
      ? await fetch("/api/jobs", { headers: { "x-studio-csrf": csrfValue() } })
          .then((answer) => (answer.ok ? (answer.json() as Promise<StudioJob[]>) : []))
          .catch(() => [])
      : [];
    const rows = [...serverRows(server.jobs), ...studioRows(host)];
    shell.status.set("jobs", rows.filter((row) => row.state === "running" || row.state === "queued").length);
  };
  shell.status.onPress("jobs", () => shell.showPanel("jobs"), "panel.open.jobs");
  void read();
  setInterval(() => void read(), STATUS_MS);
}

/** Give the Jobs panel its content for the project `project` (its name on the dev server). */
export function startJobs(shell: Pick<StudioShell, "setPanel" | "status" | "showPanel">, project: string): void {
  startJobStatus(shell);
  shell.setPanel("jobs", { component: JobsPanel, props: { base: `/projects/${project}/` } });
  // The Plugins window.
  shell.setPanel("plugins", { component: PluginsPanel, props: { base: `/projects/${project}/` } });
  void startPluginCommands(`/projects/${project}/`);
}
