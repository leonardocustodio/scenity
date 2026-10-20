// SPDX-License-Identifier: Apache-2.0
/**
 * The background tasks in the editor window: the Tasks panel, the command "New background task" (it shows the panel
 * with the focus in its prompt), and the notice at the end of a task. The notice is a toast, a fact of the bell, and
 * a system notification when the window is not in front.
 */
import { nextTick, watch } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import { pageReview } from "../review/reviewState";
import { pageTaskGate } from "../review/taskGate";
import type { AgentClient, AgentTaskInfo } from "./agentClient";
import type { AgentStore } from "./agentStore";
import TasksPanel from "./TasksPanel.vue";
import { keepTask, mergeGroup, type TaskGroupView } from "./taskGroups";

/** The width of a picture of the grid of frames (px). */
const GRID_WIDTH = 480;

/** The count of the ops that wait in Review for some change sets. */
export function waitingOps(sets: readonly string[]): number {
  const keys = new Set(sets);
  const review = pageReview();
  return (review?.sets.value ?? []).filter((set) => keys.has(set.key)).reduce((sum, set) => sum + set.ops.length, 0);
}

/** True when a task is at its end. */
function ended(task: AgentTaskInfo): boolean {
  return task.state !== "running" && task.state !== "checking";
}

/** A system notification when the window is not in front and the person allowed them. */
function systemNotice(title: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  new Notification(title);
}

/** The notice at the end of each task. */
function watchTaskEnds(store: AgentStore, shell: Pick<StudioShell, "notices" | "status">): void {
  watch(store.tasks, (now, old) => {
    for (const task of now) {
      const before = old.find((item) => item.id === task.id);
      if (before === undefined || ended(before) || !ended(task)) continue;
      const title = t("task-ended", { name: task.name, state: t(`tasks-state-${task.state}`) });
      shell.notices.toast(title, task.reason ?? undefined);
      shell.status.remember(title);
      systemNotice(title);
    }
  });
}

/** Start the tasks of the window: the panel and the notice at the end. Return the command of a new task. */
export function startTasks(
  store: AgentStore,
  shell: Pick<StudioShell, "notices" | "status" | "setPanel" | "showPanel">,
  project: string,
  client: Pick<AgentClient, "tasks">,
): PageKeyCommandSpec {
  shell.setPanel("tasks", {
    component: TasksPanel,
    props: {
      tasks: () => store.tasks.value,
      start: (request: Parameters<AgentStore["startTask"]>[0]) => {
        // The start is a gesture of the person: the moment to ask for system notifications.
        if (typeof Notification !== "undefined" && Notification.permission === "default")
          void Notification.requestPermission();
        return store.startTask(request);
      },
      stop: (id: string) => store.stopTask(id),
      search: async (text: string) => (await client.tasks(project, text).catch(() => ({ tasks: [] }))).tasks,
      waiting: waitingOps,
      open: (session: string) => {
        store.select(session);
        shell.showPanel("agent");
      },
      review: () => shell.showPanel("review"),
      picture: (session: string) => pageTaskGate()?.look(session, GRID_WIDTH) ?? Promise.resolve(null),
      keep: (group: TaskGroupView, session: string) => {
        const review = pageReview();
        return review === null ? t("task-grid-no-review") : keepTask(review, group, session);
      },
      merge: (group: TaskGroupView) => {
        const review = pageReview();
        return review === null ? t("task-grid-no-review") : mergeGroup(review, group);
      },
    },
  });
  watchTaskEnds(store, shell);
  return {
    id: "agent.task.new",
    title: t("command-task-new"),
    category: "agent",
    menu: "agent",
    run: async () => {
      shell.showPanel("tasks");
      await nextTick();
      document.querySelector<HTMLElement>('[data-testid="tasks-prompt"]')?.focus();
    },
  };
}
