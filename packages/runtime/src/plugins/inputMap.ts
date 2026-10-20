// SPDX-License-Identifier: Apache-2.0
/**
 * The input map of a plugin: the input actions of the play mode. The play mode of the scene page and the player
 * (`@scenity/runtime/pageInput`) change the DOM events into input events of these actions. The systems read the
 * events of each step as `ctx.inputs` (`StepInputs` of `@scenity/scene/input`). The editor keys are a different map:
 * the editor does not read this one.
 *
 *     export const inputMap = defineInputMap({
 *       keys: { "demo.faster": ["ArrowUp"], "demo.slower": ["ArrowDown"] },
 *       pointer: { "demo.toggle": { component: "demo.spin" } },
 *     });
 *     export default defineRuntimePlugin({ id: "demo", inputMap, systems: [spinSystem] });
 *
 *     // In a system: one toggle for each press in the step, and a speed while the key stays down.
 *     for (const press of ctx.inputs?.pressed("demo.toggle") ?? []) toggle(press.entity);
 *     if (ctx.inputs?.held("demo.faster") === true) speed += 1;
 *
 * A key gives `press` at its first keydown (no key repeat) and `release` at its keyup. A pointer action gives `press`
 * at a pointerdown on a hit that matches it, with the entity and the world point of the hit, and `release` at the
 * pointerup. No document holds the map: it is code of the plugin, as the systems are. A plugin imports the light
 * module `@scenity/runtime/inputMap` (no zod, no plugin host).
 */

/**
 * The pattern of an action name: `ACTION_PATTERN` of `@scenity/scene/sequence` (a test keeps the two equal). The copy
 * keeps zod out of the chunk of a plugin.
 */
export const INPUT_ACTION_PATTERN = /^[a-z][A-Za-z0-9-]{0,63}\.[A-Za-z0-9_.:-]{1,64}$/;

/** A pointer action: a button press on an entity. */
export interface PointerBinding {
  /** Only an entity with this component gives the action. Absent: each hit, and a press on no entity. */
  readonly component?: string;
  /** The button of the pointer event (0 is the main button). Default 0. */
  readonly button?: number;
}

/** The input map of a plugin: the key codes of each key action and the binding of each pointer action. */
export interface InputMap {
  /** The `KeyboardEvent.code` values of each action (`"ArrowUp"`, `"KeyW"`, `"Space"`). */
  readonly keys?: Readonly<Record<string, readonly string[]>>;
  readonly pointer?: Readonly<Record<string, PointerBinding>>;
}

/** The action names of a map, sorted. */
export function inputActions(map: InputMap): string[] {
  return [...new Set([...Object.keys(map.keys ?? {}), ...Object.keys(map.pointer ?? {})])].sort();
}

/** Make the input map of a plugin. An action name that is not `<plugin ID>.<name>` throws. */
export function defineInputMap(map: InputMap): InputMap {
  for (const action of inputActions(map)) {
    if (!INPUT_ACTION_PATTERN.test(action)) throw new Error(`"${action}" is not an action name (<plugin>.<name>)`);
  }
  return map;
}

/** The actions of the maps for a key code, in the order of the maps, then of the names. */
export function keyActions(maps: readonly InputMap[], code: string): string[] {
  return maps.flatMap((map) =>
    Object.keys(map.keys ?? {})
      .sort()
      .filter((action) => map.keys?.[action]?.includes(code) === true),
  );
}

/**
 * The pointer actions of the maps for a press of `button` on a hit. `components` lists the components of the hit
 * entity, or is null for a press on no entity.
 */
export function pointerActions(
  maps: readonly InputMap[],
  button: number,
  components: readonly string[] | null,
): string[] {
  return maps.flatMap((map) =>
    Object.keys(map.pointer ?? {})
      .sort()
      .filter((action) => {
        const binding = map.pointer?.[action];
        if (binding === undefined || (binding.button ?? 0) !== button) return false;
        return binding.component === undefined || (components?.includes(binding.component) ?? false);
      }),
  );
}
