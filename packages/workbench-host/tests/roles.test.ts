// SPDX-License-Identifier: Apache-2.0
/**
 * The auth providers and the roles of the tokens. The host refuses each request above the role of its page:
 * - a viewer cannot open a terminal, start an agent, start a run, write files or use a Git write;
 * - an editor cannot open a shell terminal, use the mode "all" or start a background run;
 * - the launch token is an admin token.
 *
 * The terminals run a small script, and the chat uses the fake Agent SDK, so no test starts `claude` or calls a model.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { authFromEnv, makeProvider, parseRoleTokens, ROLES_ENV } from "../src/authProvider";
import { startHost, type Host } from "../src/host";
import { withoutLabKey } from "@scenity/labs-platform/labKey";
import { checkLabTicket, labGateKey, makeLabTicket } from "../src/labTicket";
import { requestRefusal, roleCan, type HostEvent, type TerminalOpened } from "../src/protocol";
import type { RemoteSetup } from "../src/remote";
import { freePort } from "../src/servers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { fakeSdk } from "./fakeSdk";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const VIEWER = "1a".repeat(32);
const EDITOR = "2b".repeat(32);
const TERMINAL = { cols: 80, rows: 24 };
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A host with a viewer and an editor token, in the remote mode when `remote` is given. */
async function host(remote: RemoteSetup | null = null): Promise<{ host: Host; sdk: ReturnType<typeof fakeSdk> }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("roles-state");
  made.push(parent, state);
  const sdk = fakeSdk();
  const started = await startHost({
    checkout: repo,
    stateDir: state,
    serverCommand: fakeCommand,
    watch: false,
    remote,
    auth: { kind: "token", tokens: parseRoleTokens(`viewer:${VIEWER},editor:${EDITOR}`) },
    terminal: { program: () => ["/bin/sh", "-c", "cat"] },
    chat: { sdk, env: { PATH: process.env.PATH ?? "/usr/bin" } },
  });
  return { host: started, sdk };
}

function pageOf(started: Host, token: string): Promise<FakePage> {
  return FakePage.open({ origin: started.endpoint.origin, token });
}

describe("the role table", () => {
  test("each role may send what the table says", () => {
    expect(roleCan("viewer", "git.status")).toBe(true);
    expect(roleCan("viewer", "terminal.open", { kind: "claude" })).toBe(false);
    expect(roleCan("viewer", "agent.start", { mode: "default" })).toBe(false);
    expect(roleCan("viewer", "surface.report", { event: { event: "url" } })).toBe(true);
    expect(roleCan("viewer", "surface.report", { event: { event: "placement" } })).toBe(false);
    expect(roleCan("viewer", "checkout.settings")).toBe(true);
    expect(roleCan("viewer", "checkout.settings", { blender: true })).toBe(false);
    expect(roleCan("editor", "terminal.open", { kind: "claude" })).toBe(true);
    expect(roleCan("editor", "terminal.open", { kind: "shell" })).toBe(false);
    expect(roleCan("editor", "agent.setMode", { mode: "bypassPermissions" })).toBe(false);
    expect(roleCan("editor", "loops.start")).toBe(false);
    expect(roleCan("editor", "git.commit")).toBe(true);
    expect(roleCan("editor", "host.restart")).toBe(false);
    expect(roleCan("admin", "terminal.open", { kind: "shell" })).toBe(true);
    expect(requestRefusal("viewer", "runs.start")).toContain("The role viewer cannot");
  });

  test("the role tokens of the environment", () => {
    expect(authFromEnv({})).toEqual({ kind: "none" });
    expect(authFromEnv({ [ROLES_ENV]: `viewer:${VIEWER}, editor:${EDITOR}` })).toEqual({
      kind: "token",
      tokens: [
        { role: "viewer", token: VIEWER },
        { role: "editor", token: EDITOR },
      ],
    });
    expect(() => parseRoleTokens("owner:abc")).toThrow(ROLES_ENV);
    expect(() => parseRoleTokens(`viewer:${VIEWER.toUpperCase()}`)).toThrow(ROLES_ENV);
  });

  test("the providers: the launch token is admin; none knows no other token", async () => {
    const request = new Request("http://127.0.0.1/");
    const none = makeProvider(undefined, EDITOR);
    expect(await none.caller(EDITOR, request)).toEqual({ role: "admin", user: null });
    expect(await none.caller(VIEWER, request)).toBeNull();
    const oidc = makeProvider(
      {
        kind: "oidc",
        verify: (credential) => Promise.resolve(credential === "id" ? { role: "viewer", user: "a" } : null),
      },
      EDITOR,
    );
    expect(oidc.kind).toBe("oidc");
    expect(await oidc.caller("id", request)).toEqual({ role: "viewer", user: "a" });
    expect(await oidc.caller(null, request)).toBeNull();
  });
});

