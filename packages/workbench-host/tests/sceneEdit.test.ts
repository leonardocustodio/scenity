// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of point and ask and of "Save placement" in the host: the bridge events `ask` and `placement`, the picked
 * block of the context packet, `lab_pick` and `lab_marks`. The tests of the file map of a picked item and of the
 * placement paths of a room are in the tests of the host plugin that gives them (its tests/paths.test.ts). The
 * placement here uses the paths of a fake plugin.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { buildPacket } from "../src/context";
import { isBridgeEvent } from "../src/protocol";
import type { RunResult } from "../src/runs";
import { surfaceEvents, type PacketState } from "../src/agentLoop";
import type { HostPlugin } from "../src/plugin";
import { useHostPlugins } from "../src/plugins";
import { planRun } from "../src/runArgs";
import {
  askLine,
  cameraSaveArgs,
  placementPairs,
  runCameraSave,
  runPlacement,
  sceneEditEvents,
  selectionMoved,
  sendAsk,
  type SceneEditDeps,
} from "../src/sceneEdit";
import { handleToolRequest } from "../src/tools/index";
import { marksResult } from "../src/tools/pick";
import { pickedBlock } from "../src/tools/picked";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, fakeLab, labAnswers, REPO_ROOT } from "./fakeLab";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

/** The picked item of the lab API (`picked`) for the lantern. */
const PICKED = {
  kind: "prop",
  id: "lantern",
  slot: "lantern",
  asset: { id: "prop_lantern", file: "props/prop_lantern.high.glb" },
  place: { x: -0.75, y: 0, z: -1.49, yawDeg: 17.19 },
  tunes: [{ path: "room.props.lantern.at.0", value: -0.75, tuned: true }],
  bone: null,
  point: [-0.8, 1.15, -1.4],
  near: [{ name: "lantern_hook", cm: 3.2 }],
  warnings: ["The prop enters the table."],
};

/** A fake plugin with the placement paths of a room: the prop places, the cable bends, a hand and the light. */
const ROOM_PLUGIN: HostPlugin = {
  id: "demo",
  tools: [],
  contextLines: {},
  runs: { commands: {} },
  paths: {
    placement: [
      /^room\.props\.[a-z_]+\.(at\.[012]|yaw)$/i,
      /^routes\.[a-z0-9_]+\.\d+\.[012]$/i,
      /^pose\.waveHand\.at\.[012]$/,
      /^light\.(key|fill|sky)\.[a-z]+(\.[012])?$/,
    ],
  },
};

afterEach(() => useHostPlugins(null));

function deps(
  overrides: Partial<SceneEditDeps> = {},
): SceneEditDeps & { inputs: [string, string][]; prompts: string[] } {
  const inputs: [string, string][] = [];
  const prompts: string[] = [];
  return {
    inputs,
    prompts,
    terminals: {
      claudeTerminals: () => [
        { id: "claude-old", checkout: REPO_ROOT, startedMs: 1, live: true },
        { id: "claude-new", checkout: REPO_ROOT, startedMs: 2, live: true },
        { id: "claude-other", checkout: "/elsewhere", startedMs: 3, live: true },
      ],
      input: (id, data) => inputs.push([id, data]),
    },
    chat: { live: () => [], get: () => ({ prompt: (text) => prompts.push(text) }) },
    runs: { start: () => ({ run: "r1", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) }) },
    current: () => REPO_ROOT,
    lab: () => fakeLab().port,
    delay: () => Promise.resolve(),
    ...overrides,
  };
}

