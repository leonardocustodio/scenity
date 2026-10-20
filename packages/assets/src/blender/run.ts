// SPDX-License-Identifier: Apache-2.0
/**
 * Run Blender for the asset pipeline.
 *
 * The pipeline uses Blender 5.2. It runs the Blender of BLENDER (a path), else the Blender app of macOS
 * (/Applications/Blender.app) when it is 5.2, else the pinned toolchain image (packages/assets/toolchain/Dockerfile:
 * the Linux build of Blender 5.2.2). `BLENDER=docker` runs the image also on macOS. The container sees the workspace
 * root at /work and writes files as the user of this machine.
 *
 * The export of a master (`exportMasters`) is deterministic: the same master gives the same bytes. `checkExports`
 * exports again into a scratch folder and compares the bytes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceRoot } from "../build/workspace";

/** The tag changes with the Dockerfile, so an old local image is not used. */
export const BLENDER_IMAGE = "scenity-art-blender:5.2.2-2";
const BLENDER_VERSION = "Blender 5.2";
/** The Blender app of macOS: the pipeline uses it when BLENDER is not set and its version is BLENDER_VERSION. */
const MAC_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";
/** The folder of this package. */
const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const TOOLCHAIN = join(PACKAGE, "toolchain");

/** The path of a Blender script of this package (`blender/<name>`), relative to the workspace root. */
export function blenderScript(name: string): string {
  return relative(workspaceRoot(), join(PACKAGE, "blender", name));
}

function run(command: readonly string[], cwd: string): void {
  const result = Bun.spawnSync([...command], { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0)
    throw new Error(`${command[0] ?? "command"} failed with exit code ${String(result.exitCode)}`);
}

/**
 * The reason of a run with no Blender: no Blender 5.2 on this machine and no Docker for the toolchain image.
 * The import queue of the editor finds the words "no Blender" and shows the fix of the doctor.
 */
export const NO_BLENDER =
  "no Blender: FBX, OBJ and .blend files need Blender 5.2 (BLENDER or the Blender app) or Docker for the toolchain image";

function ensureImage(): void {
  if (Bun.which("docker") === null) throw new Error(NO_BLENDER);
  const inspect = Bun.spawnSync(["docker", "image", "inspect", BLENDER_IMAGE], { stdout: "ignore", stderr: "ignore" });
  if (inspect.exitCode === 0) return;
  console.log(`blender: building ${BLENDER_IMAGE}`);
  run(["docker", "build", "-t", BLENDER_IMAGE, TOOLCHAIN], workspaceRoot());
}

function versionOf(path: string): string {
  const version = Bun.spawnSync([path, "--version"], { stdout: "pipe", stderr: "ignore" });
  return version.stdout.toString().split("\n")[0] ?? "";
}

function localBlender(): string | null {
  const path = process.env.BLENDER;
  // BLENDER=docker: the toolchain image also on a machine with the Blender app (a check of the Linux build).
  if (path === "docker") return null;
  if (path === undefined || path === "") {
    // The Blender app of macOS, when it is the version of the pipeline.
    return process.platform === "darwin" &&
      existsSync(MAC_BLENDER) &&
      versionOf(MAC_BLENDER).startsWith(BLENDER_VERSION)
      ? MAC_BLENDER
      : null;
  }
  const text = versionOf(path);
  if (!text.startsWith(BLENDER_VERSION))
    throw new Error(`BLENDER=${path} is not ${BLENDER_VERSION} (${text || "no version"})`);
  return path;
}

/**
 * True when a Blender 5.2 of this machine runs the scripts (BLENDER or the app of macOS), not the toolchain image. The
 * tests that need Blender run only then (as `py:test`).
 */
export function hasLocalBlender(): boolean {
  try {
    return localBlender() !== null;
  } catch {
    return false;
  }
}

/**
 * Run Blender in the background with factory settings. The arguments use paths relative to the workspace root.
 * `mounts` are more absolute folders that the arguments name, for example the files of an import in the state folder
 * of the workbench host. The toolchain image sees each one at the same path. Throws when Blender fails.
 */
export function runBlender(args: readonly string[], mounts: readonly string[] = []): void {
  const root = workspaceRoot();
  // "--python-exit-code 1": a Python error gives exit code 1 (Blender gives 0 by default).
  const base = ["-b", "--factory-startup", "-noaudio", "--python-exit-code", "1"];
  const local = localBlender();
  if (local !== null) {
    run([local, ...base, ...args], root);
    return;
  }
  ensureImage();
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  run(
    [
      "docker",
      "run",
      "--rm",
      "-v",
      `${root}:/work`,
      ...mounts.flatMap((folder) => ["-v", `${folder}:${folder}`]),
      "-w",
      "/work",
      "--user",
      `${String(uid)}:${String(gid)}`,
      "-e",
      "HOME=/tmp",
      BLENDER_IMAGE,
      "blender",
      ...base,
      ...args,
    ],
    root,
  );
}

/** The export kinds of `blender/export.py`: an animation exports the armature and its actions only. */
export type ExportKind = "model" | "skinned-model" | "animation";

/** One master to export. `master` is relative to the workspace root. */
export interface ExportJob {
  readonly id: string;
  readonly master: string;
  readonly kind: ExportKind;
}

/** Export each master to `outDir/<id>.glb` (an absolute folder inside the workspace root). Returns the IDs. */
export function exportMasters(jobs: readonly ExportJob[], outDir: string): string[] {
  const root = workspaceRoot();
  mkdirSync(outDir, { recursive: true });
  for (const job of jobs) {
    if (!existsSync(join(root, job.master))) throw new Error(`${job.id}: no master at ${job.master}`);
    const out = relative(root, join(outDir, `${job.id}.glb`));
    const script = blenderScript("export.py");
    runBlender([job.master, "--python", script, "--", "--asset", job.id, "--kind", job.kind, "--out", out]);
    if (!existsSync(join(root, out))) throw new Error(`${job.id}: Blender wrote no file at ${out}`);
  }
  return jobs.map((job) => job.id);
}

/**
 * Export again into `scratchDir` (inside the workspace root, so the container can write it) and compare the bytes
 * with `committedDir`. Removes the scratch folder. Returns the differences.
 */
export function checkExports(jobs: readonly ExportJob[], committedDir: string, scratchDir: string): string[] {
  rmSync(scratchDir, { recursive: true, force: true });
  try {
    const exported = exportMasters(jobs, scratchDir);
    const problems: string[] = [];
    for (const id of exported) {
      const committed = join(committedDir, `${id}.glb`);
      if (!existsSync(committed)) {
        problems.push(`${id}: ${relative(workspaceRoot(), committed)} is missing`);
        continue;
      }
      const again = readFileSync(join(scratchDir, `${id}.glb`));
      if (!again.equals(readFileSync(committed))) problems.push(`${id}: a new export gives other bytes`);
    }
    return problems;
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}
