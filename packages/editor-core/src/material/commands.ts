// SPDX-License-Identifier: Apache-2.0
/**
 * The material command of the scene page. `material.assign` assigns a material asset to a part of an entity
 * (assign.ts) as one scene op. Thus it is one step of the history. The panel, the script API and Claude run the same
 * command. A run of Claude is a proposal by the rule of the runner. No Vue import.
 */
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { CommandError, defineCommands, textArg, type CommandHost } from "../command";
import { EditError, type SceneEditOp } from "../ops";
import type { RuleState } from "../registry";
import { assignMaterialOps } from "./assign";

/** What the material command reads: the document and the selection. */
export interface MaterialCommandState extends RuleState {
  readonly doc: EntityDocument;
}

/** The material commands. */
export const MATERIAL_COMMANDS = defineCommands<MaterialCommandState, CommandHost, SceneEditOp>([
  {
    id: "material.assign",
    icon: "palette",
    title: "Assign a material asset to a part of an entity",
    key: null,
    kind: "edit",
    args: {
      entity: { type: "string", description: "The entity ID (default: the primary selected entity).", optional: true },
      part: {
        type: "string",
        description: "The part: `mesh:<node>` or a material name of the model (default: the shape).",
        optional: true,
      },
      material: { type: "string", description: "The material asset `asset:<id>`, or `none` to take it out." },
    },
    selection: { kinds: ["entity"], orArg: "entity" },
    build: (args, state) => {
      const entity = typeof args.entity === "string" ? args.entity : (state.selection?.id ?? "");
      const part = typeof args.part === "string" && args.part !== "" ? args.part : null;
      const material = textArg(args, "material");
      const ref = material === "none" ? null : material;
      if (ref !== null && !ref.startsWith("asset:")) throw new CommandError(`"${material}" is not an asset reference.`);
      try {
        const ops = assignMaterialOps(state.doc, entity, part, ref);
        const where = part === null ? entity : `${entity} ${part}`;
        const title = ref === null ? `Take the material out of ${where}` : `Assign ${ref} to ${where}`;
        return { kind: "edit", title, ops: ops.map((op): SceneEditOp => ({ kind: "scene", op })) };
      } catch (error) {
        if (error instanceof EditError) throw new CommandError(error.message);
        throw error;
      }
    },
  },
]);
