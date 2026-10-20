// SPDX-License-Identifier: Apache-2.0
/**
 * Run a program of the allowlist of the host and collect its output. The host uses
 * it for Git. A program never gets a shell: the arguments go to the program as they are.
 */
import { spawn } from "node:child_process";

/** The result of a program that ended. */
export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a program in a folder and collect its output. The promise rejects only when the program cannot start. */
export function exec(program: string, args: readonly string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

/** Run Git in a folder. Give its stdout; throw an error with its stderr when Git fails. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec("git", args, cwd);
  if (result.code !== 0) {
    const text = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.code)}`;
    throw new Error(`git ${args[0] ?? ""}: ${text}`);
  }
  return result.stdout;
}
