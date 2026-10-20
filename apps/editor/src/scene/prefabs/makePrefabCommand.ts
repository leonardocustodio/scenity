// SPDX-License-Identifier: Apache-2.0
/**
 * Make a prefab from the selection. The command `prefab.create` writes the prefab file of the selected entities
 * (`makePrefab` of `@scenity/editor-core`) into a folder of the project (default `prefabs`). It loads the file into
 * the prefab set of the page, and puts one instance of it in the place of the selection as one undo step. Undo removes
 * the instance, but the file stays. `replace: false` writes the file only. A drag of hierarchy rows onto a folder of
 * the Project window runs the command with that folder. A nested instance in the new prefab gets a source from the
 * prefab file. The command `prefab.variant` writes a variant of the prefab of the selected instance beside the base
 * file. A variant is a prefab with one root: an instance of the base with the overrides of the instance. Then the
 * instance uses the variant with no overrides, as one undo step.
 */
import { CommandError, EditError, makePrefab, makeVariant, rebasedSource, relativePath } from "@scenity/editor-core";
import { resolveFrom } from "@scenity/scene/paths";
import { formatPointer } from "@scenity/scene";
import type { PrefabValue } from "@scenity/scene/components";
import type { PrefabDocument } from "@scenity/scene/schema/documents";
import { t } from "../../texts";
import { fileSlug, textOrAsk, type FileCommandParts } from "../projects/fileCommands";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import type { PagePrefabs } from "./pagePrefabs";

/** What the command reads of the page. */
export interface MakePrefabParts extends FileCommandParts {
  readonly prefabs?: Pick<PagePrefabs, "keep"> | undefined;
  /** Write a new file of the project; the result is its text. */
  write(path: string, doc: PrefabDocument): Promise<string>;
}

/** The entities that a run makes the prefab of: the argument, else the selected entities of the document. */
function selectedOf(parts: MakePrefabParts, args: Readonly<Record<string, unknown>>): string[] {
  const given = typeof args.entity === "string" && args.entity !== "" ? [args.entity] : (parts.selection?.ids ?? []);
  return given.filter((id) => parts.editor.doc.entities[id] !== undefined);
}

/** The command `prefab.create`. */
export function makePrefabCommand(parts: MakePrefabParts): PageKeyCommandSpec {
  const { editor, notices } = parts;
  return {
    id: "prefab.create",
    title: t("command-prefab-create"),
    menu: "entity",
    agents: true,
    args: {
      name: { type: "string", description: t("command-arg-file-name"), optional: true },
      entity: { type: "string", description: t("command-arg-root"), optional: true },
      folder: { type: "string", description: t("command-arg-folder"), optional: true },
      replace: { type: "boolean", description: t("command-arg-replace"), optional: true },
    },
    when: () => ((parts.selection?.ids.length ?? 0) > 0 ? null : t("command-prefab-none")),
    run: async (args) => {
      const selected = selectedOf(parts, args);
      const first = selected[0] === undefined ? undefined : editor.doc.entities[selected[0]];
      if (first === undefined) throw new CommandError(t("command-prefab-none"));
      const ask = {
        title: t("command-prefab-create"),
        label: t("command-name"),
        value: first.name ?? selected[0] ?? "",
      };
      const name = await textOrAsk(notices, args, "name", ask);
      if (name === null) return;
      const folder =
        typeof args.folder === "string" && args.folder !== "" ? args.folder.replace(/\/+$/, "") : "prefabs";
      const file = `${fileSlug(name) || "prefab"}.prefab.json`;
      // "." is the root folder of the project.
      const path = folder === "." ? file : `${folder}/${file}`;
      let made;
      try {
        const rebase = (source: string) => rebasedSource(source, editor.file.path, path);
        made = makePrefab(editor.doc, selected, name, relativePath(editor.file.path, path), rebase);
      } catch (error) {
        if (error instanceof EditError) throw new CommandError(error.message);
        throw error;
      }
      const text = await parts.write(path, made.prefab);
      if (args.replace === false) return;
      parts.prefabs?.keep(path, made.prefab, text);
      editor.usePrefabs({ [path]: made.prefab });
      const reason = editor.apply([...made.ops], t("command-prefab-made", { name }));
      if (reason !== null) throw new CommandError(reason);
      parts.selection?.set?.([made.instance]);
    },
  };
}

/** The selected instance of a run (the argument, else the primary selected entity) and its prefab value. */
function instanceOf(parts: MakePrefabParts, args: Readonly<Record<string, unknown>>) {
  const id = typeof args.entity === "string" && args.entity !== "" ? args.entity : parts.selection?.ids[0];
  const entity = id === undefined ? undefined : parts.editor.doc.entities[id];
  const prefab = entity?.components.prefab as PrefabValue | undefined;
  return id === undefined || entity === undefined || prefab === undefined ? null : { id, entity, prefab };
}

/** The command `prefab.variant`. */
export function makeVariantCommand(parts: MakePrefabParts): PageKeyCommandSpec {
  const { editor, notices } = parts;
  return {
    id: "prefab.variant",
    title: t("command-prefab-variant"),
    menu: "entity",
    agents: true,
    args: {
      name: { type: "string", description: t("command-arg-file-name"), optional: true },
      entity: { type: "string", description: t("command-arg-instance"), optional: true },
    },
    when: () => (instanceOf(parts, {}) === null ? t("command-prefab-variant-none") : null),
    run: async (args) => {
      const found = instanceOf(parts, args);
      if (found === null) throw new CommandError(t("command-prefab-variant-none"));
      if (found.prefab.source.startsWith("asset:")) throw new CommandError(t("command-prefab-variant-asset"));
      const base = resolveFrom(editor.file.path, found.prefab.source);
      const baseName = editor.prefabs[base]?.name ?? found.entity.name ?? found.id;
      const ask = { title: t("command-prefab-variant"), label: t("command-name"), value: `${baseName} variant` };
      const name = await textOrAsk(notices, args, "name", ask);
      if (name === null) return;
      const path = `${base.slice(0, base.lastIndexOf("/") + 1)}${fileSlug(name) || "variant"}.prefab.json`;
      const variant = makeVariant(name, relativePath(path, base), found.prefab.overrides ?? []);
      const text = await parts.write(path, variant);
      parts.prefabs?.keep(path, variant, text);
      editor.usePrefabs({ [path]: variant });
      const at = (field: string) => formatPointer(["entities", found.id, "components", "prefab", field]);
      const ops = [
        { op: "set" as const, path: at("source"), value: relativePath(editor.file.path, path) },
        ...(found.prefab.overrides === undefined ? [] : [{ op: "set" as const, path: at("overrides") }]),
      ];
      const reason = editor.apply(ops, t("command-prefab-variant-made", { name }));
      if (reason !== null) throw new CommandError(reason);
    },
  };
}
