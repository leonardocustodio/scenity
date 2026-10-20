// SPDX-License-Identifier: Apache-2.0
/**
 * The hook points of a scene core: the methods that a plugin core and the labs core override. SceneCore
 * (sceneCore.ts) extends this class and calls the hooks. The generic defaults do nothing.
 */
import type { Object3D } from "three";
import type { Vec3 } from "@scenity/character/math";
import type { Tiering } from "./tiers";

/** An anchor of the scene for the host: a world point, and false when its object does not show. */
export interface AnchorPoint {
  readonly id: string;
  readonly at: Vec3;
  readonly visible: boolean;
}

/** The hooks of SceneCore. `Input` and `Memory` are the type parameters of SceneCore. */
export abstract class SceneHooks<Input, Memory> {
  /** Update the objects of the scene for the input and one simulation time (null: no server time). */
  protected abstract updateScene(input: Input, simOrNull: number | null): void;

  /** The frame memory that goes forward over a seek: the labs core puts it back after a picture at another time. */
  protected abstract saveMemory(): Memory;

  protected abstract restoreMemory(memory: Memory): void;

  /** The core calls this hook after a new input, before the frame that the input asks for. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the subclass reads the argument.
  protected inputChanged(_input: Input): void {
    // The generic core does nothing here.
  }

  /**
   * The core calls this hook after a new tier and in initView. It sets the lights and the soft shadows of the subclass.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the subclass reads the argument.
  protected tierChanged(_tiering: Tiering): void {
    // The generic core does nothing here.
  }

  /** True while a character walks. With reduced motion, the loop then runs until the walk ends. */
  protected walking(): boolean {
    return false;
  }

  /** The objects of the pointer hit test. */
  protected hitTargets(): Object3D[] {
    return [];
  }

  /** The ID of a hit object, or null. */
  protected hitIdOf(object: Object3D): string | null {
    return object.name === "" ? null : object.name;
  }

  /** Highlight a hit target (true) or stop its highlight (false). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the subclass reads the arguments.
  protected setHover(_id: string, _on: boolean): void {
    // The generic core highlights nothing.
  }

  /** The anchors of the scene: the core sends their projected points to the host (emitAnchors). */
  protected anchorPoints(): readonly AnchorPoint[] {
    return [];
  }

  /** Release the objects of the scene (dispose), before the backend goes. */
  protected disposeScene(): void {
    // The generic core has no objects of its own to release.
  }

  /** Aim the camera for the aspect of the canvas (a hook of the subclass and of the labs core). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the subclass reads the argument.
  protected aimCamera(_aspect: number): void {
    // The generic core keeps the camera where it is.
  }

  /**
   * Remove the state that the frames keep from one frame to the next (after a seek of the clock). The next frame
   * gets that state from the input and its time, as the first frame of a page does.
   */
  protected forgetHistory(): void {
    // The generic core keeps no history.
  }

  /**
   * True while the host says that its clock is stopped (a hook of the labs core). The loop then waits for an input: a
   * frame of the same time is the same frame.
   */
  protected clockStopped(): boolean {
    return false;
  }

  /** Before the update of a frame (a hook of the labs core). */
  protected beforeUpdate(): void {
    // The runtime does nothing here.
  }

  /** After the update of a frame, before its render (a hook of the labs core). */
  protected afterUpdate(): void {
    // The runtime does nothing here.
  }

  /**
   * After a frame at `sim` (a hook of the labs core): the frame started at `start`, its update ended at
   * `updated` and its render at `rendered`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the labs core reads the arguments.
  protected afterFrame(_sim: number | null, _start: number, _updated: number, _rendered: number): void {
    // The runtime does nothing here.
  }
}
