// SPDX-License-Identifier: Apache-2.0
/**
 * The protocol of the Scenity workbench: the one source of the message types for the host, the workbench page and
 * the tests.
 *
 * The page and the host send JSON over one WebSocket (`GET /ws?token=<token>`). A request is `{ id, type, ...params }`;
 * the host answers with `{ id, ok: true, result }` or `{ id, ok: false, error }`. An event is `{ type, ...payload }`
 * without an `id`. The surface bridge is a second protocol between the page and a surface frame (`postMessage` data
 * with `workbench: 1`). The host never speaks to a frame directly.
 *
 * The module is pure (no `node:` or `bun:` import), so the page imports it as `@scenity/workbench-host/protocol`.
 */
import { CHANGES_REQUEST_NAMES, type ChangesRequests } from "./changesProtocol";
import type { TerminalOpened, TerminalOpenParams } from "./terminalProtocol";
import { LOOP_EVENT_NAMES, LOOP_REQUEST_NAMES } from "./loopProtocol";
import type { LoopEvents, LoopRequests } from "./loopProtocol";
import { PICTURE_PATH, type PictureRef } from "./pictureProtocol";
import { AGENT_EVENT_NAMES, AGENT_REQUEST_NAMES, type AgentEvents, type AgentRequests } from "./agentProtocol";
import type { BridgeEvent } from "@scenity/bridge";
import type { HelloAccess } from "./projectProtocol";
export * from "./agentProtocol";
export type * from "./terminalProtocol";
export * from "./changesProtocol";
export * from "./loopProtocol";
// The binary picture frames, the picture store references and the bytes of a capture.
export * from "./pictureProtocol";
// The background runs, the picker, the experiment log, the checkout settings and the windows.
import { INFRA_EVENT_NAMES, INFRA_REQUEST_NAMES, type InfraEvents, type InfraRequests } from "./infraProtocol";
import type { CheckoutSetup } from "./infraProtocol";
export * from "./infraProtocol";
// The surface in front and the restart of the host.
import { HOST_EVENT_NAMES, HOST_REQUEST_NAMES, type HostEvents, type HostRequests } from "./hostProtocol";
export * from "./hostProtocol";
// The frame index (`index.plan`, the jobs of the renderers, the progress).
import { INDEX_EVENT_NAMES, INDEX_REQUEST_NAMES, type IndexEvents, type IndexRequests } from "./indexProtocol";
export * from "./indexProtocol";
// The link between the windows and the window layout.
import { WINDOW_EVENT_NAMES, WINDOW_REQUEST_NAMES, type WindowEvents, type WindowRequests } from "./windowProtocol";
export * from "./windowProtocol";
export * from "./desktopProtocol";
// The import by drop (`POST /imports`, its fields and limits).
export * from "./importProtocol";
// The surface bridge between the page and a frame (the one contract of @scenity/bridge).
export * from "@scenity/bridge";
// The scratch props and "Promote to the room" on the bridge. The request `asset.promote`.
import { PROMOTE_REQUEST_NAMES, type PromoteRequests } from "./scratchProtocol";
export * from "./scratchProtocol";
// "Save layout as" and the variants of a layout search on the bridge.
export * from "./layoutProtocol";
// The scene files of the project (read and save, the `scene.saved` event of the Changes tab).
import {
  SCENE_FILE_EVENT_NAMES,
  SCENE_FILE_REQUEST_NAMES,
  type SceneFileEvents,
  type SceneFileRequests,
} from "./sceneFileProtocol";
export * from "./sceneFileProtocol";

/**
 * The version of the protocol. The host gives it in `host.hello`. A change that breaks a client increments it.
 * Version 3: the pictures go as binary frames and the page reads them by ID.
 */
export const PROTOCOL_VERSION = 3;

// The endpoint of the host.
/** The first stdout line of the host starts with this text. */
export const READY_PREFIX = "WORKBENCH_READY ";
/** The environment variable that sets the launch token (the tests, the shell). */
export const TOKEN_ENV = "SCENITY_WORKBENCH_TOKEN";
/** The HTTP header with the launch token. Every path except `/health` and `/ws` needs it. */
export const TOKEN_HEADER = "x-workbench-token";
/**
 * The paths of the host. `/ws` takes the token as the query parameter `token`. `POST /tools/<name>` runs an MCP tool
 * for the stdio MCP server.
 */
export const HOST_PATHS = {
  ws: "/ws",
  health: "/health",
  hooks: "/hooks/",
  context: "/context",
  tools: "/tools/",
  pictures: PICTURE_PATH,
  /** An access token for the updates of Scenity (the shell asks; an auth provider with a token gives it). */
  updateToken: "/desktop/update-token",
} as const;

