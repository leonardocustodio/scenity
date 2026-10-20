// SPDX-License-Identifier: Apache-2.0
/**
 * Unpack a prefab instance. The entities of the prefab (with the overrides of the instance) become plain entities of
 * the scene under the instance entity, with the IDs `<instance>-<prefab entity>`. The instance loses its `prefab`
 * component (`unpack` of `@scenity/scene`). After that, the scene keeps no link to the prefab. One step of the history.
 * No Vue import.
 */
import { unpack } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { CommandError, defineCommands, textArg, type CommandHost } from "../command";
import { entityLabel } from "../hierarchy/tree";
import type { PrefabPageOp, PrefabState } from "./commands";
import { setResolver } from "./library";

/** The unpack command. */
export const PREFAB_UNPACK_COMMANDS = defineCommands<PrefabState, CommandHost, PrefabPageOp>([
  {
    id: "prefab.unpack",
    icon: "package-open",
    title: "Unpack a prefab instance: its entities become plain entities of the scene",
    key: null,
    kind: "edit",
    args: {
      instance: {
        type: "string",
        description: "The ID of the instance (default: the selected entity).",
        optional: true,
      },
    },
    selection: { kinds: ["entity"], orArg: "instance" },
    build: (args, state) => {
      const given = textArg(args, "instance").trim();
      const selected = state.selection?.kind === "entity" ? state.selection.id : "";
      const target = (given === "" ? selected : given).split("/")[0] ?? "";
      const result = unpack(
        state.doc as SceneDocument,
        target,
        setResolver(state.prefabs, state.prefabPaths),
        state.registry,
      );
      if (!result.ok) throw new CommandError(result.reason);
      return {
        kind: "edit",
        title: `Unpack ${entityLabel(state.doc, target)}`,
        ops: result.ops.map((op) => ({ kind: "scene" as const, op })),
      };
    },
  },
]);
