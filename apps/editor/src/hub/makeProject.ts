// SPDX-License-Identifier: Apache-2.0
/**
 * The steps of the new project wizard: a `create` job in the parent folder, an optional `git.init` job in the new
 * folder, then the open of the project. A failed `create` stops the steps. A failed `git.init` does not stop them (the
 * project exists).
 */
import type { JobInfo, StudioApi } from "./studioApi";

export interface NewProject {
  readonly name: string;
  readonly template: string;
  readonly parent: string;
  readonly git: boolean;
  /** "linked": the packages of the checkout; "npm": the published packages (`--version latest`). */
  readonly packages: "linked" | "npm";
}

/** The rule of a project name of `scenity create`: 1 to 64 letters, digits, `-` and `_`. */
export const PROJECT_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The folder `name` in `parent`, with the separator of the parent path. */
export function childPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export type MakeResult =
  | { readonly kind: "opened"; readonly url: string; readonly dir: string }
  | { readonly kind: "failed"; readonly job: JobInfo };

export interface MakeSteps {
  readonly api: Pick<StudioApi, "startJob" | "openProject">;
  /** Wait for the end of a job. */
  finished(id: string): Promise<JobInfo>;
  /** The function gets each job when it starts (the wizard shows its log). */
  started?(job: JobInfo): void;
}

export async function makeNewProject(steps: MakeSteps, project: NewProject): Promise<MakeResult> {
  const create = await steps.api.startJob({
    command: "create",
    args: {
      name: project.name,
      template: project.template,
      install: true,
      json: true,
      ...(project.packages === "npm" ? { version: "latest" } : {}),
    },
    cwd: project.parent,
  });
  steps.started?.(create);
  const made = await steps.finished(create.id);
  if (made.state !== "done") return { kind: "failed", job: made };
  const dir = childPath(project.parent, project.name);
  if (project.git) {
    const git = await steps.api.startJob({ command: "git.init", cwd: dir });
    steps.started?.(git);
    await steps.finished(git.id);
  }
  const opened = await steps.api.openProject(dir);
  return { kind: "opened", url: opened.url, dir };
}
