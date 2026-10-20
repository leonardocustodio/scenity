// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the dev worker: the options of the dev core from the "init" message, and the handler of the lab
 * messages. The worker extension of a plugin makes its core with `devCoreOptions` and gives the other messages to
 * `handleDevMessage`; a test can call them with a fake core.
 */
import type { ExtensionMessage, InitMessage } from "@scenity/runtime/protocol";
import type { DevCoreApi } from "../client";
import type { FrameCapture } from "../inspect";
import type { PaneViews } from "../panes";
import type { CameraView } from "@scenity/runtime/framing";
import type { DevInit, DevToWorker } from "./protocol";

/** The options of the dev core from the "init" message: the fixed camera, the asset loads and the panes. */
export function devCoreOptions(init: InitMessage | DevInit): {
  readonly view: CameraView | null;
  readonly loads?: number;
  readonly panes?: PaneViews;
} {
  const { view, loads, panes } = init as DevInit;
  return { view: view ?? null, ...(loads === undefined ? {} : { loads }), ...(panes == null ? {} : { panes }) };
}

/** Handle a lab message of the page with the dev core; the answers go to `post`. */
export function handleDevMessage(
  input: ExtensionMessage,
  core: DevCoreApi,
  post: (message: ExtensionMessage) => void,
): void {
  const message = input as DevToWorker;
  if (!setDevState(message, core)) answerDev(message, core, post);
}

/** A message that sets a state of the dev core (no answer); false for another message. */
function setDevState(message: DevToWorker, core: DevCoreApi): boolean {
  switch (message.type) {
    case "view":
      core.setView(message.view);
      return true;
    case "views": {
      // The layout and the cameras of the split screen, and the own tune values of the panes (a layout variant per
      // pane).
      const { layout, views, hideDebug, tunes } = message;
      const own = tunes === undefined ? {} : { tunes };
      core.setPanes({ layout, views, ...(hideDebug === undefined ? {} : { hideDebug }), ...own });
      return true;
    }
    case "debug":
      core.setDebug(message.layers);
      return true;
    case "tune":
      core.setTunes(message.values, message.quick === true);
      return true;
    case "clockStopped":
      core.setClockStopped(message.stopped);
      return true;
    case "select":
      core.setSelection(message.target);
      return true;
    case "previews":
      core.setPreviews(message.models);
      return true;
    case "scratch":
      core.setScratch(message.update);
      return true;
    case "ghosts":
      core.setGhosts(message.specs);
      return true;
    case "overlay":
      core.setOverlay(message.spec);
      return true;
    case "onion":
      core.setOnion(message.spec);
      return true;
    // The solo and hide of the panes.
    case "paneHide":
      core.setHidden(message.spec);
      return true;
    default:
      return false;
  }
}

/** A message that the dev core answers (a list, a report, a picture or a frame). */
function answerDev(message: DevToWorker, core: DevCoreApi, post: (message: ExtensionMessage) => void): void {
  switch (message.type) {
    case "pick":
      post({ type: "picked", id: message.id, result: core.pick(message.x, message.y, message.pane) });
      break;
    case "listGhosts":
      post({ type: "ghostList", id: message.id, ghosts: core.ghosts() });
      break;
    case "listOverlay":
      post({ type: "overlayList", id: message.id, overlay: core.overlayView() });
      break;
    case "listOnion":
      post({ type: "onionList", id: message.id, onion: core.onionView() });
      break;
    case "listHide":
      post({ type: "hideList", id: message.id, spec: core.hiddenView() });
      break;
    case "propBoxes":
      post({ type: "boxList", id: message.id, boxes: core.propBoxes() });
      break;
    case "inspect":
      post({ type: "inspected", id: message.id, report: core.inspect() });
      break;
    case "sweep":
      post({ type: "swept", id: message.id, reports: core.sweep(message.samples) });
      break;
    case "shots": {
      const { id, samples, width, height, view } = message;
      void core.shots({ samples, width, height, view }).then((shots) => {
        post({ type: "shot", id, shots });
      });
      break;
    }
    case "capture": {
      const { id, width, height, target } = message;
      const answer = (capture: FrameCapture): void => {
        post({ type: "captured", id, capture });
      };
      core.capture(width, answer, height ?? 0, target ?? {});
      break;
    }
    case "mark": {
      const id = message.id;
      core.mark((simMs) => {
        post({ type: "drawn", id, simMs });
      });
      break;
    }
    case "captureCheck": {
      const id = message.id;
      core.captureCheck((check) => {
        post({ type: "captureChecked", id, check });
      });
      break;
    }
    default:
      break;
  }
}
