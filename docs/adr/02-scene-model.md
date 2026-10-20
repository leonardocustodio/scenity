# ADR 02: The scene model

- Task: SE2-01 of `docs/generic-engine-plan.md`
- Date: 2026-10-15
- Status: **accepted (provisional)**. The record uses the recommended answers Q3 (an entity tree with typed
  components in JSON), Q4 (zod 4) and Q14 (metres, Y up, right-handed). The owner can change it.

## Context

Today a scene is TypeScript (`WARD_ROOM_A`, `CAMERAS`, `LIGHT`), the props are a closed union of slots, and an editor
save rewrites number literals in source files. A generic engine needs scene data that a tool can read, check, diff and
write, with no code change.

## Decision

1. **A scene is a JSON document of entities in a tree.** `entities` is a map from an entity ID to an entity. An entity
   has `parent` (an entity ID or `null`), `index` (its order under the parent), an optional `name`, optional `tags`
   and `components`. The map form gives each value a stable JSON Pointer
   (`/entities/cart/components/transform/position/0`), so an op, a diff and an override name one value.
2. **Components are typed records.** A component has an ID (`transform`, `light`, `resus.device`), a version, a
   schema (zod), defaults and editor hints. A plugin component ID has the plugin ID as a prefix and a dot. A document
   keeps only the values that differ from the defaults, except where the schema says that a value is required.
3. **IDs.** An entity ID matches `^[A-Za-z0-9_-]{1,64}$` and is unique in its scene. The editor makes IDs from the
   name (`cart`, `cart-2`). An ID never changes when the name changes. Asset IDs are stable IDs of the asset database
   (ADR 03).
4. **Units and axes.** Metres, Y up, right-handed, as glTF. Angles in documents are radians, with one exception: the
   field of view of a camera (`camera.fov`) is in degrees, as in three.js and the editor. Rotations are unit
   quaternions `[x, y, z, w]`. Euler angles (degrees) exist only in the editor widgets.
5. **References.** A reference is a string with a prefix:
   - `asset:<id>`: an asset of the project;
   - `entity:<id>`: an entity of the same scene;
   - `entity:<id>#<socket or bone>`: a socket of an entity or a bone of its skeleton;
   - `scene:<id>`: a scene of the project.
6. **Formats and versions.** Each document has `format: "scenity.<kind>/<major>"` (`scenity.project/1`,
   `scenity.scene/1`, `scenity.prefab/1`, `scenity.overrides/1`, `scenity.sequence/1`). A reader upcasts an older
   major through a chain of migrations and refuses a newer major. Each component has its own version and its own
   migrations.
7. **The canonical writer.** Keys sorted, two-space indent, a final newline, numbers rounded to a grid (1e-6 for
   lengths and quaternion parts, and the same for every other number unless a schema gives another grid), `-0`
   written as `0`. Read then write gives the same bytes.
8. **Schemas.** zod 4 gives the types, the checks and a JSON Schema export (`z.toJSONSchema`). A reader error names
   the JSON path of the bad value.
9. **The scene-level values** (background, tone mapping, exposure, fog, environment map) are the `environment` object
   of the scene document, with the schema of the `environment` component.
10. **Override layers** are lists of ops (ADR 04 gives their place in time). A variant, a per-pane value, a URL value
    and a proposal are override layers. An override never changes the scene file.

## Examples

The examples are in §3.2 of the plan: the project, the scene, the override layer and a resus device entity.

## Notes from the implementation (SE2-02 to SE2-08)

- A scene has an optional `versions` map from a component ID to its version; a component that is not in it is version 1.
- `tags` is a field of the entity, and `environment` a field of the scene; neither is in `components`.
- A `set` op with no `value` removes the key. `set` cannot change `parent`, `index` or a whole entity: those need
  `move`, `add` and `remove`.
- A prefab root goes under its instance entity, after the children of the instance. An expanded entity has the ID
  `<instance>/<prefab entity>`; an unpacked one gets `<instance>-<entity>` (with `-2`, `-3` when the ID is taken).

- SE6-07 adds the built-in `animator` component: a controller (parameters, layers of states and transitions, 1D
  blends) and its parameter values. A sequence keys a parameter with a property track on `animator/parameters/<name>`.
  The clip names in a controller are the animation names of the model asset, not asset references.
- SE6-08 adds the built-in `character` component (rig profile, bone names, look variants, IK goals of the hands and
  the head) and the optional `position` and `rotation` of an attach key. A bone in `entity:<id>#<bone>` is a canonical
  humanoid bone through the rig of the character, else a node name of its model; a socket point comes first.
- SE6-13 adds the built-in `audioSource` component: an `audio` asset, the volume, the loop, the spatial settings
  (`spatial`, `refDistance`, `rolloff`, `maxDistance`, `distanceModel`) and `autoplay`. The page plays the sounds on
  the main thread; an `audio` track of a sequence plays and stops them.
- SE6-09 adds the built-in `locomotion` component: walks at fixed times to `standPoint` entities, around the `obstacle`
  components. The `facing` of a stand point is a yaw where 0 faces -Z, so an actor there has the yaw facing + π.

## Consequences

- The resus room becomes a scene document (SE2-10); its code reads its kit from the document.
- The editor writes documents (SE5-02); `tune-apply` stays only for code constants of plugins (decision Q6).
- A component change needs a migration and a version step.

## Notes from UI7-08 (prefab variants and nested prefabs)

- A variant of a prefab needs no new field: it is a prefab with one root, an instance of the base prefab with the
  overrides of the variant. An instance of the variant expands to the base entities under the variant root
  (`<instance>/<variant root>/<base entity>`), so a change of the base reaches each variant.
- The source of a nested instance is relative to the prefab file that holds it. A new prefab from the selection gets
  each nested source again from its own file, so it names the same prefab file.
