# @scenity/scene

The documents of Scenity ([docs/formats.md](../../docs/formats.md) gives the formats). The package has the project,
scene, prefab, override, sequence, material and rules documents, their zod schemas and JSON Schema, and the canonical
writer. It also has the reader with migrations, the component registry and the built-in components, the scene ops with
inverses and transactions, and the override layers. It also has the prefabs, the references, the sequence evaluator
and the pure math. The package is pure TypeScript: it imports only zod. It has no three.js, no DOM, no Vue and no
`node:` or `bun:` in `src`.

## Entry points

| Import                           | What                                              |
| -------------------------------- | ------------------------------------------------- |
| `@scenity/scene`                 | All of the API                                    |
| `@scenity/scene/math`            | Vectors, quaternions, Euler angles, TRS matrices  |
| `@scenity/scene/components`      | `defineComponent`, the registry, the built-in set |
| `@scenity/scene/effects`         | The tier caps of the effects (no zod)             |
| `@scenity/scene/ops`             | `applyOps`, transactions, `diffDocuments`         |
| `@scenity/scene/sequence`        | The sequence schema, eases, samples, evaluator    |
| `@scenity/scene/layers`          | Override layers and variants                      |
| `@scenity/scene/paths`           | The relative paths of the documents               |
| `@scenity/scene/project`         | `loadProject`                                     |
| `@scenity/scene/manifest`        | The types of manifest 2, no code                  |
| `@scenity/scene/schema/material` | The material document                             |

## The rules of the documents

- Each document has `format: "scenity.<kind>/<major>"`. The reader upcasts an older major and refuses a newer one
  ("this file has format scenity.scene/2; this Scenity reads up to /1").
- The canonical writer sorts the keys, rounds numbers to a 1e-6 grid, writes `-0` as `0`, uses two spaces and a
  final newline, and puts an array of numbers on one line. Read then write gives the same bytes. The fixtures and the
  schema files are in this form, so `.prettierignore` lists them.
- `entities` is a map by ID; `parent` and `index` give the tree. The indexes of the children of each parent are
  `0..n-1`. A document keeps only the component values that differ from the defaults; `registry.fill` adds them.
- A component has a version. The scene field `versions` lists each component with a version above 1. A component that
  the registry does not know stays as it is, with a warning, so a plugin component round-trips.
- Each edit is an op (`set`, `add`, `remove`, `move`, `addComponent`, `removeComponent`) with a JSON Pointer path.
  `applyOps` does not change its input and gives the inverse op list.
- The IDs of an expanded prefab are `<instance>/<prefab entity>`; an expanded scene is not a document to save.

## The material document

A material asset (`*.material.json`, `scenity.material/1`) has a `type` (`standard`, `physical`, `lambert`, `phong`,
`unlit`), the values of that type (`MATERIAL_FIELDS`: colour, opacity, roughness, clear coat, sheen, transmission,
specular, shininess, …) and `maps`: a texture reference for each slot of the type (`MATERIAL_SLOTS_OF`). A reference
names a texture asset (`asset:<id>`) with an optional `colorSpace` (`srgb` or `linear`; the default comes from the
slot), `repeat` and `offset`. A value or a slot that the type does not take is a reader error with its pointer. The
asset record beside the file gives the ID of the material. The `model` component names a part of a model for a material
override by `mesh:<node name>` or by a material name.

## The rules

A rule is a limit on a metric of `@scenity/rules`: `{ id, metric, args, scope, min, max, unit, level, provisional,
note, known }`. `level` is `block` (a failure stops a save unless the owner gives a reason) or `warn`. The scope kinds
are `scene`, `sequence` (each marker and key time), `range` (`from`, `to` and `step` in ms or marker names), `marker`
and `entity` (the items of the metric for some entities). Rules are in a rules document (`*.rules.json`,
`scenity.rules/1`), in the `rules` list of a scene or a sequence, and in the `rules` list of the project (a rule, or
the path of a rules document). With no scope, a rule of a scene or a project has `scene`, and a rule of a sequence
has `sequence`. `@scenity/rules` (`evaluateRules`, `gateRules`) is the one gate over them.

## Sequences and the evaluator

A sequence (`*.sequence.json`, `scenity.sequence/1`) has `id`, `scene`, `duration` (ms), `loop`, `markers` (name →
ms), `initial` (the initial parameters by simulation plugin ID) and `tracks`. Time is an integer count of ms. The
keys of a track are in time order, and each time is in 0..duration (the reader checks it). The track kinds:

| Kind         | Key fields                                       | Sample                                         |
| ------------ | ------------------------------------------------ | ---------------------------------------------- |
| `property`   | `value`, `ease` (track: `entity`, `path`)        | the value; numbers and number lists ease       |
| `transform`  | `position`, `rotation`, `scale`, `ease`          | each part over its keys; slerp of the rotation |
| `visibility` | `visible`                                        | a step                                         |
| `event`      | `name`, `args`                                   | the last key; play steps give the keys         |
| `action`     | `action` (`<plugin>.<name>`), `args`             | the last key; the simulation plugin reduces it |
| `animation`  | `clip` (asset or null), `speed`, `loop`, `blend` | the active clips with the local clip time      |
| `camera`     | `camera` (`entity:<id>`)                         | the active camera                              |
| `attach`     | `to` (`entity:<id>#<socket or bone>`, or null)   | the attach parent                              |
| `audio`      | `play`, `sound` (asset), `offset` (ms)           | the play key and the start of the sound        |

