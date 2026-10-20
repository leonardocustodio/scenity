// SPDX-License-Identifier: Apache-2.0
/**
 * The component registry is an instance, not a global. It holds the component definitions of the engine and of the
 * loaded plugins. It finds a definition, checks a value, fills the defaults and upcasts an old value.
 * A component that the registry does not know stays as opaque data with a warning. Thus a document keeps the value of
 * a component from a plugin that is not loaded through read and write.
 */
import { zodErrors, type DocError } from "../errors";
import { mergeDefaults } from "../json";
import type { ComponentDefinition } from "./define";

/** The result of a check of one component value. `value` is the parsed value (or the opaque value). */
export type ComponentCheck =
  | { readonly ok: true; readonly value: unknown; readonly warnings: readonly DocError[] }
  | { readonly ok: false; readonly errors: readonly DocError[] };

export class ComponentRegistry {
  readonly #byId = new Map<string, ComponentDefinition>();

  constructor(definitions: readonly ComponentDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  /** Add a definition. A second definition with the same ID is an error. */
  register(definition: ComponentDefinition): this {
    if (this.#byId.has(definition.id)) throw new Error(`the component "${definition.id}" is registered already`);
    this.#byId.set(definition.id, definition);
    return this;
  }

  get(id: string): ComponentDefinition | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** The definitions in the order of registration. */
  list(): ComponentDefinition[] {
    return [...this.#byId.values()];
  }

  /** The definitions that live at a site (`component`, `entity` or `scene`). */
  atSite(site: ComponentDefinition["site"]): ComponentDefinition[] {
    return this.list().filter((definition) => definition.site === site);
  }

  /** Check a stored value. `path` is the pointer of the value in its document, for the errors. */
  check(id: string, value: unknown, path = ""): ComponentCheck {
    const definition = this.#byId.get(id);
    if (definition === undefined) {
      return { ok: true, value, warnings: [{ path, message: `unknown component "${id}": the value stays as it is` }] };
    }
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error, path) };
    return { ok: true, value: parsed.data, warnings: [] };
  }

  /** The value with the defaults under it. An unknown component gives the value as it is. */
  fill(id: string, value: unknown): unknown {
    const definition = this.#byId.get(id);
    return definition === undefined ? value : mergeDefaults(definition.defaults, value);
  }

  /**
   * Upcast a value of the version `from` to the current version. The result is the new value, or an error for a
   * version that is newer than the definition. An unknown component gives the value as it is.
   */
  upcast(id: string, value: unknown, from: number): { ok: true; value: unknown } | { ok: false; message: string } {
    const definition = this.#byId.get(id);
    if (definition === undefined) return { ok: true, value };
    if (from > definition.version) {
      const message = `the component "${id}" has version ${String(from)}; this Scenity reads up to ${String(definition.version)}`;
      return { ok: false, message };
    }
    let out = value;
    for (let version = from; version < definition.version; version += 1) {
      const step = definition.migrate[version];
      if (step === undefined) return { ok: false, message: `${id}: no upcaster from version ${String(version)}` };
      out = step(out);
    }
    return { ok: true, value: out };
  }
}

/** A registry with the given definitions (by default none; pass `builtinComponents` for the engine set). */
export function createRegistry(definitions: readonly ComponentDefinition[] = []): ComponentRegistry {
  return new ComponentRegistry(definitions);
}
