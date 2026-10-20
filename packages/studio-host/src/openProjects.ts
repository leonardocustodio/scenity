// SPDX-License-Identifier: Apache-2.0
/**
 * The open projects of the studio. The host writes them to `projects.json` of the studio state folder. The scene server
 * reads and watches that file (apps/editor `scripts/projectsFile.ts`). A restricted project loads no plugin code. A
 * project with no request for a time closes, and the next open of it opens it again.
 */
import { writeAtomic } from "./store";

/** The format of the projects file (apps/editor `scripts/projectsFile.ts`). */
export const PROJECTS_FILE_FORMAT = "scenity.studio-projects/1";

export interface OpenProject {
  readonly key: string;
  readonly dir: string;
  /** True until the owner trusts the project: the scene server loads no plugin code of it. */
  readonly restricted: boolean;
  readonly openedAt: number;
  readonly lastSeen: number;
}

/** The open projects and their file. */
export class OpenProjects {
  readonly #open = new Map<string, OpenProject>();

  constructor(
    readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.#write();
  }

  list(): OpenProject[] {
    return [...this.#open.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  get(key: string): OpenProject | undefined {
    return this.#open.get(key);
  }

  /** Open a project (or change its folder or restriction) and write the file. */
  open(key: string, dir: string, restricted: boolean): OpenProject {
    const old = this.#open.get(key);
    const at = this.now();
    const project = { key, dir, restricted, openedAt: old?.openedAt ?? at, lastSeen: at };
    this.#open.set(key, project);
    if (old?.dir !== dir || old.restricted !== restricted) this.#write();
    return project;
  }

  /** Mark a request of a project, so it does not close as an idle project. */
  touch(key: string): void {
    const project = this.#open.get(key);
    if (project !== undefined) this.#open.set(key, { ...project, lastSeen: this.now() });
  }

  close(key: string): boolean {
    const closed = this.#open.delete(key);
    if (closed) this.#write();
    return closed;
  }

  /** Close each project with no request for `idleMs`; give their keys. */
  closeIdle(idleMs: number): string[] {
    const limit = this.now() - idleMs;
    const idle = [...this.#open.values()].filter((p) => p.lastSeen < limit).map((p) => p.key);
    for (const key of idle) this.#open.delete(key);
    if (idle.length > 0) this.#write();
    return idle;
  }

  #write(): void {
    const projects: Record<string, string | { dir: string; restricted: true }> = {};
    for (const p of this.list()) projects[p.key] = p.restricted ? { dir: p.dir, restricted: true } : p.dir;
    writeAtomic(this.file, `${JSON.stringify({ format: PROJECTS_FILE_FORMAT, projects }, null, 2)}\n`);
  }
}
