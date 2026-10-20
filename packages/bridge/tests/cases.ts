// SPDX-License-Identifier: Apache-2.0
/**
 * The shared case table of the bridge contract. The same cases run on both sides:
 *
 * - the frame side: the editor bridge (apps/editor tests/unit/bridge-contract.vitest.ts);
 * - the caller side: the workbench page relay (apps/workbench tests/unit/bridge-contract.vitest.ts) and the typed
 *   calls of the workbench host (packages/workbench-host tests/bridgeContract.test.ts);
 * - the contract alone (tests/bridge.test.ts).
 *
 * The editor face of a plugin gives the cases of its typed calls in the same form: `PLUGIN_CALL_CASES` of
 * plugins/<plugin>/editor/tests/bridgeCases.ts. The editor test finds each of them.
 */
import { CAPTURE_CALL, CONSOLE_CALL, URL_CALL } from "../src/base";
import { SCENE_CREATE, SCENE_READ, SCENE_SAVE } from "../src/sceneFiles";
import type { BridgeCallDef } from "../src/define";
import type { BridgeEventBody } from "../src/events";

/** One case of a typed call: the arguments, and the arguments on the wire after the check or the error. */
export interface CallCase {
  readonly name: string;
  readonly def: BridgeCallDef;
  readonly args: readonly unknown[];
  /** The arguments after the check (a valid case). */
  readonly wire?: readonly unknown[];
  /** The error text of the check (an invalid case). */
  readonly error?: string;
}

/** The cases of the base calls. */
export const BASE_CALL_CASES: readonly CallCase[] = [
  { name: "url without arguments", def: URL_CALL, args: [], wire: [] },
  { name: "console without arguments", def: CONSOLE_CALL, args: [], wire: [] },
  { name: "capture with the defaults", def: CAPTURE_CALL, args: [], wire: [1280, null, 0, null] },
  { name: "capture with a width", def: CAPTURE_CALL, args: [640], wire: [640, null, 0, null] },
  {
    name: "capture with a width, a quality, a height and a pane",
    def: CAPTURE_CALL,
    args: [800, 0.5, 500, { pane: 1 }],
    wire: [800, 0.5, 500, { pane: 1 }],
  },
  {
    name: "capture with null in place of defaults",
    def: CAPTURE_CALL,
    args: [null, null, 400],
    wire: [1280, null, 400, null],
  },
  {
    name: "capture with a width of 0",
    def: CAPTURE_CALL,
    args: [0],
    error: "capture: the width must be an integer from 1 to 4096.",
  },
  {
    name: "capture with a width that is too large",
    def: CAPTURE_CALL,
    args: [5000],
    error: "capture: the width must be an integer from 1 to 4096.",
  },
  {
    name: "capture with a negative height",
    def: CAPTURE_CALL,
    args: [640, null, -1],
    error: "capture: the height must be an integer from 1 to 4096.",
  },
  {
    name: "capture with a quality over 1",
    def: CAPTURE_CALL,
    args: [640, 2],
    error: "capture: the quality must be a number from 0 to 1.",
  },
];

const HASH = "a".repeat(64);

/** The cases of the scene file calls. */
export const SCENE_FILE_CALL_CASES: readonly CallCase[] = [
  { name: "read a scene file", def: SCENE_READ, args: ["scenes/main.scene.json"], wire: ["scenes/main.scene.json"] },
  { name: "read without a path", def: SCENE_READ, args: [], error: "scene.read: the path must be a text." },
  {
    name: "save a scene file",
    def: SCENE_SAVE,
    args: [{ path: "scenes/main.scene.json", text: "{}", baseHash: HASH }],
    wire: [{ path: "scenes/main.scene.json", text: "{}", baseHash: HASH }],
  },
  {
    name: "save a new file with force",
    def: SCENE_SAVE,
    args: [{ path: "scenes/new.scene.json", text: "{}", baseHash: null, force: true }],
    wire: [{ path: "scenes/new.scene.json", text: "{}", baseHash: null, force: true }],
  },
  {
    name: "save with a bad base hash",
    def: SCENE_SAVE,
    args: [{ path: "scenes/main.scene.json", text: "{}", baseHash: "x" }],
    error: "scene.save: the parameters are not save parameters.",
  },
  {
    name: "create a scene file",
    def: SCENE_CREATE,
    args: [{ path: "scenes/night.scene.json", sceneId: "night", name: "Night" }],
    wire: [{ path: "scenes/night.scene.json", sceneId: "night", name: "Night" }],
  },
  {
    name: "create a sequence file",
    def: SCENE_CREATE,
    args: [{ path: "sequences/night.sequence.json", sceneId: "night", name: "Night" }],
    error: "scene.create: the parameters are not create parameters.",
  },
];

