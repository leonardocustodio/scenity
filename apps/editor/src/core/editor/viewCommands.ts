// SPDX-License-Identifier: Apache-2.0
/**
 * The view, placement and proposal commands of the scene editor: the selection, undo and redo, the named cameras, the
 * marks, the ask, "Save placement" (a source op for `labs tune-apply`) and the proposals (`proposal.*`, the actions of
 * the owner).
 */
import { parseSelect, tuneText } from "@scenity/runtime-dev";
import { editorPlugin } from "../plugin";
import { cameraNames, isCameraName } from "../cameras";
import { placementCommand, placementValues } from "../edit/placement";
import {
  CommandError,
  NO_RULE,
  PLACEMENT_TOOL,
  textArg,
  type ArgSpec,
  type Command,
  type CommandState,
  labCommands,
} from "./commandKit";
import { t } from "../../texts";

export const VIEW_COMMANDS: readonly Command[] = labCommands([
  {
    id: "selection.set",
    title: t("commands-view-select"),
    key: t("commands-view-select-key"),
    kind: "view",
    args: {
      target: {
        type: "string",
        description: t("commands-view-select-arg-target"),
      },
    },
    selection: NO_RULE,
    build(args) {
      const text = textArg(args, "target");
      const target = parseSelect(text);
      // The kinds of the items that the plugin can select.
      const kinds = editorPlugin().selectionKinds;
      if (target === null || !kinds.includes(target.kind)) {
        throw new CommandError(t("commands-view-select-bad", { text, kinds: kinds.join(", ") }));
      }
      return {
        kind: "view",
        title: t("commands-view-select-edit", { text }),
        run(host) {
          host.select(target);
          return null;
        },
      };
    },
  },
  {
    id: "selection.clear",
    title: t("commands-view-clear"),
    key: "Escape",
    kind: "view",
    args: {},
    selection: { kinds: "any" },
    build: () => ({
      kind: "view",
      title: t("commands-view-clear"),
      run(host) {
        host.select(null);
        return null;
      },
    }),
  },
  {
    id: "history.undo",
    title: t("commands-view-undo"),
    key: "⌘Z",
    kind: "view",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.canUndo ? null : t("commands-view-undo-none")),
    build: () => ({
      kind: "view",
      title: t("commands-view-undo"),
      run(host) {
        host.undo();
        return null;
      },
    }),
  },
  {
    id: "history.redo",
    title: t("commands-view-redo"),
    key: "⇧⌘Z",
    kind: "view",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.canRedo ? null : t("commands-view-redo-none")),
    build: () => ({
      kind: "view",
      title: t("commands-view-redo"),
      run(host) {
        host.redo();
        return null;
      },
    }),
  },
  {
    id: "camera.open",
    title: t("commands-view-camera"),
    key: "1–9",
    kind: "view",
    args: {
      name: {
        type: "string",
        // The names of the cameras of the plugin. The getter reads them when a listing or a check asks for them.
        get values() {
          return cameraNames();
        },
        description: t("commands-view-camera-arg-name"),
      },
    },
    selection: NO_RULE,
    build(args) {
      const name = textArg(args, "name");
      if (!isCameraName(name)) throw new CommandError(t("commands-view-camera-unknown", { name }));
      return {
        kind: "view",
        title: t("commands-view-camera-edit", { name }),
        run(host) {
          host.openCamera(name);
          return null;
        },
      };
    },
  },
  {
    id: "marks.start",
    title: t("commands-view-marks-start"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.marking ? t("commands-view-marks-start-busy") : null),
    build: () => ({
      kind: "view",
      title: t("commands-view-marks-start-edit"),
      run(host) {
        host.setMarking(true);
        return null;
      },
    }),
  },
  {
    id: "marks.stop",
    title: t("commands-view-marks-stop"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.marking ? null : t("commands-view-marks-stop-none")),
    build: () => ({
      kind: "view",
      title: t("commands-view-marks-stop"),
      run(host) {
        host.setMarking(false);
        return null;
      },
    }),
  },
  {
    id: "marks.clear",
    title: t("commands-view-marks-clear"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.marks > 0 ? null : t("commands-view-marks-clear-none")),
    build: () => ({
      kind: "view",
      title: t("commands-view-marks-clear"),
      run(host) {
        host.clearMarks();
        return null;
      },
    }),
  },
  {
    id: "ask",
    title: t("commands-view-ask"),
    key: null,
    kind: "view",
    args: { text: { type: "string", description: t("commands-view-ask-arg-text") } },
    selection: NO_RULE,
    build(args) {
      const text = textArg(args, "text");
      return { kind: "view", title: t("commands-view-ask-edit"), run: (host) => host.ask(text) };
    },
  },
]);

