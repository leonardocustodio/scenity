// SPDX-License-Identifier: Apache-2.0
/**
 * The context of a tool call of the agent tools: the port to a frame of the scene surface (a window of the editor),
 * the agent session of the call and the jobs of the host. A host gives more parts in its own context. For example, the
 * workbench host gives the index, the console log and the runs.
 */
import type { JobPort } from "./jobs";

/** A frame of the scene surface: the visible one, or the shadow one of the agent. */
export type ToolFrame = "visible" | "shadow";

/** A port to one frame: it sends a bridge call and gives the result of the frame. */
export interface SurfacePort {
  /** Send a call; the promise rejects with the error text of the frame or after the timeout. */
  call(call: string, args?: readonly unknown[], options?: { timeoutMs?: number }): Promise<unknown>;
}

/** The context of a call of an agent tool. */
export interface SceneToolContext {
  /** The port to a frame of the scene surface. */
  surface(frame: ToolFrame): SurfacePort;
  /** The agent session of the call (its ID, name, colour and turn), or absent. */
  readonly session?: { readonly id: string; readonly name: string; readonly colour?: string; readonly turn?: number };
  /** The jobs of the open checkout, or absent (no runs). */
  readonly jobs?: JobPort;
}