/** One case of an event: the message, and whether the caller side accepts it. */
export interface EventCase {
  readonly name: string;
  readonly message: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
}

/** The body of a valid event case without its envelope key (the frame side emits it). */
export function bodyOf(item: EventCase): BridgeEventBody {
  const body: Record<string, unknown> = { ...item.message };
  delete body.workbench;
  return body as unknown as BridgeEventBody;
}

const IMPORT_ID = "lx2k3m-0a1b2c3d";

/** The cases of the events. */
export const EVENT_CASES: readonly EventCase[] = [
  { name: "ready", message: { workbench: 1, event: "ready", url: "http://lab/?t=1" }, ok: true },
  { name: "url", message: { workbench: 1, event: "url", url: "http://lab/?t=2" }, ok: true },
  { name: "hmr", message: { workbench: 1, event: "hmr", files: ["/src/a.ts", "/src/b.vue"] }, ok: true },
  { name: "reload", message: { workbench: 1, event: "reload", url: "http://lab/?t=3" }, ok: true },
  { name: "console error", message: { workbench: 1, event: "console", level: "error", text: "boom" }, ok: true },
  { name: "console warn", message: { workbench: 1, event: "console", level: "warn", text: "slow" }, ok: true },
  { name: "key", message: { workbench: 1, event: "key", key: "k" }, ok: true },
  { name: "ask", message: { workbench: 1, event: "ask", text: "Why is the cart here?" }, ok: true },
  {
    name: "placement",
    message: { workbench: 1, event: "placement", values: "room.props.cart.yaw:15", dry: true },
    ok: true,
  },
  {
    name: "camera",
    message: { workbench: 1, event: "camera", name: "side-view", view: "1,2,3,0,1,0,40", dry: true, replace: false },
    ok: true,
  },
  {
    name: "layout",
    message: {
      workbench: 1,
      event: "layout",
      name: "wide",
      tunes: "room.props.cart.at.0:1.5",
      dry: true,
      replace: false,
    },
    ok: true,
  },
  {
    name: "variants",
    message: { workbench: 1, event: "variants", seed: 7, variants: [{ id: "v1", label: "cart left", tune: "a.b:1" }] },
    ok: true,
  },
  {
    name: "import without a file",
    message: {
      workbench: 1,
      event: "import",
      drop: "d1",
      file: null,
      name: "box.glb",
      point: null,
      source: "",
      licence: "",
    },
    ok: true,
  },
  { name: "scratch", message: { workbench: 1, event: "scratch", need: [IMPORT_ID] }, ok: true },
  {
    name: "promote",
    message: {
      workbench: 1,
      event: "promote",
      import: IMPORT_ID,
      scratch: "scratch-1",
      at: [1, 0, 2],
      turnDeg: 90,
      dry: true,
    },
    ok: true,
  },
  {
    name: "link",
    message: { workbench: 1, event: "link", channel: "scenity-clock", message: { kind: "hello" } },
    ok: true,
  },
  { name: "detach", message: { workbench: 1, event: "detach", panel: "pane", query: { pane: "1" } }, ok: true },
  { name: "another version", message: { workbench: 2, event: "ready", url: "http://lab/" }, ok: false },
  { name: "an unknown event", message: { workbench: 1, event: "focus", url: "http://lab/" }, ok: false },
  { name: "an event with an id", message: { workbench: 1, id: 2, event: "ready", url: "http://lab/" }, ok: false },
  { name: "url without a URL", message: { workbench: 1, event: "url" }, ok: false },
  { name: "hmr with a number", message: { workbench: 1, event: "hmr", files: [1] }, ok: false },
  {
    name: "console at the info level",
    message: { workbench: 1, event: "console", level: "info", text: "x" },
    ok: false,
  },
  { name: "a key that is not a chord", message: { workbench: 1, event: "key", key: " " }, ok: false },
  { name: "an empty ask", message: { workbench: 1, event: "ask", text: "  " }, ok: false },
  {
    name: "a camera with a bad name",
    message: { workbench: 1, event: "camera", name: "Side View", view: "1,2,3,0,1,0,40", dry: true },
    ok: false,
  },
  { name: "a scratch with a bad import ID", message: { workbench: 1, event: "scratch", need: ["../x"] }, ok: false },
  { name: "a link on a bad channel", message: { workbench: 1, event: "link", channel: "A B", message: {} }, ok: false },
  {
    name: "a detach of an unknown panel",
    message: { workbench: 1, event: "detach", panel: "claude", query: {} },
    ok: false,
  },
];

