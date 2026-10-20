// SPDX-License-Identifier: Apache-2.0
/**
 * A fake lab surface for the tests of the tools, the packet and the hooks. It answers the calls of the surface bridge
 * with scripted values, as a scene page at 6350 ms with an open clip item does. The data names no plugin domain. The
 * tests of a host plugin have their own answers.
 */
import { join } from "node:path";
import { makeToolContext, type ServerInfo, type SurfacePort, type ToolContext } from "../src/tools/context";

/** The root of this checkout (the tools read the catalog and the assets from it). */
export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

export const LAB_URL =
  "http://127.0.0.1:52140/?take=greet&t=6350&paused=1&camera=side&item=clip_wave_hello&tune=wave.hand.y:-0.004&workbench=http://127.0.0.1:5199";

/** A member of the inspect report. */
export function member(id: string, family: string, clip: string | null, binding: string | null = null): unknown {
  return {
    id,
    role: null,
    family,
    activity: family,
    binding,
    phase: "perform",
    phaseStartMs: 0,
    at: [0.41, -0.6],
    yaw: 1.57,
    visible: true,
    clip,
    hands: [
      { kind: "target", target: [0, 1, 0], wrist: [0, 1.012, 0] },
      { kind: "rest", target: null, wrist: [0, 0.8, 0] },
    ],
    joints: { head: [0.4, 1.6, -0.6] },
  };
}

/** An entity of the inspect report (the generic rows of the packet, contextRows.ts). */
export function entity(id: string, components: readonly string[] = ["model"]): unknown {
  return { id, visible: true, components };
}

export const INSPECT = {
  simMs: 6350,
  members: [
    member("ada", "wave", "clip_wave_hello", "wave"),
    member("bo", "bow", "clip_bow_low", "bow_low"),
    member("cy", "idle", null),
  ],
  entities: [entity("lantern", ["model", "light", "socket"]), entity("table", ["model", "obstacle"])],
};

export const CHECK_REPORT = {
  applies: true,
  source: "take",
  take: "greet",
  times: [6350],
  panelEvents: 0,
  failures: [
    {
      check: "hands.toTarget (bo)",
      metric: "hands.toTarget",
      member: "bo",
      value: 0.19,
      limit: "max 0.16",
      at: 6350,
    },
  ],
  known: [],
  worst: [
    { check: "ik.reachError", limit: "max 0.03", value: 0.012, member: "bo", at: 6350, pass: true },
    {
      check: "hands.toTarget (bo)",
      limit: "max 0.16",
      value: 0.19,
      member: "bo",
      at: 6350,
      pass: false,
    },
  ],
  summary: "take greet (1 samples): 8 pass, 1 fail, 0 known",
};

/** The scripted answers of the fake lab: a value, or a function of the arguments. */
export type Answers = Record<string, unknown>;

export function labAnswers(): Answers {
  return {
    url: LAB_URL,
    time: 6350,
    quality: { tier: "high", scale: 1, still: false },
    item: {
      key: "clip_wave_hello",
      title: "one wave",
      scene: {
        take: "greet",
        events: [],
        window: { from: 5000, to: 9000 },
        moment: 6350,
        camera: "side",
        cast: "bo",
        exact: true,
        assets: true,
      },
    },
    state: {
      members: [{ id: "bo", role: "greeter", home: "door", binding: "bow_low", phase: "perform", look: {} }],
    },
    inspect: INSPECT,
    check: CHECK_REPORT,
    tunes: { "wave.hand.y": -0.004 },
    tunables: [
      { path: "wave.hand.y", value: -0.004, default: 0, step: 0.001 },
      { path: "pose.lean.max", value: 0.3, default: 0.3, step: 0.01 },
    ],
    console: { errors: ["TypeError: the lamp is undefined"], warnings: ["slow frame"] },
    measure: [
      { metric: "ik.reachError", value: 0.0123, unit: "m", member: "bo" },
      { metric: "members.overlap", value: 0, unit: "m", member: null },
    ],
    capture: { simMs: 6350, width: 1280, height: 720, mime: "image/webp", data: "UklGRiQAAABXRUJQ" },
    frame: { simMs: 6350, stats: null },
    open: true,
    browse: [
      { key: "bo", title: "Jo", kind: "member", scene: true },
      { key: "clip_wave_off", title: "stop the wave", kind: "clip", scene: false },
    ],
  };
}

/** One call that the fake lab got. */
export interface FakeCall {
  readonly call: string;
  readonly args: readonly unknown[];
}

/** A fake lab port: it records each call and answers from the script. A call without an answer gives undefined. */
export function fakeLab(answers: Answers = labAnswers()): { port: SurfacePort; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const port: SurfacePort = {
    call(call, args = []) {
      calls.push({ call, args });
      if (!Object.hasOwn(answers, call)) return Promise.resolve(undefined);
      const answer = answers[call];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(
        typeof answer === "function" ? (answer as (a: readonly unknown[]) => unknown)(args) : answer,
      );
    },
  };
  return { port, calls };
}

export const SERVER: ServerInfo = {
  server: { status: "ready", port: 52140, error: null },
  lastEdit: {
    file: join(REPO_ROOT, "src/model/families/wave.ts"),
    at: "2026-10-12T15:03:46.000Z",
    reloaded: false,
  },
};

/** A tool context round a fake lab, with a fixed time, Git state and dev server. */
export function fakeContext(port: SurfacePort, changed: readonly string[] = ["a.ts", "b.ts", "c.ts"]): ToolContext {
  return makeToolContext({
    surface: () => port,
    // The manifest ID of the scene surface of the built-in project.
    scene: "lab",
    checkout: REPO_ROOT,
    git: () => Promise.resolve({ branch: "lc/room3d-sdk", changed }),
    now: () => new Date("2026-10-12T15:04:00.000Z"),
    server: () => SERVER,
  });
}
