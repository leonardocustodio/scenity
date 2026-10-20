// SPDX-License-Identifier: Apache-2.0
/**
 * The importer registry: the importers of a project, by name and by file extension. An importer reads one
 * source file with its settings and writes its files into an output folder. The record of an asset names its importer
 * (`importer`), and its `settings` follow the schema of that importer. A plugin can register more importers.
 */
import { zodErrors, type DocError } from "@scenity/scene";
import type { z } from "zod";

/** Run Blender with arguments and more mounted folders (`runBlender` of `blender/run.ts`, or a test double). */
export type BlenderRunner = (args: readonly string[], mounts: readonly string[]) => void;

/** The input of one import. All paths are absolute. */
export interface ImportContext<S> {
  /** The asset ID of the record. */
  readonly id: string;
  /** The asset kind of the record. */
  readonly kind: string;
  /** The source file. */
  readonly source: string;
  /** The output folder: it exists and is empty. */
  readonly outDir: string;
  /** The settings, with the defaults of the schema. */
  readonly settings: S;
  readonly blender: BlenderRunner;
}

/** The result of one import: the files in the output folder, the warnings and a report for people. */
export interface ImporterResult {
  /** The file names in the output folder, in sorted order. The first main file is the input of the build. */
  readonly files: readonly string[];
  readonly warnings: readonly string[];
  readonly report: Readonly<Record<string, unknown>>;
}

export type SettingsResult =
  | { readonly ok: true; readonly settings: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly errors: readonly DocError[] };

/** One importer of the registry. */
export interface Importer {
  /** The name in the `importer` field of a record: lower-case letters, digits, `-` and `.`. */
  readonly name: string;
  /** A change of the version imports each asset of this importer again. */
  readonly version: number;
  /** The file extensions, in lower case with the dot (`.glb`). */
  readonly extensions: readonly string[];
  /** The asset kinds that the importer makes. The first kind is the kind of a new record. */
  readonly kinds: readonly string[];
  /** The zod schema of the settings, for the JSON Schema export. */
  readonly schema: z.ZodType;
  /** Check the settings of a record and add the defaults. Each error path starts with `/settings`. */
  parseSettings(raw: unknown): SettingsResult;
  /** Import one source file. The settings are a result of `parseSettings`. */
  run(context: ImportContext<Readonly<Record<string, unknown>>>): Promise<ImporterResult>;
}

/** The definition of an importer with typed settings. */
export interface ImporterSpec<S> {
  readonly name: string;
  readonly version: number;
  readonly extensions: readonly string[];
  readonly kinds: readonly string[];
  readonly schema: z.ZodType<S>;
  run(context: ImportContext<S>): Promise<ImporterResult>;
}

/** Make an importer from a definition with typed settings. */
export function defineImporter<S extends Readonly<Record<string, unknown>>>(spec: ImporterSpec<S>): Importer {
  return {
    name: spec.name,
    version: spec.version,
    extensions: spec.extensions,
    kinds: spec.kinds,
    schema: spec.schema,
    parseSettings(raw) {
      const parsed = spec.schema.safeParse(raw ?? {});
      return parsed.success
        ? { ok: true, settings: parsed.data }
        : { ok: false, errors: zodErrors(parsed.error, "/settings") };
    },
    // The settings come from parseSettings, so they have the type of the schema.
    run: (context) => spec.run(context as ImportContext<S>),
  };
}

/**
 * True when a value is an importer. The `importers` of the host face of a plugin can give values of any form, so the
 * registry takes only a value with each part of an importer.
 */
export function isImporter(value: unknown): value is Importer {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<Importer>;
  const words = (list: unknown): boolean =>
    Array.isArray(list) && list.length > 0 && list.every((word) => typeof word === "string");
  return (
    typeof item.name === "string" &&
    /^[a-z0-9][a-z0-9.-]*$/.test(item.name) &&
    Number.isInteger(item.version) &&
    words(item.extensions) &&
    (item.extensions ?? []).every((extension) => /^\.[a-z0-9.]+$/.test(extension)) &&
    words(item.kinds) &&
    typeof (item.schema as { safeParse?: unknown } | undefined)?.safeParse === "function" &&
    typeof item.parseSettings === "function" &&
    typeof item.run === "function"
  );
}

/** The extension of a file name in lower case with the dot, or "" when it has none. */
export function extensionOf(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** The importers by name and by extension. */
export class ImporterRegistry {
  readonly #byName = new Map<string, Importer>();
  readonly #byExtension = new Map<string, Importer>();

  constructor(importers: readonly Importer[] = []) {
    for (const importer of importers) this.register(importer);
  }

  /** Add an importer. Throws when its name or one of its extensions has an importer already. */
  register(importer: Importer): this {
    if (this.#byName.has(importer.name)) throw new Error(`the importer ${importer.name} is registered already`);
    for (const extension of importer.extensions) {
      const other = this.#byExtension.get(extension);
      if (other !== undefined) throw new Error(`${extension} has the importer ${other.name} already`);
    }
    this.#byName.set(importer.name, importer);
    for (const extension of importer.extensions) this.#byExtension.set(extension, importer);
    return this;
  }

  /** The importer of a name, or undefined. */
  get(name: string): Importer | undefined {
    return this.#byName.get(name);
  }

  /**
   * The importer of the extension of a file name (or of an extension such as `.glb`), or undefined. A registered
   * extension with two parts (`.material.json`) comes before the last part of the name.
   */
  forFile(file: string): Importer | undefined {
    const lower = file.toLowerCase();
    if (/^\.[^/]+$/.test(lower)) return this.#byExtension.get(lower);
    const double = /[^./][^./]*(\.[^./]+\.[^./]+)$/.exec(lower.slice(lower.lastIndexOf("/") + 1))?.[1];
    return (
      (double === undefined ? undefined : this.#byExtension.get(double)) ?? this.#byExtension.get(extensionOf(file))
    );
  }

  /** The importers in the order of registration. */
  list(): Importer[] {
    return [...this.#byName.values()];
  }

  /** The extensions that an importer reads, in sorted order. */
  extensions(): string[] {
    return [...this.#byExtension.keys()].sort();
  }
}