/** One case of the envelope: a message of the frame, and what the caller reads in it. */
export interface AnswerCase {
  readonly name: string;
  readonly data: unknown;
  /** The outcome of a valid answer, or null for a message that is not an answer. */
  readonly outcome: { readonly result: unknown } | { readonly error: string } | null;
}

/** The cases of the answers (frame to caller). */
export const ANSWER_CASES: readonly AnswerCase[] = [
  { name: "a result", data: { workbench: 1, id: 1, result: { t: 5 } }, outcome: { result: { t: 5 } } },
  { name: "a null result", data: { workbench: 1, id: 1, result: null }, outcome: { result: null } },
  { name: "an error", data: { workbench: 1, id: 1, error: "No take." }, outcome: { error: "No take." } },
  { name: "another version", data: { workbench: 2, id: 1, result: 1 }, outcome: null },
  { name: "no id", data: { workbench: 1, result: 1 }, outcome: null },
  { name: "a negative id", data: { workbench: 1, id: -1, result: 1 }, outcome: null },
  { name: "neither a result nor an error", data: { workbench: 1, id: 1 }, outcome: null },
  { name: "an error that is not a text", data: { workbench: 1, id: 1, error: 3 }, outcome: null },
  { name: "an event", data: { workbench: 1, id: 1, event: "ready", result: 1 }, outcome: null },
  { name: "a text", data: "result", outcome: null },
];

/** One case of a call message (caller to frame): whether the frame answers it, and the call that it reads. */
export interface CallMessageCase {
  readonly name: string;
  readonly data: unknown;
  /** The call and the arguments that the frame reads, or null for a message that gets no answer. */
  readonly read: { readonly call: string; readonly args: readonly unknown[] } | null;
}

/** The cases of the call messages (caller to frame). */
export const CALL_MESSAGE_CASES: readonly CallMessageCase[] = [
  { name: "a call", data: { workbench: 1, id: 1, call: "url", args: [] }, read: { call: "url", args: [] } },
  { name: "a call without args", data: { workbench: 1, id: 2, call: "url" }, read: { call: "url", args: [] } },
  {
    name: "a call with args",
    data: { workbench: 1, id: 3, call: "capture", args: [640] },
    read: { call: "capture", args: [640] },
  },
  { name: "another version", data: { workbench: 2, id: 4, call: "url", args: [] }, read: null },
  { name: "no id", data: { workbench: 1, call: "url", args: [] }, read: null },
  { name: "an empty call", data: { workbench: 1, id: 5, call: "", args: [] }, read: null },
  { name: "no envelope key", data: { id: 6, call: "url", args: [] }, read: null },
  { name: "a text", data: "url", read: null },
];