describe("the host refuses the calls above the role", () => {
  test("a viewer token cannot open a terminal, start an agent, run a run or use a Git write", async () => {
    const { host: started, sdk } = await host();
    const page = await pageOf(started, VIEWER);
    try {
      expect(await page.call("host.hello")).toMatchObject({ role: "viewer", auth: "token" });
      for (const kind of ["claude", "shell"]) {
        const answer = await page.request("terminal.open", { kind, ...TERMINAL });
        expect(answer).toMatchObject({ ok: false });
        expect(answer.ok ? "" : answer.error).toContain("The role viewer cannot");
      }
      expect(started.terminals.ids()).toEqual([]);
      expect(await page.request("agent.start", { mode: "default" })).toMatchObject({ ok: false });
      expect(sdk.queries).toHaveLength(0);
      expect(await page.request("runs.start", { command: "motion", args: [] })).toMatchObject({ ok: false });
      expect(await page.request("git.commit", { message: "x", paths: ["README.md"] })).toMatchObject({ ok: false });
      expect(await page.request("tunes.apply", { dry: true })).toMatchObject({ ok: false });
      expect(await page.request("host.restart")).toMatchObject({ ok: false });
      const placement = { workbench: 1, event: "placement", values: "a:1", dry: true };
      const report = await page.request("surface.report", { surface: "lab", where: "visible", event: placement });
      expect(report).toMatchObject({ ok: false });
      // The reads stay open.
      expect(await page.call("git.status")).toMatchObject({ files: [] });
      expect(await page.call("runs.list")).toEqual([]);
    } finally {
      page.close();
      await started.stop();
    }
  });

  test("an editor opens the Claude terminal and a chat, not a shell, the mode all or a background run", async () => {
    const { host: started, sdk } = await host();
    const page = await pageOf(started, EDITOR);
    try {
      const claude = (await page.call("terminal.open", { kind: "claude", ...TERMINAL })) as TerminalOpened;
      expect(claude.kind).toBe("claude");
      expect(await page.request("terminal.open", { kind: "shell", ...TERMINAL })).toMatchObject({ ok: false });
      expect(await page.request("agent.start", { mode: "bypassPermissions" })).toMatchObject({ ok: false });
      const { session } = (await page.call("agent.start", { mode: "default", maxBudgetUsd: 1 })) as { session: string };
      expect(sdk.queries).toHaveLength(1);
      expect(await page.request("agent.setMode", { session, mode: "bypassPermissions" })).toMatchObject({ ok: false });
      const loop = { prompt: "x", budgetUsd: 1, maxTurns: 1, minutes: 1 };
      expect(await page.request("loops.start", loop)).toMatchObject({ ok: false });
    } finally {
      page.close();
      await started.stop();
    }
  });

  test("the launch token is admin: a shell terminal in the local mode", async () => {
    const { host: started } = await host();
    const page = await FakePage.open(started.endpoint);
    try {
      expect(await page.call("host.hello")).toMatchObject({ role: "admin" });
      const shell = (await page.call("terminal.open", { kind: "shell", ...TERMINAL })) as TerminalOpened;
      expect(shell.kind).toBe("shell");
    } finally {
      page.close();
      await started.stop();
    }
  });

  test("the remote mode still refuses a shell for the admin, and the frame URL has a lab ticket", async () => {
    const remote = { publicOrigin: "https://scenity.example.org", labPort: await freePort(), labBase: "/s/abc123/" };
    const { host: started } = await host(remote);
    const page = await FakePage.open(started.endpoint);
    try {
      expect(await page.call("host.hello")).toMatchObject({ role: "admin", remote: true });
      expect(await page.request("terminal.open", { kind: "shell", ...TERMINAL })).toMatchObject({ ok: false });
      const ready = await page.waitEvent(
        (event) => event.type === "surface.state" && event.surface.url !== null,
        ciWaitMs(10_000),
      );
      const url = new URL((ready as HostEvent<"surface.state">).surface.url ?? "");
      expect(url.origin + url.pathname).toBe("https://scenity.example.org/s/abc123/");
      expect(checkLabTicket(started.endpoint.token, url.searchParams.get("labTicket"))).not.toBeNull();
      // A frame report of a URL with the ticket: the host keeps it without the ticket (withoutLabKey).
      const reported = `${url.origin}${url.pathname}?take=greet&labTicket=${url.searchParams.get("labTicket") ?? ""}`;
      expect(withoutLabKey(reported)).toBe(`${url.origin}${url.pathname}?take=greet`);
    } finally {
      page.close();
      await started.stop();
    }
  });

  test("a token that the provider does not know gets no WebSocket", async () => {
    const { host: started } = await host();
    try {
      const opened = await pageOf(started, "3c".repeat(32)).then(
        (page) => {
          page.close();
          return true;
        },
        () => false,
      );
      expect(opened).toBe(false);
    } finally {
      await started.stop();
    }
  });
});

describe("the lab ticket", () => {
  test("a ticket is valid for 12 to 13 hours, for its host token only", () => {
    const token = "4d".repeat(32);
    const now = Date.UTC(2026, 9, 15, 10, 20);
    const ticket = makeLabTicket(token, now);
    expect(makeLabTicket(token, now + 60_000)).toBe(ticket);
    expect(checkLabTicket(token, ticket, now)).not.toBeNull();
    expect(checkLabTicket(token, ticket, now + 12 * 3_600_000)).not.toBeNull();
    expect(checkLabTicket(token, ticket, now + 14 * 3_600_000)).toBeNull();
    expect(checkLabTicket("5e".repeat(32), ticket, now)).toBeNull();
    expect(checkLabTicket(token, `${ticket.slice(0, -1)}A`, now)).toBeNull();
    expect(labGateKey(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(labGateKey(token)).not.toBe(token);
  });
});
