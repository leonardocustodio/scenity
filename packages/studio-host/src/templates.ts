// SPDX-License-Identifier: Apache-2.0
/**
 * The project templates as data: the templates of the person and of the plugins, beside the
 * built-in templates of the Hub (`empty`, `showroom` and the samples, which `scenity create --template` makes).
 *
 * - A template of the person is a folder `templates/<id>/` of the studio state: a copy of a project folder ("Save as
 *   a template" of the Hub) with `template.json` (the title and the description).
 * - A template of a plugin is a folder in a plugin package of the checkout: the field `scenity.templates` of its
 *   package.json lists `{ id, title, description, folder }` (the folder is relative to the package and in it).
 *
 * The new project wizard makes a project from a template with `scenity create --from <folder>`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { templateFolderFiles } from "@scenity/cli/folderTemplates";
import { z } from "zod";
import { projectPicture } from "./registry";

/** A template of the person or of a plugin. */
export interface TemplateInfo {
  /** `user:<id>` or `plugin:<package>/<id>`. */
  readonly id: string;
  readonly source: "user" | "plugin";
  readonly title: string;
  readonly description: string;
  /** The template folder (a project folder). */
  readonly dir: string;
  /** The picture of the template (a path relative to its folder), or null. */
  readonly picture: string | null;
}

const TEMPLATE_FILE = "template.json";
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const templateFile = z.object({
  format: z.literal("scenity.template/1"),
  title: z.string().min(1).max(80),
  description: z.string().max(400).default(""),
});

const pluginTemplates = z.array(
  z.object({
    id: z.string().regex(ID),
    title: z.string().min(1).max(80),
    description: z.string().max(400).default(""),
    folder: z.string().min(1),
  }),
);

/** The folder of the templates of the person in the state folder. */
export const userTemplatesDir = (stateDir: string): string => join(stateDir, "templates");

/** The templates of the person. The list does not include a folder that the studio cannot read. */
export function userTemplates(stateDir: string): TemplateInfo[] {
  const root = userTemplatesDir(stateDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .flatMap((id) => {
      const dir = join(root, id);
      try {
        const file = templateFile.parse(JSON.parse(readFileSync(join(dir, TEMPLATE_FILE), "utf8")));
        const picture = projectPicture(dir);
        return [
          { id: `user:${id}`, source: "user" as const, title: file.title, description: file.description, dir, picture },
        ];
      } catch {
        return [];
      }
    });
}

/** The package folders of the plugins of a checkout (`plugins/<name>/<face>` and `plugins/<name>`). */
function pluginPackages(checkout: string): string[] {
  const root = join(checkout, "plugins");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(root, entry.name);
      const faces = readdirSync(dir, { withFileTypes: true })
        .filter((face) => face.isDirectory() && face.name !== "node_modules")
        .map((face) => join(dir, face.name));
      return [dir, ...faces].filter((folder) => existsSync(join(folder, "package.json")));
    });
}

/**
 * The templates of the plugins of a checkout. The list does not include a folder outside its package or a folder with
 * no project file.
 */
export function pluginTemplateList(checkout: string | null): TemplateInfo[] {
  if (checkout === null) return [];
  return pluginPackages(checkout).flatMap((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: string;
      scenity?: { templates?: unknown };
    };
    const listed = pluginTemplates.safeParse(manifest.scenity?.templates ?? []);
    if (!listed.success || manifest.name === undefined) return [];
    return listed.data.flatMap((template) => {
      const folder = resolve(dir, template.folder);
      const inside = !relative(dir, folder).startsWith("..") && existsSync(join(folder, "scenity.project.json"));
      if (!inside) return [];
      const { title, description } = template;
      const id = `plugin:${manifest.name ?? ""}/${template.id}`;
      return [{ id, source: "plugin" as const, title, description, dir: folder, picture: projectPicture(folder) }];
    });
  });
}

/** Each template of the person and of the plugins. */
export function listTemplates(stateDir: string, checkout: string | null): TemplateInfo[] {
  return [...userTemplates(stateDir), ...pluginTemplateList(checkout)];
}

/** An ID for a title that no template of the person has. */
function freeId(stateDir: string, title: string): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "template";
  const root = userTemplatesDir(stateDir);
  let id = base;
  for (let count = 2; existsSync(join(root, id)); count += 1) id = `${base}-${String(count)}`;
  return id;
}

/** Save a project folder as a template of the person; the result is the new template. */
export function saveTemplate(
  stateDir: string,
  projectDir: string,
  input: { readonly title: string; readonly description: string },
): TemplateInfo {
  const meta = templateFile.parse({ format: "scenity.template/1", ...input });
  if (!existsSync(join(projectDir, "scenity.project.json"))) throw new Error(`${projectDir} is not a project folder`);
  const id = freeId(stateDir, meta.title);
  const dir = join(userTemplatesDir(stateDir), id);
  for (const path of [...templateFolderFiles(projectDir), "package.json"]) {
    const from = join(projectDir, ...path.split("/"));
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, ...path.split("/"), ".."), { recursive: true });
    cpSync(from, join(dir, ...path.split("/")));
  }
  writeFileSync(join(dir, TEMPLATE_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  const { title, description } = meta;
  return { id: `user:${id}`, source: "user", title, description, dir, picture: projectPicture(dir) };
}

/** The folder of a template ID, or null. */
export function templateDir(stateDir: string, checkout: string | null, id: string): string | null {
  return listTemplates(stateDir, checkout).find((template) => template.id === id)?.dir ?? null;
}