The ease of a key (`step`, `linear`, `in`, `out`, `inOut` or `{ "bezier": [x1, y1, x2, y2] }`) gives the curve from
the key before it. A curve holds its first value before its first key; a step track gives no value before its first
key. Keys at the same time apply in the order of the file: the track order, then the key order.
Only the property, transform and visibility tracks change values of the scene; the frame state holds the others.

`createEvaluator({ scene, sequence, layers?, topLayers?, simulations?, registry, checkpointMs = 1000 })` gives an
evaluator. `evaluator.at(t, since?)` gives a `FrameState`: the evaluated scene (the base scene, the `layers`, the
sequence values at `t` as one more layer, then the `topLayers`), the layer report, the track samples, the camera, the
attach parents, the active clips, the event and action keys in (since, t], and the state and the `project` output of
each simulation plugin. A `SimulationPlugin<S>` (`id`, `initial`, `reduce`, `settle`, `project?`) reduces the action
keys whose name starts with its ID. The memo keeps the states at each multiple of `checkpointMs`, so a seek replays
at most one step of keys; `clearMemo()` drops it and changes no frame. `sampleTrack(track, t)` gives one track sample
for the lanes and the sequencer UI.

## The animator component

`animator` (`components/animator.ts`) holds a controller and the values of its parameters. The controller has
`parameters` (each with a `type`, `number` or `bool`, and a `default`), `layers` and `stepMs` (the time between two
checks of the transitions, default 50 ms). A layer has a `weight`, a `blend` (`override` or `additive`), an optional
`mask` (bone names, each with its children), a `start` state, `states` and `transitions`. A state plays a `motion`:
`{ kind: "clip", clip }`, `{ kind: "blend1d", parameter, points: [{ at, clip, speed? }] }` or
`{ kind: "procedural", id: "<plugin>.<name>", duration }`, with `speed`, `speedParameter`, `loop` and `events` (a
name at a normalized time). A transition goes `from` a state (or `"*"`) `to` a state when each condition of `when`
holds and the source state passed its `exitTime`, with a crossfade of `duration` ms (default 200). The component also
has `parameters` (the values that differ from the defaults), `speed`, `rootBone`, `rootMotion` (`in-place` or `clip`)
and `footLock` (the legs: `upper`, `lower`, `end`, `follow?`; `contact`, `fade`). The schema checks that each state,
parameter and type that the controller names exists. A sequence keys a parameter with a property track on
`animator/parameters/<name>`. The animator of `@scenity/character/animator` evaluates the controller at a time.

## The character component and the attach keys

`character` (`components/character.ts`) makes the skinned model of the same entity a character: `rig` (a rig profile
of `@scenity/character/profiles`, or `none`; absent: the profile from the bone names), `bones` (the node name of
canonical bones, over the profile; a skeleton with no profile names its bones here), `variants` (named sets of material
overrides) and `variant` (the active one), and `ik` with the goals `leftHand`, `rightHand` (each `target`, `weight`
and an optional `pole` in the frame of the character) and `look` (`target`, `weight`, `maxAngle`). A target is
`entity:<id>` or `entity:<id>#<socket>`. A sequence keys a goal or the variant with property tracks
(`character/ik/rightHand/weight`, `character/variant`).

An attach key (`{ t, to, position?, rotation? }`) puts the entity of its track under `to` from `t`: an entity, a socket
of an entity, or a bone of a character (`entity:robot#rightHand`: a canonical humanoid bone through its rig, else a
node name of its model). `position` and `rotation` give the local place under the parent frame (metres, no scale of
the parent); with neither, the entity keeps its world place of the key time. After a null key the entity stays at its
world place of the key time. The runtime time line applies them (`@scenity/runtime`, `scene/attach.ts`).

The animator has an optional `clipSource` (`{ asset, rig? }`): its controller plays the clips of that model asset,
retargeted onto the model of the entity.

## The audioSource component and the sounds

`audioSource` (`components/audio.ts`) gives an entity a sound: `asset` (an `audio` asset), `volume` (default 1),
`loop`, `spatial` (default true: the sound comes from the world place of the entity), `refDistance` (m, default 1),
`rolloff` (default 1), `maxDistance` and `distanceModel` (the Web Audio values) and `autoplay` (play from t = 0). An
`audio` track plays the sound of its entity: a key `{ t, play: true, sound?, offset? }` starts `sound` (default: the
asset of the component) at `offset` ms into it; the sound plays to its end or to the next key, and `play: false`
stops it. `soundCues(scene, sequence, t, registry)` (`sequence/audio.ts`) gives the voices at `t` in a stable order
(the tracks in file order, `track:<track>:<key>`, then the autoplay entities, `auto:<entity>`), each with its start
on the time line and the component values. `soundPosition(t - start, duration, loop)` gives the position in the
sound, or null before the start and after the end of a sound with no loop: a seek gives the sound of a play. The
duration comes from the file, so the player (`@scenity/runtime/audio`) gives it.

