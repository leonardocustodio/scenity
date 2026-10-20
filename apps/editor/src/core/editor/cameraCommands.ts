// SPDX-License-Identifier: Apache-2.0
/**
 * The camera commands (`camera.*`) of the scene editor:
 *
 * - `camera.save` (an edit with one source op): a named camera from the current view of the focused pane (else of
 *   the main camera). The source op is a run of `labs camera-save`. This tool writes the view into the cameras module
 *   of the plugin. In the workbench, the host runs it (a run of the Runs tab, editor/useCameraSave.ts). The lab page
 *   alone shows the command to copy. The dry run comes first and shows the lines that change.
 * - `camera.bookmark` and `camera.recall` (view commands): a quick list of views in the URL (`views=`). This list is
 *   not saved into the source. A bookmark is a view option of the lab, not an input of a frame. The frame key reads
 *   the camera of a frame (`camera`, `view`), not the bookmarks.
 */
import { viewText } from "../cameras";
import { CAMERA_SAVE_TOOL, cameraDocProblem, cameraNameProblem, cameraSaveCommand } from "../cameraNames";
import {
  CommandError,
  NO_RULE,
  textArg,
  type BookmarkHost,
  type Command,
  type CameraNow,
  labCommands,
} from "./commandKit";
import { t } from "../../texts";

function cameraOf(now: (() => CameraNow) | undefined): CameraNow {
  if (now === undefined) throw new CommandError(t("commands-camera-no-camera"));
  return now();
}

function bookmarksOf(host: { readonly bookmarks?: BookmarkHost }): BookmarkHost {
  if (host.bookmarks === undefined) throw new CommandError(t("commands-camera-no-bookmarks"));
  return host.bookmarks;
}

/** A camera or bookmark name, or a command error with the rule. */
function nameOf(text: string): string {
  const problem = cameraNameProblem(text);
  if (problem !== null) throw new CommandError(problem);
  return text;
}

const NAME = {
  type: "string",
  description: t("commands-camera-arg-name"),
} as const;

export const CAMERA_COMMANDS: readonly Command[] = labCommands([
  {
    id: "camera.save",
    title: t("commands-camera-save"),
    key: null,
    kind: "edit",
    args: {
      name: NAME,
      dry: {
        type: "boolean",
        default: true,
        description: t("commands-camera-save-arg-dry"),
      },
      replace: {
        type: "boolean",
        default: false,
        description: t("commands-camera-save-arg-replace"),
      },
      doc: {
        type: "string",
        optional: true,
        description: t("commands-camera-save-arg-doc"),
      },
    },
    selection: NO_RULE,
    build(args, state) {
      const name = nameOf(textArg(args, "name"));
      const camera = cameraOf(state.camera);
      const replace = args.replace === true;
      if (!replace && camera.names.includes(name)) {
        throw new CommandError(t("commands-camera-save-exists", { name }));
      }
      const doc = textArg(args, "doc").trim();
      const docProblem = doc === "" ? null : cameraDocProblem(doc);
      if (docProblem !== null) throw new CommandError(docProblem);
      const dry = args.dry !== false;
      const save = { name, view: camera.view, dry, replace, ...(doc === "" ? {} : { doc }) };
      return {
        kind: "edit",
        title: t("commands-camera-save-edit", { name, dry: dry ? "yes" : "no" }),
        ops: [
          {
            kind: "source",
            tool: CAMERA_SAVE_TOOL,
            args: { ...save, view: viewText(camera.view), command: cameraSaveCommand(save) },
          },
        ],
      };
    },
  },
  {
    id: "camera.bookmark",
    title: t("commands-camera-bookmark"),
    key: null,
    kind: "view",
    args: { name: NAME },
    selection: NO_RULE,
    build(args) {
      const name = nameOf(textArg(args, "name"));
      return {
        kind: "view",
        title: t("commands-camera-bookmark-edit", { name }),
        run: (host) => bookmarksOf(host).bookmark(name),
      };
    },
  },
  {
    id: "camera.recall",
    title: t("commands-camera-recall"),
    key: null,
    kind: "view",
    args: { name: { type: "string", description: t("commands-camera-recall-arg-name") } },
    selection: NO_RULE,
    when: (state) => ((state.camera?.().bookmarks.length ?? 0) > 0 ? null : t("commands-camera-recall-none")),
    build(args, state) {
      const name = textArg(args, "name");
      const names = state.camera?.().bookmarks ?? [];
      if (!names.includes(name))
        throw new CommandError(t("commands-camera-recall-unknown", { name, names: names.join(", ") }));
      return {
        kind: "view",
        title: t("commands-camera-recall-edit", { name }),
        run: (host) => bookmarksOf(host).recall(name),
      };
    },
  },
]);