describe("the bridge events of the scene edit", () => {
  test("are bridge events with their fields", () => {
    expect(isBridgeEvent({ workbench: 1, event: "ask", text: "move this closer to the table" })).toBe(true);
    expect(isBridgeEvent({ workbench: 1, event: "ask", text: "  " })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "ask", text: "x".repeat(5000) })).toBe(false);
    expect(isBridgeEvent({ workbench: 1, event: "placement", values: "room.props.lamp.yaw:0.1", dry: true })).toBe(
      true,
    );
    expect(isBridgeEvent({ workbench: 1, event: "placement", values: "x" })).toBe(false);
    // The reason of a layout override.
    const over = { workbench: 1, event: "placement", values: "room.props.lamp.yaw:0.1", dry: true };
    expect(isBridgeEvent({ ...over, override: "the table moves next" })).toBe(true);
    expect(isBridgeEvent({ ...over, override: 3 })).toBe(false);
    expect(isBridgeEvent({ ...over, override: "x".repeat(5000) })).toBe(false);
    // "Save camera".
    const camera = {
      workbench: 1,
      event: "camera",
      name: "bay-foot",
      view: "1.20,1.60,-0.90,0,0.85,-0.45,45",
      dry: true,
    };
    expect(isBridgeEvent(camera)).toBe(true);
    expect(isBridgeEvent({ ...camera, replace: true, doc: "The table from the door, low." })).toBe(true);
    expect(isBridgeEvent({ ...camera, name: "Bay" })).toBe(false);
    expect(isBridgeEvent({ ...camera, name: "x".repeat(33) })).toBe(false);
    expect(isBridgeEvent({ ...camera, view: "1,2,3" })).toBe(false);
    expect(isBridgeEvent({ ...camera, doc: "a; rm" })).toBe(false);
    expect(isBridgeEvent({ ...camera, doc: "a */ b" })).toBe(false);
    expect(isBridgeEvent({ ...camera, dry: "yes" })).toBe(false);
  });

  test("an ask goes to the newest Claude terminal of the checkout, as one line, then Enter", async () => {
    const parts = deps();
    expect(await sendAsk(parts, "move this\ncloser to the table")).toBe("terminal");
    expect(parts.inputs).toEqual([
      ["claude-new", "move this closer to the table"],
      ["claude-new", "\r"],
    ]);
    expect(askLine("  a \r\n\n b ")).toBe("a b");
  });

  test("an ask goes to the chat without a terminal, and nowhere without a session", async () => {
    const chat = deps({
      terminals: { claudeTerminals: () => [], input: () => undefined },
      chat: {
        live: () => [{ info: { session: "chat-1", checkout: REPO_ROOT } }],
        get: () => ({ prompt: (text) => chatPrompts.push(text) }),
      },
    });
    const chatPrompts: string[] = [];
    expect(await sendAsk(chat, "why does this hand miss the hat")).toBe("chat");
    expect(chatPrompts).toEqual(["why does this hand miss the hat"]);
    const none = deps({ terminals: { claudeTerminals: () => [], input: () => undefined } });
    expect(await sendAsk(none, "anything")).toBeNull();
  });

  test("a placement runs tune-apply with the place values only, and gives its output", async () => {
    useHostPlugins([ROOM_PLUGIN]);
    expect(placementPairs("room.props.lamp.at.0:1.2, pose.waveHand.fingers.0:0.09,room.props.lamp.yaw:-0.2")).toBe(
      "room.props.lamp.at.0:1.2,room.props.lamp.yaw:-0.2",
    );
    // The cable bends, the hand targets and the light go with a placement. A bad value does not.
    expect(
      placementPairs(
        "routes.cord.2.1:0.05,pose.waveHand.at.0:0.03,pose.waveHand.side:0.09," +
          "light.key.intensity:2.4,light.key.colour.0:200,light.key.at.1:3.5,room.props.lamp.yaw:x",
      ),
    ).toBe(
      "routes.cord.2.1:0.05,pose.waveHand.at.0:0.03,light.key.intensity:2.4,light.key.colour.0:200,light.key.at.1:3.5",
    );
    useHostPlugins([]);
    expect(placementPairs("room.props.lamp.at.0:1.2")).toBe("");
    useHostPlugins([ROOM_PLUGIN]);
    const started: unknown[] = [];
    const parts = deps({
      runs: {
        start: (_checkout, command, args, options) => {
          started.push([command, args]);
          options?.onOutput?.("stdout", "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2\n");
          return { run: "r2", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) };
        },
      },
    });
    const result = await runPlacement(parts, "room.props.lamp.at.0:1.2", true);
    expect(started).toEqual([["tune-apply", ["room.props.lamp.at.0:1.2", "--dry"]]]);
    expect(result).toEqual({
      run: "r2",
      dry: true,
      status: "passed",
      output: "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2",
    });
    expect((await runPlacement(parts, "pose.x:1", false)).status).toBe("failed");
  });

  test("a placement with a layout override gives the reason first in its output", async () => {
    useHostPlugins([ROOM_PLUGIN]);
    const parts = deps({
      runs: {
        start: (_checkout, _command, _args, options) => {
          options?.onOutput?.("stdout", "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2\n");
          return { run: "r3", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) };
        },
      },
    });
    const result = await runPlacement(parts, "room.props.lamp.at.0:1.2", true, "  the table\nmoves next ");
    expect(result).toEqual({
      run: "r3",
      dry: true,
      status: "passed",
      override: "the table\nmoves next",
      output: [
        "Layout checks overridden: the table moves next (the commit message proposal has this reason).",
        "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2",
      ].join("\n"),
    });
    expect(await runPlacement(parts, "room.props.lamp.at.0:1.2", true, "  ")).not.toHaveProperty("override");
  });

  test("a camera save runs labs camera-save with the view as one argument, and gives its output", async () => {
    const started: unknown[] = [];
    const parts = deps({
      runs: {
        start: (_checkout, command, args, options) => {
          started.push([command, args]);
          options?.onOutput?.(
            "stdout",
            'plugins/demo/editor/src/cameras.ts:55  + bay: { … }\ndry run: camera "bay" added\n',
          );
          return { run: "r4", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) };
        },
      },
    });
    const event = {
      workbench: 1,
      event: "camera",
      name: "bay",
      view: "-1.20,1.60,0.90,0,0.85,-0.45,45",
      dry: true,
    } as const;
    const result = await runCameraSave(parts, event);
    expect(started).toEqual([["camera-save", ["bay", "--view=-1.20,1.60,0.90,0,0.85,-0.45,45", "--dry"]]]);
    expect(result).toEqual({
      run: "r4",
      dry: true,
      status: "passed",
      output: 'plugins/demo/editor/src/cameras.ts:55  + bay: { … }\ndry run: camera "bay" added',
    });
    const real = cameraSaveArgs({ ...event, dry: false, replace: true, doc: "The table from the door, low." });
    expect(real).toEqual([
      "bay",
      "--view=-1.20,1.60,0.90,0,0.85,-0.45,45",
      "--doc=The table from the door, low.",
      "--replace",
    ]);
    // The run plan of the host takes the arguments, renders nothing and starts `bun run labs camera-save`.
    const plan = planRun(REPO_ROOT, "camera-save", real, { runId: "t1", bun: "bun" });
    expect(plan.argv).toEqual(["bun", "run", "labs", "camera-save", ...real]);
    expect(plan.gpu).toBe(false);
  });

  test("the handler answers a camera save through the bridge of the lab", async () => {
    const lab = fakeLab({ cameraResult: null });
    const handle = sceneEditEvents(deps({ lab: () => lab.port }));
    handle("lab", "visible", { workbench: 1, event: "camera", name: "bay", view: "1,2,3,0,0.8,0,45", dry: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lab.calls).toEqual([
      { call: "cameraResult", args: [{ run: "r1", dry: true, status: "passed", output: "" }] },
    ]);
  });

  test("the handler answers the lab frame through its bridge", async () => {
    const lab = fakeLab({ askResult: null, placementResult: null });
    const handle = sceneEditEvents(deps({ lab: () => lab.port }));
    handle("lab", "visible", { workbench: 1, event: "ask", text: "hello" });
    handle("lab", "shadow", { workbench: 1, event: "ask", text: "not from the shadow" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lab.calls).toEqual([{ call: "askResult", args: [{ to: "terminal" }] }]);
  });
});

