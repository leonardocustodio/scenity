// SPDX-License-Identifier: Apache-2.0
/**
 * The file and project commands of the scene page: `scene.new`, `scene.open`, `scene.save`, `scene.saveAs`,
 * `scene.close`, `sequence.new`, `sequence.open`, `prefab.create`, `prefab.variant`, `material.new` and `project.set`.
 * The person runs them from the menus and the search box; an agent runs them as tools with their arguments. A run with
 * no name or path asks the person in a dialog of the window. A refusal throws a CommandError with the reason.
 */
import { CommandError, sceneTextHash, SETTING_FIELDS, type SettingPath } from "@scenity/editor-core";
import { writeDocument } from "@scenity/scene";
import type { SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import type { EntityDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { Entity } from "@scenity/scene/schema/entity";
import type { WindowNotices } from "../../studio/shell/dialogs";
import { t } from "../../texts";
import type { PageMaterials } from "../material/pageMaterials";
import type { ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import { makeVariantCommand, makePrefabCommand } from "../prefabs/makePrefabCommand";
import type { PagePrefabs } from "../prefabs/pagePrefabs";
import { pageSettings } from "../settings/pageSettings";
import type { PageScenes } from "./pageScenes";

/** What the commands use of the page. */
export interface FileCommandParts {
  readonly editor: ScenePageEditor;
  readonly scenes: PageScenes | null;
  readonly files: SceneFilePort;
  readonly materials: PageMaterials | null;
  readonly selection?: { readonly ids: readonly string[]; set?(ids: readonly string[]): void };
  /** The prefabs of the page (a new prefab keeps its file state). */
  readonly prefabs?: Pick<PagePrefabs, "keep"> | undefined;
  readonly notices: WindowNotices;
  /** The rule check of the page (the project rules on the open scene): a new file carries its results to the gate. */
  readonly checkRules?: (doc: SceneDocument) => Promise<readonly SceneRuleVerdict[]>;
  /** Open a sequence file of the project in the page (a new load of the page). */
  openSequence(path: string): void;
}

/** A file name part of a name: lower case words with hyphens. */
export function fileSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The text argument, else the answer of the person; null when the person cancels. */
export async function textOrAsk(
  notices: WindowNotices,
  args: Readonly<Record<string, unknown>>,
  name: string,
  ask: { readonly title: string; readonly label: string; readonly value?: string },
): Promise<string | null> {
  const given = args[name];
  if (typeof given === "string" && given.trim() !== "") return given.trim();
  const answer = await notices.ask({
    spec: `prompt.${name}`,
    title: ask.title,
    text: "",
    input: { label: ask.label, testId: "command-prompt-input", value: ask.value ?? "" },
    actions: [
      { id: "go", label: t("command-prompt-go"), testId: "command-prompt-go", tone: "primary", needsText: true },
      { id: "cancel", label: t("command-prompt-cancel") },
    ],
    dismiss: "cancel",
  });
  const text = answer?.action === "go" ? answer.text.trim() : "";
  return text === "" ? null : text;
}

/** The reason of a result that is not ok: its words, or the conflict with the file on the disk. */
function saveReason(result: { readonly ok: boolean }): string | null {
  if (result.ok) return null;
  return "reason" in result && typeof result.reason === "string" ? result.reason : t("command-conflict");
}

/** Throw the reason of a refusal. */
function refuse(reason: string | null | undefined): void {
  if (reason !== null && reason !== undefined && reason !== "") throw new CommandError(reason);
}

/** The scene commands: new, open, save, save as, close. */
function sceneCommands(parts: FileCommandParts): PageKeyCommandSpec[] {
  const { scenes, editor, notices } = parts;
  const ready = (): string | null => (scenes === null ? t("command-no-scenes") : null);
  const path = { type: "string", description: t("command-arg-path"), optional: true } as const;
  return [
    {
      id: "scene.new",
      title: t("command-scene-new"),
      menu: "file",
      agents: true,
      args: { name: { type: "string", description: t("command-arg-scene-name"), optional: true } },
      when: ready,
      run: async (args) => {
        const name = await textOrAsk(notices, args, "name", {
          title: t("command-scene-new"),
          label: t("command-name"),
        });
        if (name === null || scenes === null) return;
        const result = await scenes.create(name);
        refuse(saveReason(result));
      },
    },
    {
      id: "scene.open",
      title: t("command-scene-open"),
      menu: "file",
      agents: true,
      args: { path },
      when: ready,
      run: async (args) => {
        const file = await textOrAsk(notices, args, "path", {
          title: t("command-scene-open"),
          label: t("command-path"),
        });
        if (file !== null) refuse(await scenes?.open(file));
      },
    },
    {
      id: "scene.save",
      title: t("command-scene-save"),
      agents: true,
      run: async () => {
        const result = await editor.save();
        refuse(saveReason(result));
      },
    },
    {
      id: "scene.saveAs",
      title: t("command-scene-save-as"),
      menu: "file",
      agents: true,
      args: { path },
      when: ready,
      run: async (args) => {
        const ask = { title: t("command-scene-save-as"), label: t("command-path"), value: editor.file.path };
        const file = await textOrAsk(notices, args, "path", ask);
        if (file === null || scenes === null) return;
        const result = await scenes.saveAs(file);
        refuse(saveReason(result));
      },
    },
    {
      id: "scene.close",
      title: t("command-scene-close"),
      menu: "file",
      agents: true,
      // The × of a scene tab gives its path; with no path the active scene closes.
      args: { path },
      when: ready,
      run: async (args) => {
        const file = typeof args.path === "string" && args.path !== "" ? args.path : undefined;
        const result = await scenes?.close(file);
        refuse(result?.closed === false ? result.reason : null);
      },
    },
  ];
}

/** The prefab document of an entity with its subtree: the entity is the root, at the origin of the prefab. */
export function prefabOf(doc: EntityDocument, root: string, name: string): EntityDocument {
  const ids = [root];
  // The list grows while the loop reads it: each child goes after its parent.
  for (const parent of ids) {
    for (const [id, entity] of Object.entries(doc.entities)) if (entity.parent === parent) ids.push(id);
  }
  const entities: Record<string, Entity> = {};
  for (const id of ids) {
    const entity = doc.entities[id];
    if (entity === undefined) continue;
    if (id !== root) {
      entities[id] = entity;
      continue;
    }
    const transform = { ...(entity.components.transform as Record<string, unknown> | undefined), position: [0, 0, 0] };
    entities[id] = { ...entity, parent: null, index: 0, components: { ...entity.components, transform } };
  }
  return { format: "scenity.prefab/1", id: fileSlug(name) || "prefab", name, root, entities };
}

/** The commands that make a new file: a sequence, a prefab, a material. */
function newFileCommands(parts: FileCommandParts): PageKeyCommandSpec[] {
  const { editor, files, notices, materials } = parts;
  const name = { type: "string", description: t("command-arg-file-name"), optional: true } as const;
  const ask = (title: string): { title: string; label: string } => ({ title, label: t("command-name") });
  const write = async (
    path: string,
    doc: { readonly format: string; readonly [key: string]: unknown },
  ): Promise<string> => {
    const text = writeDocument(doc);
    const verdicts = await parts.checkRules?.(editor.doc);
    const checks = verdicts === undefined ? {} : { checks: { hash: sceneTextHash(text), verdicts } };
    const result = await files.save({ path, text, baseHash: null, ...checks });
    refuse(saveReason(result));
    notices.toast(t("command-file-made", { path }));
    return text;
  };
  return [
    {
      id: "sequence.new",
      title: t("command-sequence-new"),
      menu: "sequence",
      agents: true,
      args: { name },
      run: async (args) => {
        const given = await textOrAsk(notices, args, "name", ask(t("command-sequence-new")));
        if (given === null) return;
        const id = fileSlug(given) || "sequence";
        const path = `sequences/${id}.sequence.json`;
        const scene = editor.doc.id;
        await write(path, { format: "scenity.sequence/1", id, name: given, scene, duration: 10000, tracks: [] });
        parts.openSequence(path);
      },
    },
    // Open another sequence of the project (the sequence picker of the Timeline).
    {
      id: "sequence.open",
      title: t("command-sequence-open"),
      menu: "sequence",
      agents: true,
      args: { path: { type: "string", description: t("command-arg-sequence-path") } },
      run: (args) => {
        const path = typeof args.path === "string" ? args.path.trim() : "";
        if (!path.endsWith(".sequence.json")) throw new CommandError(t("command-sequence-path"));
        parts.openSequence(path);
      },
    },
    // The selection becomes an instance of the new prefab (prefabs/makePrefabCommand.ts).
    makePrefabCommand({ ...parts, write: (path, doc) => write(path, doc) }),
    // A variant of the prefab of the selected instance.
    makeVariantCommand({ ...parts, write: (path, doc) => write(path, doc) }),
    {
      id: "material.new",
      title: t("command-material-new"),
      menu: "assets",
      agents: true,
      args: { name },
      when: () => (materials === null ? t("command-no-materials") : null),
      run: async (args) => {
        const given = await textOrAsk(notices, args, "name", ask(t("command-material-new")));
        if (given === null || materials === null) return;
        const ref = await materials.create(given);
        notices.toast(t("command-file-made", { path: ref }));
      },
    },
  ];
}

/** The project command: set a project value of the editor settings (`scenity.editor.json`). */
function projectCommand(): PageKeyCommandSpec {
  const paths = SETTING_FIELDS.filter((field) => field.scope === "project").map((field) => field.path);
  return {
    id: "project.set",
    title: t("command-project-set"),
    agents: true,
    args: {
      setting: { type: "string", description: t("command-arg-setting"), values: paths },
      value: { type: "string", description: t("command-arg-value") },
    },
    run: async (args) => {
      let value: unknown;
      try {
        value = JSON.parse(String(args.value));
      } catch {
        throw new CommandError(t("command-project-json", { value: String(args.value) }));
      }
      refuse(await pageSettings().set(String(args.setting) as SettingPath, value as never, "project"));
    },
  };
}

/** The file and project commands of the page. */
export function fileCommands(parts: FileCommandParts): PageKeyCommandSpec[] {
  return [...sceneCommands(parts), ...newFileCommands(parts), projectCommand()];
}