/** The origin and the launch token of a running host. */
export interface HostEndpoint {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** 64 lowercase hex characters (32 random bytes per start). */
  readonly token: string;
}

const ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
/** True when the text is a valid launch token. */
export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** True when the text is a loopback origin of the host with a port from 1 to 65535. */
export function isHostOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const port = ORIGIN_PATTERN.exec(value)?.[1];
  return port !== undefined && Number(port) >= 1 && Number(port) <= 65535;
}

/** Write the READY line of the host (without the line end). */
export function formatReadyLine(endpoint: HostEndpoint): string {
  return `${READY_PREFIX}${JSON.stringify({ origin: endpoint.origin, token: endpoint.token })}`;
}

/** Read a READY line. Give null for another line or for a line with a bad origin or token. */
export function parseReadyLine(line: string): HostEndpoint | null {
  const text = line.trim();
  if (!text.startsWith(READY_PREFIX)) return null;
  const value = parseJson(text.slice(READY_PREFIX.length));
  if (!isRecord(value)) return null;
  const { origin, token } = value;
  return isHostOrigin(origin) && isToken(token) ? { origin, token } : null;
}

// The shared shapes.
/** The parameters of a request without parameters. */
type NoParams = object;

/** A Git worktree of the repository. */
export interface Checkout {
  /** The absolute path of the worktree. */
  readonly path: string;
  /** The branch, or null for a detached HEAD. */
  readonly branch: string | null;
  readonly head: string;
  /** The count of changed files (`git status`). */
  readonly changed: number;
  /** True when the host has this checkout open (its dev servers run). */
  readonly open: boolean;
  /** The setup of a worktree that the start screen made, while it runs or after it failed. */
  readonly setup?: CheckoutSetup;
}

/**
 * The kind of a surface: a string of the project manifest, for example `scene`. The code never names
 * a surface: it asks for a capability (`hasCapability`, `surfaceWith` of projectProtocol.ts).
 */
export type SurfaceKind = string;
/** The ID of a surface, from the project manifest (unique in the project). */
export type SurfaceId = string;

/** True for a surface ID: a name of 1 to 64 letters, digits, '_', '.' or '-' (the manifest rule). */
export function isSurfaceId(value: unknown): value is SurfaceId {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}
/**
 * The frame of a surface: the one that the owner sees, the hidden frame for measurements, or the frame of the
 * indexer window of the labs app (the built lab, off the screen).
 */
export type SurfaceWhere = "visible" | "shadow" | "indexer";
/** The state of the dev server of a surface. */
export type ServerStatus = "stopped" | "starting" | "ready" | "failed";

/** The state of one surface, with its dev server. */
export interface SurfaceState {
  /** The ID of the surface from the project manifest, unique in the checkout. */
  readonly id: SurfaceId;
  readonly kind: SurfaceKind;
  /** The label of the tab, from the manifest. */
  readonly label: string;
  /** The capabilities of the surface, from the manifest (`SCENE_CAPABILITY`, `INDEX_CAPABILITY`). */
  readonly capabilities: readonly string[];
  readonly checkout: string;
  /** The full URL of the visible frame (the URL state of the lab), or null before the server is ready. */
  readonly url: string | null;
  readonly server: { readonly status: ServerStatus; readonly port: number | null; readonly error: string | null };
  /** The last edit that the dev server applied, or null. */
  readonly lastEdit: { readonly file: string; readonly at: string; readonly reloaded: boolean } | null;
  /**
   * The URL of the hidden shadow frame, or null or absent when the surface has no shadow. The page
   * shows a second frame with `visibility: hidden` while this value is a URL.
   */
  readonly shadowUrl?: string | null;
  /**
   * The URL of the frame of the indexer window (the built lab with `panel=0&dock=0&adaptive=0`, a stopped
   * clock), or null or absent when the built lab is not ready. Only a surface with the index capability has one.
   */
  readonly indexerUrl?: string | null;
  /**
   * The WebKit worker paths of the render pool for the indexer window (the origin of the pool and its worker
   * token), or null or absent when the built lab is not ready. Then the indexer window lends its frame to the pool, so
   * `labs shot --engine webkit` draws in WKWebView.
   */
  readonly indexerWorker?: { readonly origin: string; readonly token: string } | null;
}

/** The context packet: the text that tells Claude what the owner looks at. */
export interface ContextPacket {
  readonly surface: string;
  /** The ISO time of the packet. */
  readonly made: string;
  readonly checkout: string;
  readonly url: string | null;
  /** The packet as Claude reads it, at most CONTEXT_MAX_LINES lines. */
  readonly text: string;
}
/** The packet has at most about this count of lines. */
export const CONTEXT_MAX_LINES = 40;

