// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the command line of the host: the arguments, the READY line as the first
 * stdout line, `/health`, and SIGTERM.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "../src/main";
import { TOKEN_ENV, TOKEN_HEADER, parseReadyLine } from "../src/protocol";
import { cleanup, makeRepo, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { hostProgram } from "./hostProgram";
import { stopTracked, trackProcess } from "./hygiene";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "0f".repeat(32);
const folders: string[] = [];
// A host that a failed test did not stop ends here.
afterAll(async () => {
  await stopTracked();
  cleanup(...folders);
});

describe("the arguments", () => {
  test("the flags parse", () => {
    expect(parseArgs(["--checkout", "/r"])).toEqual({
      checkout: "/r",
      project: undefined,
      port: 0,
      stateDir: undefined,
    });
    expect(parseArgs(["--checkout=/r", "--port", "5000", "--state", "/s"])).toEqual({
      checkout: "/r",
      project: undefined,
      port: 5000,
      stateDir: "/s",
    });
    // A project folder is the checkout too, unless --checkout names another folder.
    expect(parseArgs(["--project", "/p"])).toMatchObject({ checkout: "/p", project: "/p" });
    expect(parseArgs(["--checkout", "/r", "--project", "/r/samples/showroom"])).toMatchObject({
      checkout: "/r",
      project: "/r/samples/showroom",
    });
  });

  test("bad flags fail with the usage", () => {
    expect(() => parseArgs([])).toThrow("--checkout");
    expect(() => parseArgs(["--checkout", "rel"])).toThrow("absolute");
    expect(() => parseArgs(["--checkout", "/r", "--port", "x"])).toThrow("--port");
    expect(() => parseArgs(["--checkout", "/r", "--other"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--checkout"])).toThrow("needs a value");
    expect(() => parseArgs(["--project", "rel"])).toThrow("absolute");
  });
});

/** Read the first line of a stream. */
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text.split("\n")[0] ?? "";
}

describe("the host process", () => {
  test("it prints the READY line first, answers /health and ends on SIGTERM", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("main-state");
    folders.push(parent, state);
    const child = trackProcess(
      Bun.spawn([...hostProgram(), "--checkout", repo, "--port", "0", "--state", state], {
        // A Keychain file that does not exist, so the test never reads or renews a real session of the owner.
        env: { ...process.env, [TOKEN_ENV]: TOKEN, SCENITY_LABS_KEYCHAIN: join(state, "none.keychain-db") },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const endpoint = parseReadyLine(await firstLine(child.stdout));
    expect(endpoint?.token).toBe(TOKEN);
    const response = await fetch(`${endpoint?.origin ?? ""}/health`);
    expect(await response.json()).toEqual({ ok: true });
    expect((await fetch(`${endpoint?.origin ?? ""}/context`)).status).toBe(401);
    // The CLI host has no sign-in gate (src/main.ts): the token alone opens the paths.
    const gated = await fetch(`${endpoint?.origin ?? ""}/context`, { headers: { [TOKEN_HEADER]: TOKEN } });
    expect(gated.status).toBe(200);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
  });

  test("a folder outside Git fails with code 2", async () => {
    const folder = tempDir("main-nogit");
    folders.push(folder);
    const child = trackProcess(
      Bun.spawn([...hostProgram(), "--checkout", folder, "--state", folder], { stdout: "pipe", stderr: "pipe" }),
    );
    expect(await child.exited).toBe(2);
  });
});
