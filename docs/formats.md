# Document formats

Every file that Scenity reads or writes is JSON (or JSON lines) with a `format` field: `scenity.<kind>/<major>`. This
page gives each kind, its version, where its JSON Schema is and a small example.

## The rules of all documents

- **Versions.** A reader upcasts an older major version through its migrations and refuses a newer one ("this file
  has format scenity.scene/2; this Scenity reads up to /1"). Each component also has its own version; the scene field
  `versions` lists the components above version 1.
- **The canonical writer.** Keys sorted, two spaces, a final newline, numbers rounded to a 1e-6 grid, `-0` written as
  `0`, an array of numbers on one line. Read then write gives the same bytes. The editor, the CLI and the host all
  write this form. Prettier must not touch these files (see `.prettierignore`).
- **Units.** Metres, Y up, right-handed axes (as glTF). Angles in radians, except `camera.fov` in degrees. Rotations
  are unit quaternions `[x, y, z, w]`. Time is an integer count of milliseconds. Colours are `#rrggbb` text.
- **IDs.** An entity, scene or sequence ID matches `^[A-Za-z0-9_-]{1,64}$`. A plugin component, action or metric ID
  starts with the plugin ID and a dot (`demo.spin`).
- **References** are text with a prefix: `asset:<id>`, `entity:<id>`, `entity:<id>#<socket or bone>`, `scene:<id>`.
- **Defaults.** A document keeps only the values that differ from the defaults of the component schema.
- **Paths** in a document are relative to the file that holds them, with `/`.

## The JSON Schemas

The zod schemas in the packages are the source. `bun packages/scene/scripts/json-schema.ts` writes the JSON Schema
files, and `--check` fails when a file is not current. Point your editor at them for completion and checks.

| Kind            | Format                | Usual file name           | JSON Schema                                        |
| --------------- | --------------------- | ------------------------- | -------------------------------------------------- |
| Project         | `scenity.project/1`   | `scenity.project.json`    | `packages/scene/schema/project.schema.json`        |
| Scene           | `scenity.scene/1`     | `*.scene.json`            | `packages/scene/schema/scene.schema.json`          |
| Prefab          | `scenity.prefab/1`    | `*.prefab.json`           | `packages/scene/schema/prefab.schema.json`         |
| Override layer  | `scenity.overrides/1` | `*.overrides.json`        | `packages/scene/schema/overrides.schema.json`      |
| Sequence        | `scenity.sequence/1`  | `*.sequence.json`         | `packages/scene/schema/sequence.schema.json`       |
| Rules           | `scenity.rules/1`     | `*.rules.json`            | `packages/scene/schema/rules.schema.json`          |
| Material        | `scenity.material/1`  | `*.material.json`         | `packages/scene/schema/material.schema.json`       |
| Stream          | `scenity.stream/1`    | `*.stream.jsonl`          | `packages/scene/schema/stream.schema.json`         |
| Input recording | `scenity.input/1`     | `*.input.json`            | `packages/scene/schema/input.schema.json`          |
| Editor settings | `scenity.editor/1`    | `scenity.editor.json`     | `packages/scene/schema/editor.schema.json`         |
| Key map         | `scenity.keymap/1`    | browser storage           | `packages/scene/schema/keymap.schema.json`         |
| Notes           | `scenity.notes/1`     | `<scene>.notes.json`      | `packages/scene/schema/notes.schema.json`          |
| Asset record    | `scenity.asset/1`     | `<source file>.meta.json` | `packages/assets/schema/asset.schema.json`         |
| Approval        | `scenity.approval/1`  | `approvals/*.yaml`        | `packages/assets/schema/approval.schema.json`      |
| Import settings | (inside the record)   | —                         | `packages/assets/schema/<kind>-import.schema.json` |
| Asset manifest  | `scenity.manifest/2`  | `<build>/manifest.json`   | `packages/runtime/schema/manifest.schema.json`     |
| Rights record   | (YAML, no format)     | `rights/<name>.yaml`      | none (checked by `@scenity/assets/rights`)         |

## The project

`scenity.project.json` at the root of the project folder. Only `format`, `id`, `name` and `scenes` are required.

```json
{
  "format": "scenity.project/1",
  "id": "demo",
  "name": "Demo",
  "scenes": ["scenes/main.scene.json"],
  "sequences": ["sequences/tour.sequence.json"],
  "assets": ["assets"],
  "plugins": ["./plugins/demo", "@scenity/physics-runtime"],
  "rules": ["rules/layout.rules.json"],
  "release": { "licences": { "allow": ["CC0-1.0"] } },
  "build": { "assets": { "output": "build" }, "budgets": { "player": { "gzipKB": 63 } } },
  "quality": { "budgets": { "scene": { "medium": { "drawCalls": 50, "triangles": 600000, "workP95Ms": 6 } } } },
  "workbench": {
    "surfaces": [{ "id": "editor", "kind": "scene", "label": "Editor" }],
    "runs": { "check": "scenity check" }
  }
}
```

| Field       | What it gives                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `scenes`    | The scene files. The first one opens by default                                                           |
| `sequences` | The sequence files                                                                                        |
| `assets`    | The asset roots: folders that hold source files and their records                                         |
| `plugins`   | The plugins: a path relative to the project (a folder or a file) or a package name                        |
| `rules`     | The project rules: the path of a rules file, or a rule                                                    |
| `units`     | `{ length: "m", up: "y", assetScale }`                                                                    |
| `quality`   | `tiers` and `budgets` by kind and tier (`triangles`, `bytes`, `drawCalls`, `workP95Ms`, `firstFrameMs` …) |
| `build`     | `assets`: the output folder, the levels of detail, the codecs; `budgets`: a gzip limit per build entry    |
| `release`   | The release gate: `licences` (`allow`, `register`), `rights.review`, `denyTags`, `approvals` (roles)      |
| `workbench` | The surfaces, runs, gate, setup, content roots, denylist, credential file and theme of the workbench      |

## The scene

A scene is a map of entities by ID. `parent` (an ID or `null`) and `index` (the order under the parent, from 0) give
the tree. `environment` holds the scene-level values. `rules` (optional) holds scene rules, `variants` names override
layers, and `poster` names a still for the player.

```json
{
  "format": "scenity.scene/1",
  "id": "main",
  "name": "Demo",
  "environment": { "background": "#1a2433", "toneMapping": "aces", "exposure": 1, "map": "asset:studio_small_09" },
  "entities": {
    "floor": {
      "name": "Floor",
      "parent": null,
      "index": 0,
      "components": { "shape": { "kind": "plane", "size": [6, 0, 6], "colour": "#b9a98f" } }
    },
    "robot": {
      "name": "Robot",
      "parent": null,
      "index": 1,
      "tags": ["actor"],
      "components": {
        "transform": { "position": [0, 0, 0], "scale": [0.25, 0.25, 0.25] },
        "model": { "asset": "asset:01M516A3N0NZMAT1HRKD41JEZ4" }
      }
    },
    "lamp": {
      "name": "Lamp",
      "parent": null,
      "index": 2,
      "components": {
        "transform": { "position": [1, 2, 1] },
        "light": { "type": "point", "intensity": 3, "range": 6 }
      }
    },
    "side": {
      "name": "Side",
      "parent": null,
      "index": 3,
      "components": { "transform": { "position": [4, 1.6, 0] }, "camera": { "fov": 40, "target": [0, 0.5, 0] } }
    }
  }
}
```

The built-in components (`@scenity/scene/components`; the inspector shows each with its fields):

| Component     | What it does                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `transform`   | `position`, `rotation` (quaternion), `scale`, relative to the parent                                      |
| `model`       | A model asset; material overrides by part (`mesh:<node>` or a material name); shadows; `lod`              |
| `shape`       | An engine shape: `box`, `plane`, `cylinder` or `sphere`, with `size`, `colour`, `roughness` or a material |
| `light`       | `directional`, `point`, `spot`, `ambient`, `hemisphere`; colour, intensity, range, target, shadow camera  |
| `camera`      | `fov` (degrees), `near`, `far`, `target` (a point or an entity), `safeFrame`                              |
| `environment` | Scene level: background, tone mapping, exposure, environment map, fog, AO, bloom, anti-aliasing, outline  |
| `socket`      | Named points of an entity (`entity:<id>#<socket>`) for snaps and attach keys                              |
| `visibility`  | `visible`                                                                                                 |
| `pickable`    | `mode` (`mesh` or `bounds`), `layers`, `enabled`, `priority`                                              |
| `obstacle`    | A floor footprint that walks go around                                                                    |
| `standPoint`  | A place where an actor stands, with a `facing`                                                            |
| `path`        | Control points (the debug layer `paths` draws them)                                                       |
| `annotation`  | A note on an entity; `status` (open, done) and `task` (the agent turn that did it) make it a task         |
| `prefab`      | An instance of a prefab file, with its overrides                                                          |
| `animator`    | A state machine of clips: parameters, layers, states, transitions, blends, masks, root motion, foot lock  |
| `character`   | Rig profile, bone names, look variants, IK goals of the hands and the head                                |
| `locomotion`  | Walks at fixed times to stand points, around obstacles                                                    |
| `audioSource` | An audio asset with volume, loop and spatial settings                                                     |

A plugin adds components with `defineComponent` ([plugins.md](plugins.md)). A component that the registry does not
know stays in the file with a warning, so a plugin component round-trips.

## The prefab

A reusable group of entities with one `root`. A scene uses it through an entity with the `prefab` component. The
expanded IDs are `<instance>/<prefab entity>`; an expanded scene is never saved.

```json
{
  "format": "scenity.prefab/1",
  "id": "door",
  "name": "Door",
  "root": "frame",
  "entities": {
    "frame": {
      "name": "Frame",
      "parent": null,
      "index": 0,
      "components": { "model": { "asset": "asset:door_frame" } }
    },
    "leaf": {
      "name": "Leaf",
      "parent": "frame",
      "index": 0,
      "components": { "model": { "asset": "asset:door_leaf" }, "transform": { "position": [-0.45, 0, 0] } }
    }
  }
}
```

## The override layer

A list of ops on top of a scene. Layout variants, per-pane values, URL values and Claude's proposals are override
layers. An override layer never changes the scene file. A scene names its variants in `variants`.

```json
{
  "format": "scenity.overrides/1",
  "scene": "main",
  "ops": [{ "op": "set", "path": "/entities/lamp/components/light/intensity", "value": 4 }]
}
```

The ops: `set` (a value at a JSON Pointer; no `value` removes the key), `add` and `remove` (an entity), `move` (a new
parent or index), `addComponent` and `removeComponent`.

## The sequence

Tracks and keys over time for one scene. `duration` is in ms. `markers` name times. `initial` gives the start state
of each simulation plugin. A sequence can hold `rules` too.

```json
{
  "format": "scenity.sequence/1",
  "id": "tour",
  "scene": "main",
  "duration": 8000,
  "loop": false,
  "markers": { "pickup": 5000 },
  "tracks": [
    {
      "kind": "property",
      "entity": "side",
      "path": "camera/fov",
      "keys": [
        { "t": 0, "value": 40 },
        { "t": 4000, "value": 30, "ease": "inOut" }
      ]
    },
    {
      "kind": "transform",
      "entity": "robot",
      "keys": [
        { "t": 0, "position": [0, 0, 0] },
        { "t": 3000, "position": [1, 0, 0] }
      ]
    },
    {
      "kind": "attach",
      "entity": "cup",
      "keys": [
        { "t": 5000, "to": "entity:robot#rightHand" },
        { "t": 7000, "to": null }
      ]
    },
    {
      "kind": "action",
      "entity": "car-1",
      "keys": [{ "t": 1000, "action": "traffic.car", "args": { "lane": "east" } }]
    }
  ]
}
```

| Track kind   | Keys                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| `property`   | `value`, `ease`; the track has `entity` and `path`                      |
| `transform`  | `position`, `rotation`, `scale`, `ease`                                 |
| `visibility` | `visible` (a step)                                                      |
| `event`      | `name`, `args`                                                          |
| `action`     | `action` (`<plugin>.<name>`), `args`: a simulation reduces it           |
| `animation`  | `clip`, `name`, `speed`, `loop`, `blend`                                |
| `camera`     | `camera` (`entity:<id>`): a cut                                         |
| `attach`     | `to` (`entity:<id>#<socket or bone>` or `null`), `position`, `rotation` |
| `audio`      | `play`, `sound`, `offset`                                               |

An animation key plays a clip of a model, a skinned model or an animation asset (`clip`); `name` names the clip in the
asset (default: its first clip). A clip of another asset than the model of the entity plays retargeted through the
rig profiles. An ease is `step`, `linear`, `in`, `out`, `inOut` or `{ "bezier": [x1, y1, x2, y2] }`. Keys at the same time apply in
file order. An animator parameter is a property track on `animator/parameters/<name>`.

## Rules

A rule is a limit on a metric of `@scenity/rules`. It can sit in a rules file, in the `rules` list of a scene, a
sequence or the project.

```json
{
  "format": "scenity.rules/1",
  "id": "layout",
  "rules": [
    {
      "id": "lampAboveFloor",
      "metric": "distance",
      "args": { "from": "entity:lamp", "to": "entity:floor" },
      "min": 1.5,
      "unit": "m",
      "level": "block",
      "note": "The lamp hangs at least 1.5 m from the floor centre."
    },
    {
      "id": "gripAtPickup",
      "metric": "ikError",
      "args": { "entity": "robot", "goal": "rightHand" },
      "max": 0.02,
      "level": "warn",
      "provisional": true,
      "scope": { "kind": "marker", "marker": "pickup" }
    }
  ]
}
```

- `level`: `block` (a failure stops a save unless the owner gives a reason) or `warn`.
- `scope`: `scene` (the default in a scene or project), `sequence` (each marker and key time; the default in a
  sequence), `range` (`from`, `to`, `step`), `marker` or `entity`.
- The built-in metrics: `distance`, `overlap`, `belowFloor`, `ikError`, `jointAngle`, `reach`, `visible`, `walkway`,
  `routeClear`, `triangleBudget`, `assetRights`. A plugin adds metrics with `defineMetric` ([plugins.md](plugins.md)).
- An override of a failed `block` rule goes into `<scene>.rules-log.jsonl` with the reason and the hash of the scene
  file. It counts only while the file keeps that hash.

## The material

A material asset. `type` is `standard`, `physical`, `lambert`, `phong` or `unlit`. `maps` names a texture asset per
slot. A value that the type does not take is an error. The asset record beside the file gives its ID.

```json
{
  "format": "scenity.material/1",
  "name": "Brushed steel",
  "type": "physical",
  "colour": "#c0c4c8",
  "metalness": 1,
  "roughness": 0.35,
  "maps": { "colour": { "texture": "asset:01J9Z6Q3R8TEX0000000001", "repeat": [4, 4] } }
}
```

## The asset record

`<source file>.meta.json` beside each source file. The ID never changes when the
file moves.

```json
{
  "format": "scenity.asset/1",
  "id": "01M516A3N0NZMAT1HRKD41JEZ4",
  "kind": "model",
  "source": "RobotExpressive.glb",
  "importer": "glb",
  "settings": {},
  "rights": "../../rights/quaternius.yaml",
  "tags": ["character"]
}
```

- `kind`: `model`, `skinned-model`, `animation`, `texture`, `material`, `environment`, `scene`, `prefab`, `audio`, or a
  plugin kind with a prefix.
- `importer` and `settings`: `gltf`, `glb`, `fbx`, `obj`, `blend` (models; settings `scale`, `up`, `origin`,
  `decimate` …), `png`, `jpeg`, `webp`, `avif` (textures), `hdr` (environments), `wav`, `ogg`, `mp3` (audio),
  `material`. Each setting has a default, so `{}` is valid.
- Optional: `rig` (`ue5`, `rigify`, `vrm`, `mixamo` or `none`), `approvals`, `dependencies`, `build` (per-asset codecs
  and levels of detail).
- `scenity assets new-id` gives a new ID.

### The rights record

YAML in `rights/<name>.yaml`; `name` must equal the file name. The release gate needs `source`, `author`, `licence`,
`licenceDate` (YYYY-MM-DD), `allowedUse` with `web`, `webDelivery: true` and an `spdx` ID that the project accepts.

```yaml
name: quaternius
source: "Quaternius, https://quaternius.com"
author: "Quaternius"
licence: "CC0 1.0 Universal (public domain dedication)"
spdx: CC0-1.0
licenceDate: 2026-10-17
allowedUse: [web]
webDelivery: true
```

The record of a generator also has `kind: generated` and `generator: "<generator ID>"`; its web delivery
stays `pending` until the owner reviews the terms of the service.

### The approval

One verdict of one reviewer for a role of `release.approvals`. A change of the source makes it stale.

```yaml
format: scenity.approval/1
asset: 01M516A3N0NZMAT1HRKD41JEZ4
role: art
reviewer: A. Reviewer
date: 2026-10-17
verdict: approved
sourceHash: "<the hash of the asset at the review>"
```

## The asset manifest

`scenity assets build` (and `scenity build`) writes `manifest.json` into the build output. You do not write it. It maps
each asset ID to its levels of detail and files, with their sizes and SHA-256; the runtime checks both before a parse.

```json
{
  "format": "scenity.manifest/2",
  "tiers": ["high", "low"],
  "records": [
    {
      "id": "01M4ZPXYG09E9YQGV2TVA22WQ4",
      "kind": "model",
      "lods": [{ "tier": "high", "file": "01M4ZPXYG09E9YQGV2TVA22WQ4.high.glb", "triangles": 5626, "meshes": 1 }],
      "files": [{ "file": "01M4ZPXYG09E9YQGV2TVA22WQ4.high.glb", "bytes": 700532, "sha256": "a19e…" }],
      "bytes": 700532,
      "sha256": "fa91…",
      "stats": {},
      "tags": ["furniture"]
    }
  ]
}
```

## The stream

A recorded plugin input, played like a sequence (`recordedSource`, `streamSequence`). JSON lines: a header line, then
one line per change.

```text
{"format":"scenity.stream/1","id":"run-1","plugin":"traffic","duration":20000,"fields":{"phase":"step","speed":"linear"}}
{"t":0,"set":{"phase":"red","speed":0}}
{"t":4000,"set":{"phase":"green","speed":12.5}}
```

A `step` field holds its value until the next line; a `linear` number field moves between two lines.

## The input recording

The input events of a play-mode session. A replay gives the same frames as the live session.

```json
{
  "format": "scenity.input/1",
  "id": "spin-clicks",
  "scene": "spin",
  "sequence": "spin",
  "events": [
    { "t": 1200, "kind": "press", "action": "demo.toggle", "entity": "spinner", "point": [-0.9, 1.2, 0.3] },
    { "t": 1300, "kind": "release", "action": "demo.toggle" }
  ]
}
```

## The editor settings

`scenity.editor.json` next to the project file: the settings of the project for each user. The project file wins for
the snaps; the browser storage of each user wins for the personal values. The player never reads it.

```json
{
  "format": "scenity.editor/1",
  "snaps": { "grid": 0.05, "angleDegrees": 15, "scale": 0.1 },
  "camera": { "flySpeed": 2, "orbitSpeed": 1 },
  "view": { "mode": "lit", "grid": true },
  "dock": { "tab": "assets", "height": 30 },
  "layout": { "workspace": "animate" },
  "recent": { "count": 8 },
  "render": { "tier": "high", "backend": "webgl", "worker": true, "gpuTimer": false, "assets": "auto", "audio": true }
}
```

`dock` gives the panel that shows in the bottom area of a new layout of the editor window and its height (rem).
`layout.workspace` (the project wins) is the workspace that a person with no workspace yet opens the project with:
`layout`, `animate`, `assets`, `review` or `build`. `render` (the user wins) gives the options of the render of the editor page that the
address gave before: `tier` (`ultra`, `high`, `medium`, `low`), `backend` (`webgl`, `webgpu`), `worker`, `gpuTimer`,
`assets` (`auto`: the build and the new sources, `build`, `source`) and `audio`. A parameter of the address still wins.

## The key map

The user key map lives in the browser storage of the editor; the **Preferences** panel edits it. The form is a
map from a command ID to its keys (`Mod` is ⌘ on macOS and Ctrl elsewhere). An empty list removes the keys of a
command.

```json
{ "format": "scenity.keymap/1", "keys": { "view.frame": ["G"], "entity.paste": [] } }
```

## The notes

The notes of a scene live in the side file beside the scene file: `scenes/main.notes.json` for
`scenes/main.scene.json` (decision Q10). Only the editor reads it: a note never changes a frame of the player. Each
note has an ID (unique in the file), a text (1 to 2000 characters), a place (`at`: `entity:<id>`, or a world point),
a status (`open` or `done`), an optional author and an optional thread of `replies` (each with a text, an optional
author and the time `at` as an ISO 8601 date and time, the oldest first). The editor writes the file at once at each
change of a note (no undo step); the save of a scene does not touch it. A reply reads the file first, so the replies of
the other people of a team stay.

```json
{
  "format": "scenity.notes/1",
  "scene": "main",
  "notes": [
    { "id": "note-1", "text": "The table needs a cloth", "at": "entity:table", "status": "open" },
    {
      "id": "note-2",
      "text": "A plant here?",
      "at": [2.5, 0, 1.2],
      "status": "done",
      "author": "Ana",
      "replies": [{ "text": "Yes, a tall one", "author": "Bruno", "at": "2026-10-19T10:05:00.000Z" }]
    }
  ]
}
```