/** The permission modes of a chat session: ask, edits, all. */
export type AgentMode = "default" | "acceptEdits" | "bypassPermissions";

/** The answer of the owner to an `agent.ask`. */
export type AgentDecision =
  | { readonly behavior: "allow"; readonly scope: "once" | "session" }
  | { readonly behavior: "deny"; readonly message: string }
  | { readonly behavior: "answer"; readonly answers: Readonly<Record<string, string>> };

/**
 * The ID of a run of the project (a key of `workbench.runs` of the manifest or of the runs of a host plugin).
 * The host gives the list with `runs.commands`.
 */
export type RunCommand = string;

/** A changed file of the checkout. `status` is the two-letter code of `git status --porcelain`. */
export interface ChangedFile {
  readonly path: string;
  readonly status: string;
}

/** The Claude Code hook events that the host serves at `POST /hooks/<event>`. */
export const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionStart",
  "SessionEnd",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

// The requests (page to host).
/** Each request type with its parameters and its result. The change loop (Git, runs, tunes) is in changesProtocol.ts. */
export interface RequestMap
  extends
    ChangesRequests,
    LoopRequests,
    AgentRequests,
    InfraRequests,
    HostRequests,
    IndexRequests,
    WindowRequests,
    SceneFileRequests,
    PromoteRequests {
  /** The first request of a page; `origin` (`location.origin`) goes into the surface URLs. */
  "host.hello": {
    params: { origin?: string };
    /**
     * The project, the Git state, the role of the page and the auth provider. The host always
     * gives them. They are optional for a client of an older host.
     */
    result: { protocol: number; checkout: Checkout | null; surfaces: SurfaceState[] } & Partial<HelloAccess>;
  };
  /** The worktrees of the repository. */
  "checkouts.list": { params: NoParams; result: Checkout[] };
  /** Make a worktree from a branch at `<path or the parent of the main worktree>/<repo name>-<branch>`. */
  "checkouts.create": { params: { branch: string; base?: string; path?: string }; result: Checkout };
  /** Open a checkout. The host starts its dev servers and gives the surfaces. */
  "checkouts.open": { params: { path: string }; result: { checkout: Checkout; surfaces: SurfaceState[] } };
  /** The answer of a frame to a `surface.request`, relayed by the page. */
  "surface.call": {
    params: { request: number } & ({ result: unknown } | { error: string });
    result: null;
  };
  /** An event of a frame (a `BridgeEvent`), relayed by the page. The host keeps the surface URL. */
  "surface.report": { params: { surface: string; where: SurfaceWhere; event: BridgeEvent }; result: null };
  /** Start a PTY in the checkout, or open a known one again (a reload); see `TerminalOpenParams`. */
  "terminal.open": { params: TerminalOpenParams; result: TerminalOpened };
  /** The keys of the owner for a PTY. */
  "terminal.input": { params: { terminal: string; data: string }; result: null };
  /** The new size of a PTY. */
  "terminal.resize": { params: { terminal: string; cols: number; rows: number }; result: null };
  /** End a PTY. */
  "terminal.close": { params: { terminal: string }; result: null };
  // The requests of the chat mode (agent.*) are in agentProtocol.ts.
}

export type RequestType = keyof RequestMap;
export type RequestParams<T extends RequestType> = RequestMap[T]["params"];
export type RequestResult<T extends RequestType> = RequestMap[T]["result"];
/** A request on the wire. */
export type Request<T extends RequestType = RequestType> = {
  [K in T]: { readonly id: number; readonly type: K } & RequestParams<K>;
}[T];

const REQUEST_NAMES: Readonly<Record<RequestType, true>> = {
  "host.hello": true,
  "checkouts.list": true,
  "checkouts.create": true,
  "checkouts.open": true,
  "surface.call": true,
  "surface.report": true,
  "terminal.open": true,
  "terminal.input": true,
  "terminal.resize": true,
  "terminal.close": true,
  ...CHANGES_REQUEST_NAMES,
  ...LOOP_REQUEST_NAMES,
  ...AGENT_REQUEST_NAMES,
  ...INFRA_REQUEST_NAMES,
  ...HOST_REQUEST_NAMES,
  ...INDEX_REQUEST_NAMES,
  ...WINDOW_REQUEST_NAMES,
  ...SCENE_FILE_REQUEST_NAMES,
  ...PROMOTE_REQUEST_NAMES,
};
/** Every request type. */
export const REQUEST_TYPES = Object.keys(REQUEST_NAMES) as RequestType[];