export const PLACEMENT_COMMANDS: readonly Command[] = labCommands([
  {
    id: "placement.save",
    title: t("commands-view-placement-save"),
    key: null,
    kind: "edit",
    args: {
      dry: {
        type: "boolean",
        default: true,
        description: t("commands-view-placement-save-arg-dry"),
      },
      // The save stops while a layout check fails. A reason lets the save continue.
      override: {
        type: "string",
        optional: true,
        description: t("commands-view-placement-save-arg-override"),
      },
    },
    selection: NO_RULE,
    when: (state) =>
      Object.keys(placementValues(state.tunes)).length > 0 ? null : t("commands-view-placement-save-none"),
    build(args, state) {
      const values = placementValues(state.tunes);
      if (Object.keys(values).length === 0) throw new CommandError(t("commands-view-placement-save-none"));
      const dry = args.dry !== false;
      const override = textArg(args, "override").trim();
      const why = override === "" ? {} : { override };
      return {
        kind: "edit",
        title: t("commands-view-placement-save-edit", {
          dry: dry ? "yes" : "no",
          override: override === "" ? "no" : "yes",
        }),
        ops: [
          {
            kind: "source",
            tool: PLACEMENT_TOOL,
            args: { values: tuneText(values), dry, placement: true, command: placementCommand(values, dry), ...why },
          },
        ],
      };
    },
  },
]);

const PROPOSAL_ID: ArgSpec = { type: "string", description: t("commands-view-proposal-arg-id") };
const hasProposals = (state: CommandState): string | null =>
  state.proposals > 0 ? null : t("commands-view-proposal-none");

/** The proposal commands (`proposal.*`): the actions of the owner. Claude has no tool for them. */
export const PROPOSAL_COMMANDS: readonly Command[] = labCommands([
  {
    id: "proposal.accept",
    title: t("commands-view-proposal-accept"),
    key: null,
    kind: "view",
    args: { id: PROPOSAL_ID },
    selection: NO_RULE,
    owner: true,
    when: hasProposals,
    build(args) {
      const id = textArg(args, "id");
      return { kind: "view", title: t("commands-view-proposal-accept-edit", { id }), run: (host) => host.accept(id) };
    },
  },
  {
    id: "proposal.reject",
    title: t("commands-view-proposal-reject"),
    key: null,
    kind: "view",
    args: { id: PROPOSAL_ID },
    selection: NO_RULE,
    owner: true,
    when: hasProposals,
    build(args) {
      const id = textArg(args, "id");
      return { kind: "view", title: t("commands-view-proposal-reject-edit", { id }), run: (host) => host.reject(id) };
    },
  },
  {
    id: "proposal.acceptAll",
    title: t("commands-view-proposal-accept-all"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    owner: true,
    when: hasProposals,
    build: () => ({ kind: "view", title: t("commands-view-proposal-accept-all"), run: (host) => host.acceptAll() }),
  },
  {
    id: "proposal.rejectAll",
    title: t("commands-view-proposal-reject-all"),
    key: null,
    kind: "view",
    args: {},
    selection: NO_RULE,
    owner: true,
    when: hasProposals,
    build: () => ({ kind: "view", title: t("commands-view-proposal-reject-all"), run: (host) => host.rejectAll() }),
  },
]);