## The locomotion component

`locomotion` (`components/spatial.ts`) gives an actor walks to stand points: `walks` (each `{ t, to }`, with `to` an
`entity:<id>` of a `standPoint`, in time order), `speed` (m/s, default 1), `turnSpeed` (rad/s, default 4) and
`parameter` (the animator parameter of the walk speed, default `speed`). The path goes around the `obstacle`
components; `@scenity/character/walkPlan` gives the place at a time, and the time line of `@scenity/runtime` sets the
transform and the parameter.

## The file map: to change X, edit Y

All paths are under `src/`.

| To change                                                       | Edit                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| IDs, vectors, quaternions, colours, reference patterns          | `schema/common.ts`                                                                  |
| The entity and the op shapes                                    | `schema/entity.ts`                                                                  |
| The scene, prefab and override documents                        | `schema/documents.ts`                                                               |
| The project document                                            | `schema/project.ts`; the loader: `project.ts`                                       |
| The canonical writer and the number grid                        | `canonical.ts`                                                                      |
| The reader (parse, upcast, check)                               | `read.ts`; the component and tree checks: `check.ts`                                |
| A format version and its upcaster                               | `migrations.ts` (`FORMAT_CHAINS`), and a test in `tests/migrations`                 |
| The component definition and the editor hints                   | `components/define.ts`                                                              |
| The registry (lookup, check, defaults, unknown policy)          | `components/registry.ts`                                                            |
| A built-in component                                            | `components/spatial.ts`, `visual.ts`, `shape.ts` or `meta.ts`; the list: `index.ts` |
| The animator component: controller, states, transitions         | `components/animator.ts`                                                            |
| The character component: rig, bones, variants, IK goals         | `components/character.ts`                                                           |
| An op, its checks and its inverse                               | `ops/set.ts` (values), `ops/tree.ts` (tree), `ops/apply.ts` (dispatch)              |
| Transactions                                                    | `ops/apply.ts`                                                                      |
| The diff of two documents ("save as variant")                   | `ops/diff.ts`                                                                       |
| Override layers and variants                                    | `layers.ts`                                                                         |
| Prefabs: expand, unpack, apply the overrides                    | `prefabs.ts`                                                                        |
| The tree helpers and the tree checks                            | `hierarchy.ts`                                                                      |
| JSON Pointer                                                    | `pointer.ts`                                                                        |
| References (`asset:`, `entity:`, `entity:<id>#<sub>`, `scene:`) | `refs.ts`                                                                           |
| Vector, quaternion, Euler and matrix math                       | `math.ts`; world transforms and sockets: `world.ts`                                 |
| Relative paths in documents                                     | `paths.ts`                                                                          |
| The JSON Schema export                                          | `jsonSchema.ts`; the files: `bun packages/scene/scripts/json-schema.ts`             |
| The sequence document: tracks, keys, eases                      | `schema/sequence.ts`                                                                |
| An ease curve                                                   | `sequence/ease.ts`                                                                  |
| The sample of a track (`sampleTrack`)                           | `sequence/sample.ts`; slerp: `math.ts`                                              |
| The sequence values as ops of an override layer                 | `sequence/layer.ts`                                                                 |
| The simulation plugin type, the replay and the checkpoint memo  | `sequence/simulation.ts`                                                            |
| The evaluator and the frame state                               | `sequence/evaluator.ts`                                                             |
| The `audioSource` component                                     | `components/audio.ts`                                                               |
| The sounds of a frame: voices, starts, positions                | `sequence/audio.ts`; the audio sample: `sequence/sample.ts`                         |
| The types of manifest 2: records, files, levels, budgets        | `manifest.ts`; the check: `@scenity/runtime/manifest`                               |

## Tests

`bun test ./packages/scene` (from the repo root). The tests read the fixtures in `tests/fixtures/` (the example
documents, a larger scene, a prefab, an empty project, a project with a plugin, a v0 and a v2 scene, the tour sequence and
a longer walkthrough sequence), check the JSON Schema files with a small validator (`tests/jsonSchemaSubset.ts`) and
run property tests of the ops with a seeded generator (`tests/opGen.ts`). `tests/seekPlay.test.ts` checks that a seek
gives the frame of playback at 1,000 random times (the test plugins and the random sequences are in
`tests/sequenceKit.ts`) and that a 10-minute sequence seeks in less than 5 ms; `SCENITY_CI_TIMING_FACTOR` multiplies
the limit on a slow machine. After a schema change, run `bun packages/scene/scripts/json-schema.ts`; `--check` fails when a file
is not current.