// The answers (host to page).
export type Answer<R = unknown> =
  | { readonly id: number; readonly ok: true; readonly result: R }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Make the answer to a request that worked. */
export function answerOk<R>(id: number, result: R): Answer<R> {
  return { id, ok: true, result };
}

/** Make the answer to a request that failed. */
export function answerError(id: number, error: string): Answer<never> {
  return { id, ok: false, error };
}

// The events (host to page).
/** Each event type with its payload. The agent loop events (notices, the `Stop` gate) are in loopProtocol.ts. */
export interface EventMap
  extends LoopEvents, AgentEvents, InfraEvents, HostEvents, IndexEvents, WindowEvents, SceneFileEvents {
  /** The state of a surface after a change. */
  "surface.state": { surface: SurfaceState };
  /** The host asks the page to send a call into a frame. The page answers with `surface.call`. */
  "surface.request": { request: number; surface: string; where: SurfaceWhere; call: string; args: unknown[] };
  /** Output of a PTY. */
  "terminal.output": { terminal: string; data: string };
  /** A PTY ended. */
  "terminal.exit": { terminal: string; code: number | null; signal: string | null };
  /**
   * A turn changed files. The before and the after are at the URL state of the turn start. The
   * pictures are references of the picture store, not data.
   */
  "agent.turn": {
    session: string;
    turn: number;
    files: string[];
    url: string | null;
    before: PictureRef | null;
    after: PictureRef | null;
    reloaded: boolean;
  };
  /** Output of a run. */
  "runs.output": { run: string; stream: "stdout" | "stderr"; data: string };
  /** A run ended, with its summary and the paths of its output. */
  "runs.done": { run: string; code: number | null; summary: string; outDir: string | null; images: string[] };
  /** The context packet of the surface in front, after each change. */
  "context.packet": { packet: ContextPacket };
}

export type EventType = keyof EventMap;
export type EventPayload<T extends EventType> = EventMap[T];
/** An event on the wire. */
export type HostEvent<T extends EventType = EventType> = {
  [K in T]: { readonly type: K } & EventPayload<K>;
}[T];

const EVENT_NAMES: Readonly<Record<EventType, true>> = {
  "surface.state": true,
  "surface.request": true,
  "terminal.output": true,
  "terminal.exit": true,
  "agent.turn": true,
  "runs.output": true,
  "runs.done": true,
  "context.packet": true,
  ...LOOP_EVENT_NAMES,
  ...AGENT_EVENT_NAMES,
  ...INFRA_EVENT_NAMES,
  ...HOST_EVENT_NAMES,
  ...INDEX_EVENT_NAMES,
  ...WINDOW_EVENT_NAMES,
  ...SCENE_FILE_EVENT_NAMES,
};
/** Every event type. */
export const EVENT_TYPES = Object.keys(EVENT_NAMES) as EventType[];

/** A message from the host to the page. */
export type HostMessage = Answer | HostEvent;

// The guards.
/** Parse JSON text. Give undefined for text that is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** True for a request type of the protocol. */
export function isRequestType(value: unknown): value is RequestType {
  return typeof value === "string" && Object.hasOwn(REQUEST_NAMES, value);
}

/** True for an event type of the protocol. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && Object.hasOwn(EVENT_NAMES, value);
}

/**
 * True for a request envelope: an `id` and a known `type`. The guard does not check the parameters; the host
 * checks them with its schemas.
 */
export function isRequest(value: unknown): value is Request {
  return isRecord(value) && isId(value.id) && isRequestType(value.type);
}

/** True for a request of the given type (the envelope only). */
export function isRequestOf<T extends RequestType>(value: unknown, type: T): value is Request<T> {
  return isRequest(value) && value.type === type;
}

/** True for an answer: an `id` with `ok: true` and a `result`, or `ok: false` and an `error` text. */
export function isAnswer(value: unknown): value is Answer {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.ok === true) return "result" in value;
  return value.ok === false && typeof value.error === "string";
}

/** True for an event envelope: a known `type` and no `id`. */
export function isEvent(value: unknown): value is HostEvent {
  return isRecord(value) && !("id" in value) && isEventType(value.type);
}

/** True for an event of the given type (the envelope only). */
export function isEventOf<T extends EventType>(value: unknown, type: T): value is HostEvent<T> {
  return isEvent(value) && value.type === type;
}

/** Read a message of the host from WebSocket text. Give null for anything else. */
export function readHostMessage(text: string): HostMessage | null {
  const value = parseJson(text);
  return isAnswer(value) || isEvent(value) ? value : null;
}

/** Read a request of the page from WebSocket text. Give null for anything else. */
export function readRequest(text: string): Request | null {
  const value = parseJson(text);
  return isRequest(value) ? value : null;
}
