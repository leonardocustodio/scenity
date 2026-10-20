// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers of the workbench host tests: a temporary Git repository, a fake dev server command and a
 * fake workbench page over a real WebSocket.
 */
import { expect } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/exec";
import { isAnswer, isEvent, type Answer, type HostEvent, type HostEndpoint } from "../src/protocol";
import type { CommandFactory } from "../src/servers";
import { ciWaitMs } from "./ciTiming";
import { trackFolder } from "./hygiene";

/**
 * A temporary folder that `cleanup` removes. The run records it. Thus the end of the run removes it when a test did
 * not, and finds a host process that still uses it.
 */
export function tempDir(prefix: string): string {
  return trackFolder(realpathSync(mkdtempSync(join(tmpdir(), `workbench-${prefix}-`))));
}

export function cleanup(...paths: string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

/** A temporary Git repository with one commit, in a parent folder of its own (for sibling worktrees). */
export async function makeRepo(): Promise<{ parent: string; repo: string }> {
  const parent = tempDir("repo");
  const repo = join(parent, "repo");
  await Bun.$`mkdir -p ${repo}`.quiet();
  await git(repo, ["init", "--quiet", "--initial-branch=main"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "README.md"), "test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "--quiet", "-m", "start"]);
  return { parent, repo };
}

const FAKE_SERVER = join(import.meta.dir, "fixtures", "fakeServer.ts");

/** The command of the fake dev server. */
export const fakeCommand: CommandFactory = (checkout, port) => ({
  cmd: [process.execPath, FAKE_SERVER, String(port)],
  cwd: checkout,
  env: { PATH: process.env.PATH ?? "" },
});

/** A command that fails at once. */
export const failingCommand: CommandFactory = (checkout) => ({
  cmd: [process.execPath, "-e", "console.error('boom'); process.exit(3)"],
  cwd: checkout,
  env: { PATH: process.env.PATH ?? "" },
});

/** Wait until the test gives true, or throw after the timeout (SCENITY_CI_WAIT_FACTOR times longer on CI). */
export async function until(test: () => boolean, timeoutMs = ciWaitMs(5000), what = "the condition"): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timeout: ${what}`);
    await Bun.sleep(20);
  }
}

/** A fake workbench page: a WebSocket client with requests and a list of the events. */
export class FakePage {
  readonly events: HostEvent[] = [];
  readonly #socket: WebSocket;
  readonly #answers = new Map<number, (answer: Answer) => void>();
  #next = 1;
  /** Called for each event. */
  onEvent: (event: HostEvent) => void = () => undefined;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (message) => {
      const value: unknown = JSON.parse(String(message.data));
      if (isAnswer(value)) this.#answers.get(value.id)?.(value);
      else if (isEvent(value)) {
        this.events.push(value);
        this.onEvent(value);
      }
    });
  }

  static async open(endpoint: HostEndpoint): Promise<FakePage> {
    const socket = new WebSocket(`${endpoint.origin.replace("http", "ws")}/ws?token=${endpoint.token}`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("The WebSocket did not open.")));
    });
    return new FakePage(socket);
  }

  /** Send a request and give its answer. */
  request(type: string, params: Record<string, unknown> = {}): Promise<Answer> {
    const id = this.#next++;
    return new Promise((resolve) => {
      this.#answers.set(id, resolve);
      this.#socket.send(JSON.stringify({ id, type, ...params }));
    });
  }

  /** Send a binary message (a picture frame) on the socket of the page. */
  sendBinary(data: Uint8Array<ArrayBuffer>): void {
    this.#socket.send(data);
  }

  /** Send a request and give its result; throw on an error answer. */
  async call(type: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const answer = await this.request(type, params);
    if (!answer.ok) throw new Error(answer.error);
    return answer.result;
  }

  /** Wait for the first event (from now or in the list) that the test accepts. */
  async waitEvent(test: (event: HostEvent) => boolean, timeoutMs = ciWaitMs(5000)): Promise<HostEvent> {
    let found: HostEvent | undefined;
    await until(() => (found = this.events.find(test)) !== undefined, timeoutMs, "an event of the host");
    return found!;
  }

  close(): void {
    this.#socket.close();
  }
}

/** Check that the promise rejects with an error whose message holds the text. */
export async function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(text);
}