describe("the packet after a pick", () => {
  test("a new selection builds the packet again, also in the quiet time after a build", () => {
    const LAB = "http://127.0.0.1:5400/?take=greet&t=6000&paused=1";
    let refreshes = 0;
    const state: PacketState = { building: true, quietUntil: Date.now() + 60_000, url: LAB, seen: LAB };
    const on = surfaceEvents({ onEvent: () => undefined }, { refresh: () => (refreshes += 1) }, state, () => "lab");
    // A clock move of the packet's own check: no build.
    on("lab", "visible", { workbench: 1, event: "url", url: LAB.replace("t=6000", "t=6100") });
    expect(refreshes).toBe(0);
    on("lab", "visible", { workbench: 1, event: "url", url: `${LAB}&sel=prop%3Alantern` });
    expect(refreshes).toBe(1);
    expect(selectionMoved(`${LAB}&sel=prop%3Alantern`, `${LAB}&sel=prop%3Alantern`)).toBe(false);
    expect(selectionMoved(`${LAB}&sel=prop%3Alantern`, LAB)).toBe(true);
    expect(selectionMoved(null, LAB)).toBe(false);
  });
});

describe("the picked block", () => {
  test("a lab without a selection gives no block", async () => {
    const packet = await buildPacket(fakeContext(fakeLab({ ...labAnswers(), picked: null }).port));
    expect(packet.text).not.toContain("Picked:");
    expect(pickedBlock(REPO_ROOT, null)).toEqual([]);
  });

  test("lab_pick reads the selection, or picks a point", async () => {
    const lab = fakeLab({
      picked: PICKED,
      pick: {
        kind: "member",
        id: "ada",
        object: "hand_r",
        bone: "hand_r",
        point: [0.3, 1.1, 0.5],
        distance: 2.4,
        near: [],
      },
    });
    const ctx = fakeContext(lab.port);
    const selected = await handleToolRequest("lab_pick", {}, ctx);
    expect(JSON.stringify(selected.content)).toContain("Picked: prop lantern");
    const point = await handleToolRequest("lab_pick", { x: 400, y: 300 }, ctx);
    expect(JSON.stringify(point.content)).toContain("Picked: member ada, bone hand_r");
    expect(lab.calls.at(-1)).toEqual({ call: "pick", args: [400, 300, 0] });
  });

  test("lab_marks keeps the picture by ID and gives the mask and the words", () => {
    const stored: [Uint8Array, string][] = [];
    const ctx = {
      pictures: { put: (bytes: Uint8Array, mime: string) => (stored.push([bytes, mime]), "ab".repeat(16)) },
    };
    const result = marksResult(ctx, {
      simMs: 9000,
      width: 1280,
      height: 800,
      mime: "image/webp",
      bytes: new Uint8Array([82, 73, 70, 70]),
      mask: [{ kind: "circle", x: 640, y: 400, r: 30 }],
      description: "Mark 1: a circle round 50 % across, 50 % down: prop lantern.",
    });
    expect(stored).toHaveLength(1);
    const words = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(words).toContain(`Marks picture ${"ab".repeat(16)}`);
    expect(words).toContain("1: circle at 640, 400 r 30");
    expect(words).toContain("prop lantern");
    expect(result.content[1]?.type).toBe("image");
    expect(JSON.stringify(marksResult(ctx, null).content)).toContain("no marks");
  });
});
