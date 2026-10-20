// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the `Stop` gate. When it is off, it lets Claude stop. When it is on, it refuses "done" while the gate check
 * fails, at most a few times in a row, and it tells the page. The check of a session is the fast check of the host
 * plugin of the lab (the take at its moments), else the gate run of the project.
 */
import { describe, expect, test } from "bun:test";
import type { HostEvent } from "../src/protocol";
import { builtInPlugins } from "../src/plugins";
import { projectRun } from "../src/runCatalog";
import type { RunResult } from "../src/runs";
import { sessionGateCheck, StopGate, type GateCheck, type GateRuns } from "../src/stopGate";
import type { SurfacePort } from "../src/tools/context";
import { CHECK_REPORT, fakeLab, labAnswers } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const FAIL: GateCheck = {
  sequence: "greet",
  pass: false,
  summary: "  FAIL hands.toTarget (bo) 0.19 vs max 0.16",
};
const PASS: GateCheck = { sequence: "greet", pass: true, summary: "Checks: 9 pass." };

function gate(results: GateCheck[], maxRefusals = 2) {
  const events: HostEvent[] = [];
  let index = 0;
  const value = new StopGate({
    check: () => Promise.resolve(results[Math.min(index++, results.length - 1)] ?? PASS),
    emit: (event) => events.push(event),
    maxRefusals,
    now: () => new Date("2026-10-12T15:04:00.000Z"),
  });
  return { gate: value, events, checks: () => index };
}

describe("the Stop gate", () => {
  test("off: Claude stops without a check", async () => {
    const { gate: g, checks } = gate([FAIL]);
    expect(await g.onStop("s1")).toEqual({});
    expect(checks()).toBe(0);
  });

  test("on: a failing take refuses done with the failures, then lets go after the most refusals", async () => {
    const { gate: g, events } = gate([FAIL]);
    expect(g.set(true).on).toBe(true);
    const first = await g.onStop("s1");
    expect(first.decision).toBe("block");
    expect(String(first.reason)).toContain("hands.toTarget");
    expect(events.some((event) => event.type === "agent.notify")).toBe(true);
    expect((await g.onStop("s1")).decision).toBe("block");
    expect(await g.onStop("s1")).toEqual({});
    expect(g.state().last).toMatchObject({ pass: false, refused: false });
    expect(events.filter((event) => event.type === "agent.stopGate").length).toBeGreaterThan(2);
  });

  test("on: a passing take lets Claude stop", async () => {
    const { gate: g } = gate([PASS]);
    g.set(true);
    expect(await g.onStop("s1")).toEqual({});
    expect(g.state()).toMatchObject({
      on: true,
      sequence: "greet",
      take: "greet",
      last: { pass: true, refused: false },
    });
  });

  test("a check that fails to run lets Claude stop and shows why", async () => {
    const g = new StopGate({ check: () => Promise.reject(new Error("no page")), emit: () => undefined });
    g.set(true);
    expect(await g.onStop(null)).toEqual({});
    expect(g.state().last?.summary).toContain("no page");
  });
});

/** The fast check of the host plugin of the lab through the gate of a session. */
function checkTakeAtMoments(port: SurfacePort, url: string | null): Promise<GateCheck> {
  return sessionGateCheck({ plugins: builtInPlugins(), gate: null, runs: null, checkout: "/repo", port, url });
}

describe("the check at the moments (the host plugin of the lab)", () => {
  test("asks the moments of the take and checks at those times", async () => {
    const lab = fakeLab({ ...labAnswers(), moments: { start: 0, bow: 13000, wave: 6350 } });
    const result = await checkTakeAtMoments(lab.port, "http://127.0.0.1:1/?take=greet&t=0");
    expect(lab.calls.map((item) => item.call)).toEqual(["moments", "check"]);
    expect(lab.calls[0]?.args).toEqual(["greet"]);
    expect(lab.calls[1]?.args).toEqual([[0, 13000, 6350]]);
    expect(result.pass).toBe(CHECK_REPORT.failures.length === 0);
    expect(result.summary).toContain("hands.toTarget");
  });

  test("a source without checks passes", async () => {
    const lab = fakeLab({ moments: {}, check: { applies: false, summary: "a view track has no checks" } });
    expect((await checkTakeAtMoments(lab.port, null)).pass).toBe(true);
  });
});

describe("the gate run of a session", () => {
  /** Fake runs that give one status and record each start. */
  function fakeRuns(status: RunResult["status"]): GateRuns & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      running: () => null,
      startRun(checkout, command, args) {
        calls.push([checkout, command, args]);
        return Promise.resolve({
          status,
          summary: status === "passed" ? "passed: 5 rules" : "FAIL lantern",
        } as RunResult);
      },
    };
  }
  const lab = fakeLab({});
  const gateRun = projectRun("check", "scenity check");

  test("with no plugin check, the gate run of the project checks the sequence of the URL", async () => {
    const runs = fakeRuns("failed");
    const url = "http://127.0.0.1:1/scene.html?sequence=sequences/tour.sequence.json";
    const result = await sessionGateCheck({ plugins: [], gate: gateRun, runs, checkout: "/p", port: lab.port, url });
    expect(runs.calls).toEqual([["/p", "check", ["--sequence", "sequences/tour.sequence.json"]]]);
    expect(result).toMatchObject({
      pass: false,
      summary: "FAIL lantern",
      title: "scenity check --sequence sequences/tour.sequence.json",
    });
  });

  test("no gate passes; a gate that needs a sequence passes when none is open", async () => {
    const runs = fakeRuns("failed");
    const none = await sessionGateCheck({ plugins: [], gate: null, runs, checkout: "/p", port: lab.port, url: null });
    expect(none.pass).toBe(true);
    const needs = projectRun("motion", { command: "bun run x motion", sequence: { flag: "", required: true } });
    const open = await sessionGateCheck({ plugins: [], gate: needs, runs, checkout: "/p", port: lab.port, url: null });
    expect(open.pass).toBe(true);
    expect(runs.calls).toEqual([]);
  });
});
