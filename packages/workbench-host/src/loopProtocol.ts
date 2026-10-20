// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the agent loop of the terminal mode: the notices of Claude Code (a `Notification` hook), the `Stop`
 * gate of a session, the saved turns with their pictures, and the sessions of the Claude terminal (resume,
 * transcript). `protocol.ts` exports them. This module is
 * pure (no `node:` or `bun:` import), so the page gets them through `@scenity/workbench-host/protocol`.
 */
import type { PictureRef } from "./pictureProtocol";

/** The state of the `Stop` gate: on, the sequence that it checks, and its last verdict. */
export interface StopGateState {
  /** True: the host refuses "done" while the gate check fails. */
  readonly on: boolean;
  /** The sequence of the last check, or null (no sequence, or before a check). */
  readonly sequence?: string | null;
  /** The old name of `sequence` (the take of the lab), kept for compatibility. */
  readonly take: string | null;
  /** The last verdict, or null before a check. */
  readonly last: {
    readonly pass: boolean;
    readonly summary: string;
    /** The ISO time of the check. */
    readonly at: string;
    /** True when the gate refused the stop. */
    readonly refused: boolean;
  } | null;
}

/** The pictures of a turn: the frame before and after, and a one-row sheet of the turn window each. */
export type TurnPictureName = "before" | "after" | "beforeSheet" | "afterSheet";
export const TURN_PICTURE_NAMES: readonly TurnPictureName[] = ["before", "after", "beforeSheet", "afterSheet"];

/** The window of the sheets of a turn: the window of the open item, or ±2 s around the time of the turn. */
export interface TurnWindow {
  readonly from: number;
  readonly to: number;
  /** The times of the cells (ms). */
  readonly times: readonly number[];
  /** The named camera of the sheet, or null for the camera of the frame (a free view). */
  readonly camera: string | null;
  readonly source: "item" | "time";
}

/** A turn of Claude in the state folder: the facts and the names of the pictures that the host has. */
export interface SavedTurn {
  readonly session: string;
  readonly turn: number;
  readonly prompt: string;
  /** The ISO time of the turn start. */
  readonly started: string;
  readonly files: readonly string[];
  /** The URL state of the turn start, or null. */
  readonly url: string | null;
  readonly reloaded: boolean;
  readonly applied: boolean;
  readonly error: string | null;
  readonly window: TurnWindow | null;
  readonly pictures: readonly TurnPictureName[];
}

/**
 * The pictures of one turn; a picture that the host does not have is null. References of the picture
 * store; the page reads the bytes at `GET /pictures/<id>`.
 */
export type TurnPictures = { readonly turn: SavedTurn } & Readonly<Record<TurnPictureName, PictureRef | null>>;

/** A session of the `claude` CLI of a workbench terminal: the resume and the transcript use its ID. */
export interface TerminalSessionInfo {
  readonly session: string;
  /** The workbench terminal of the session (`claude-…`). */
  readonly terminal: string;
  readonly checkout: string;
  /** The ISO time of the first record and of the last one. */
  readonly started: string;
  readonly seen: string;
  /** Where the host learned the ID: `launch` (`--session-id`), `hook` (`SessionStart`) or `folder` (the transcripts). */
  readonly source: "launch" | "hook" | "folder";
  /** True while the terminal of the session runs. */
  readonly live: boolean;
  /** True when the transcript file of the CLI exists. */
  readonly transcript: boolean;
}

/** The requests of the agent loop (page to host). `RequestMap` of protocol.ts extends this map. */
export interface LoopRequests {
  /** The state of the `Stop` gate, and a change of it when `on` is present. */
  "agent.setStopGate": { params: { on?: boolean }; result: StopGateState };
  /** The turns of the open checkout with their pictures in the state folder, the newest first. */
  "agent.turnList": { params: object; result: { turns: SavedTurn[] } };
  /** The pictures of one turn. */
  "agent.turnPictures": { params: { session: string; turn: number }; result: TurnPictures };
  /** The sessions of the Claude terminals of the open checkout, the newest first. */
  "terminal.sessions": { params: object; result: { sessions: TerminalSessionInfo[] } };
  /**
   * Write the transcript of a CLI session as Markdown into a folder of the checkout (a run or record folder).
   * The denylist applies: no file of the denylist as the target, and no content of a denylisted file in the text.
   */
  "terminal.export": { params: { session: string; folder: string }; result: { path: string; messages: number } };
}

/** The events of the agent loop (host to page). `EventMap` of protocol.ts extends this map. */
export interface LoopEvents {
  /**
   * Claude Code waits for the owner (a `Notification` hook: a permission prompt, an idle prompt) or a check
   * of the `Stop` gate refused "done". The page shows a native notification when the window is not in front.
   */
  "agent.notify": { session: string | null; kind: string | null; title: string; message: string };
  /** The `Stop` gate after a change or a check. */
  "agent.stopGate": { gate: StopGateState };
  /** The host saved a turn or a picture of it (the page reads the list and the pictures again). */
  "agent.turnSaved": { turn: SavedTurn };
}

/** The names of the requests of the agent loop. */
export const LOOP_REQUEST_NAMES: Readonly<Record<keyof LoopRequests, true>> = {
  "agent.setStopGate": true,
  "agent.turnList": true,
  "agent.turnPictures": true,
  "terminal.sessions": true,
  "terminal.export": true,
};
/** The names of the events of the agent loop. */
export const LOOP_EVENT_NAMES: Readonly<Record<keyof LoopEvents, true>> = {
  "agent.notify": true,
  "agent.stopGate": true,
  "agent.turnSaved": true,
};
