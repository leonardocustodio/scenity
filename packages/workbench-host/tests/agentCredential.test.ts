// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the credential of a chat session against a fake Agent SDK. The tests check these items:
 * the subscription by default (no key variable in the SDK environment), the API key of the `.env` file of the
 * checkout root (mode 600) or of the host environment, the refusals, and the remembered choice per checkout. They
 * also check that the key never shows in an event, an error text or a file of the state folder.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentManager, parseEnvKey, readEnvFileKey, resolveCredential } from "../src/agent/index";
import { createTurnLog, type HookDeps } from "../src/hooks";
import type { HostEvent } from "../src/protocol";
import { HostState } from "../src/state";
import { fakeContext, fakeLab } from "./fakeLab";
import { fakeSdk, initMessage, resultMessage, type FakeQuery } from "./fakeSdk";
import { cleanup, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

/** A fake key with a form that no real key has. */
const FILE_KEY = "sk-ant-test-FILEKEY-0123456789abcdef";
const ENV_KEY = "sk-ant-test-ENVKEY-fedcba9876543210";
const dirs: string[] = [];
afterEach(() => cleanup(...dirs.splice(0)));

function checkoutWith(envFile: string | null, mode = 0o600): string {
  const checkout = tempDir("credential-checkout");
  dirs.push(checkout);
  if (envFile !== null) {
    const path = join(checkout, ".env");
    writeFileSync(path, envFile);
    chmodSync(path, mode);
  }
  return checkout;
}

function setup(checkout: string, env: Record<string, string> = { PATH: "/usr/bin" }) {
  const stateDir = tempDir("credential-state");
  dirs.push(stateDir);
  const events: HostEvent[] = [];
  const hooks: HookDeps = { packet: () => "Workbench context · test", turns: createTurnLog() };
  const sdk = fakeSdk();
  const agents = new AgentManager({
    checkout: () => checkout,
    state: new HostState(stateDir),
    emit: (event) => events.push(event),
    hooks: () => hooks,
    toolContext: () => fakeContext(fakeLab().port),
    env,
    origin: "http://127.0.0.1:4100",
    sdk,
  });
  const query = (index = 0): FakeQuery => {
    const made = sdk.queries[index];
    if (made === undefined) throw new Error("no query");
    return made;
  };
  return { agents, events, sdk, query, stateDir };
}

/** Every file of the state folder as text. */
function stateText(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

describe("the .env parser", () => {
  test("reads the one line, with or without quotes or export", () => {
    expect(parseEnvKey(`A=1\nANTHROPIC_API_KEY=${FILE_KEY}\nB=2`)).toBe(FILE_KEY);
    expect(parseEnvKey(`ANTHROPIC_API_KEY="${FILE_KEY}"`)).toBe(FILE_KEY);
    expect(parseEnvKey(`ANTHROPIC_API_KEY='${FILE_KEY}'\r\n`)).toBe(FILE_KEY);
    expect(parseEnvKey(`export ANTHROPIC_API_KEY=${FILE_KEY}`)).toBe(FILE_KEY);
    expect(parseEnvKey("# ANTHROPIC_API_KEY=x\nOTHER_ANTHROPIC_API_KEY=y")).toBeNull();
    expect(parseEnvKey("ANTHROPIC_API_KEY=")).toBeNull();
  });

  test("refuses a file that other users can read, and the reason holds no key", () => {
    const checkout = checkoutWith(`ANTHROPIC_API_KEY=${FILE_KEY}\n`, 0o644);
    let message = "";
    try {
      readEnvFileKey(checkout);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("644");
    expect(message).toContain("chmod 600");
    expect(message).not.toContain(FILE_KEY);
    expect(readEnvFileKey(checkoutWith(null))).toBeNull();
  });

  test("resolves the file first, then the environment; the subscription has no key", () => {
    const file = checkoutWith(`ANTHROPIC_API_KEY=${FILE_KEY}\n`);
    const env = { ANTHROPIC_API_KEY: ENV_KEY };
    expect(resolveCredential("api-key", file, env)).toEqual({
      credential: "api-key",
      keyFrom: ".env",
      key: FILE_KEY,
    });
    expect(resolveCredential("api-key", checkoutWith(null), env)).toMatchObject({ keyFrom: "environment" });
    expect(resolveCredential("subscription", file, env)).toEqual({
      credential: "subscription",
      keyFrom: null,
      key: null,
    });
  });
});

describe("a session on each credential", () => {
  test("subscription: no key and no gateway token in the SDK environment, apiKeySource none runs", async () => {
    const checkout = checkoutWith(`ANTHROPIC_API_KEY=${FILE_KEY}\n`);
    const { agents, query } = setup(checkout, {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: ENV_KEY,
      ANTHROPIC_AUTH_TOKEN: "gateway",
    });
    const { session, info } = agents.start({ mode: "default" });
    expect(info).toMatchObject({ credential: "subscription", keyFrom: null });
    const env = query().options.env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(JSON.stringify(query().options.env)).not.toContain(FILE_KEY);
    query().push(initMessage("s-1", "none"));
    await until(() => agents.get(session).info().state === "idle");
    expect(agents.get(session).info().apiKeySource).toBe("none");
    expect(agents.credential()).toBe("subscription");
  });

  test("api-key: the key of the .env file reaches only the SDK environment, never a text of the host", async () => {
    const checkout = checkoutWith(`OTHER=1\nANTHROPIC_API_KEY="${FILE_KEY}"\n`);
    const { agents, events, query, stateDir } = setup(checkout);
    const { session, info } = agents.start({ mode: "default", credential: "api-key" });
    expect(info).toMatchObject({ credential: "api-key", keyFrom: ".env" });
    expect(query().options.env?.ANTHROPIC_API_KEY).toBe(FILE_KEY);
    query().push(initMessage("s-1", "ANTHROPIC_API_KEY"));
    await until(() => agents.get(session).info().state === "idle");
    // A tool result that prints the key, and an error whose stderr holds it.
    query().push({ type: "user", message: { role: "user", content: [{ type: "text", text: `key=${FILE_KEY}` }] } });
    query().push(resultMessage("s-1", 0.001));
    await until(() => agents.get(session).info().results === 1);
    query().options.stderr?.(`fatal: bad key ${FILE_KEY}\n`);
    query().fail(`Claude Code returned an error result: ${FILE_KEY}`);
    await until(() => agents.get(session).info().state === "error");
    const texts = [
      JSON.stringify(events),
      JSON.stringify(agents.live()),
      agents.get(session).info().error ?? "",
      stateText(stateDir),
    ].join("\n");
    expect(texts).toContain("[ANTHROPIC_API_KEY]");
    expect(texts).not.toContain(FILE_KEY);
    expect(stateText(stateDir)).toContain('"credential": "api-key"');
    expect(agents.credential()).toBe("api-key");
    expect(agents.resumable()[0]?.params.credential).toBe("api-key");
  });

  test("api-key from the host environment when the .env file is absent; init none stops it", async () => {
    const { agents, query } = setup(checkoutWith(null), { PATH: "/usr/bin", ANTHROPIC_API_KEY: ENV_KEY });
    const { session, info } = agents.start({ mode: "default", credential: "api-key" });
    expect(info.keyFrom).toBe("environment");
    expect(query().options.env?.ANTHROPIC_API_KEY).toBe(ENV_KEY);
    query().push(initMessage("s-1", "none"));
    await until(() => agents.get(session).info().state === "error");
    expect(agents.get(session).info().error).toContain("the key did not apply");
  });

  test("api-key with a mode 644 file is refused with the reason, and starts no SDK process", () => {
    const checkout = checkoutWith(`ANTHROPIC_API_KEY=${FILE_KEY}\n`, 0o644);
    const { agents, sdk } = setup(checkout, { PATH: "/usr/bin", ANTHROPIC_API_KEY: ENV_KEY });
    expect(() => agents.start({ mode: "default", credential: "api-key" })).toThrow("not 600");
    expect(sdk.queries).toHaveLength(0);
    expect(agents.credential()).toBe("subscription");
  });
});
