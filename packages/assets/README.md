# @scenity/assets

The asset tools of Scenity: the asset database, importers, the build, stills and rights. Bun and Blender. The package
can import only `@scenity/scene` and `@scenity/labs-platform` from the workspace; `node:` and `bun:` are fine. It imports no plugin, and it names no domain:
a project gives its asset list, budgets, paths and checks (the room plugin of CodeBlue: its `assets` part).

The package has these parts:

- the asset record and the asset database;
- the build, the Blender runs and scripts, and the rights checks;
- the importer registry and the import settings;
- the build of a project, with its levels of detail, codecs and budgets from the project file;
- the asset stills: a picture of each asset and its stamp;
- the release gate: the licence rules and the approval roles of the project, and the approval records;
- the glTF export of a scene: one GLB file that other tools and engines open;
- the asset sources (Poly Haven) and the import of a file into a project.

| Entry point                     | What it has                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@scenity/assets`               | The asset record, the asset database, the watcher, the IDs                                                                                       |
| `@scenity/assets/build`         | The build of a project, the pipeline, the settings, optimize, textures, the image decoders, the model cache, the generic checks, outputs, stamps |
| `@scenity/assets/blender`       | `runBlender`, the export of a master, the import of a dropped file, the prop import settings                                                     |
| `@scenity/assets/import`        | The importer registry, the built-in importers, the import settings, `importAsset`                                                                |
| `@scenity/assets/release`       | The approval records, the release gate with the rules of the project                                                                             |
| `@scenity/assets/rights`        | The rights records, the licence register and the rights checks                                                                                   |
| `@scenity/assets/stills`        | The asset stills: the plan (which assets, which input file, the input hash), the stamps and the make step with a renderer of the caller          |
| `@scenity/assets/export`        | The glTF export of a scene: `exportScene` of a project, `writeSceneGltf` of a scene document                                                     |
| `@scenity/assets/threeDiet`     | The Vite plugin that removes dead parts of three.js (the editor build)                                                                           |
| `@scenity/assets/sources`       | The asset sources, Poly Haven, and the import of an item of a source                                                                             |
| `@scenity/assets/projectImport` | The import of a dropped or chosen file into a project: the file, the record, the import                                                          |
| `@scenity/assets/cli`           | The CLI of the asset database (`index`, `used-by`, `missing`, `new-id`, `import`, `build`, `stills`, `release-check`, `export`)                  |

## The build

`buildProject(projectDir, options)` builds each asset of a project. The asset database gives the records, and
the project file gives the settings (`resolveBuildSettings`):

```json
{
  "quality": { "budgets": { "model": { "high": { "triangles": 40000, "bytes": 1200000, "maxTextureSize": 2048 } } } },
  "build": {
    "assets": {
      "output": "build",
      "lods": [{ "tier": "high" }, { "tier": "low", "ratio": 0.5, "textureScale": 0.5 }],
      "codecs": { "color": "etc1s", "normal": "uastc", "data": "etc1s", "environment": "rgbe" },
      "extensions": ["KHR_materials_transmission"],
      "generator": "My project"
    }
  }
}
```

- `quality.budgets` gives the budgets by asset kind and then by tier (`triangles`, `bytes`, `maxTextureSize`; a
  missing value has no limit). A level with a ratio under 1 keeps fewer triangles to stay in the triangle budget.
- `build.assets.lods`: the levels of detail from the full model to the smallest (1 to 8). Each level starts from the
  source: `ratio` (the part of the triangles), `textureScale` and `maxTextureSize` per role. A missing value of level
  `i` is `0.5^i` and the largest edges `color 2048`, `normal 512`, `data 1024`, halved `i` times. The default is two
  levels, `high` and `low`.
- `codecs`: the KTX2 codec (`etc1s` or `uastc`) of each texture role (`color`: sRGB colours, `normal`, `data`: linear
  data such as ORM); `environment: "rgbe"` keeps the Radiance HDR file. The default: ETC1S, UASTC for normal maps.
- `extensions`: more glTF extensions that the loader of the project reads (the default is the trimmed GLTFLoader).
- `output`: the folder of the built files (default `build`; a scan of the asset roots skips it).
- A record can change the settings of its asset: `"build": { "codecs": { "color": "uastc" }, "lods": 1 }` (the first
  levels of the project).

| Kind                     | Input                                                                            | Built files               |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------- |
| `model`, `skinned-model` | the import `.scenity/imports/<id>/model.glb` when it is current, else the source | `<id>.<tier>.glb` a level |
| `animation`              | the same; the byte budget of the first tier                                      | `<id>.glb`                |
| `texture`                | the source (PNG, JPEG, WebP, AVIF), the role and size from its import settings   | `<id>.ktx2`               |
| `environment`            | the source Radiance HDR file                                                     | `<id>.hdr`                |
| `audio`                  | the source WAV, Ogg or MP3 file; `duration` (s), `channels`, `sampleRate` stats  | `<id>.<ext>`              |
| `material`               | the source material document; the texture assets in the record `dependencies`    | `<id>.material.json`      |

The build also writes manifest 2: `manifest.json` in the output folder, one record for each built asset with
its files, its levels of detail, the facts of the build (the duration of a clip) and the tags of its asset record.
`buildProject` gives it as `manifest`, and the `manifest.json` file is one of `files` (not an output of an asset). The
record format and the run-time check are in `@scenity/runtime/manifest` (the types: `@scenity/scene/manifest`). The
built files keep the names `<id>.<tier>.glb`: the names hold the asset ID, and `sha256` of each record gives the
version, so a content-addressed name is not necessary yet. A content set with no project file gives its record drafts
to the same writer (`assetManifest`, `assetRecord`, `manifestText`).

The build runs the importer of each model first (an import with the same key does nothing; `runImports: false` reads
a current import, else the source). The texture images of a model can be PNG, JPEG, WebP or AVIF (`images.ts`: fast-png,
jpeg-js and the WASM decoders of jSquash, so each machine decodes the same pixels). The same sources and settings give
the same bytes. The asset database lists the files `<id>.*` of the output folder as the `outputs` of each entry.

`runPipeline({ jobs, lods, exportFolder, builtFolder, listName, cache, extensions })` is the part under it, which a
content set with no project file also calls (the room plugin of CodeBlue: its `assets` part, with `parseBuildSettings`). A
model job names its ID, its input (bytes, else `<exportFolder>/<id>.glb`), its budgets per tier, its levels and its
optimize options (the socket names, the generator text, the codecs); a clip job names its byte budget. The pipeline
optimizes each model for each level (KTX2 textures, the LOD, meshopt) through `ModelCache` (a folder that the caller
gives), and runs the generic checks: the glTF validator, the budgets, KTX2 only, the glTF extensions of the loader, one
animation per clip. It gives the files, the built models and clips with the entries of the caller, and the findings;
the project adds its checks and writes its manifest (`writeOutput`, `compareWithWritten`). `rightsFindings` checks the
rights records of the owners that the project lists (and the release gate).

The vendored copies of three.js parts: `bun packages/assets/src/build/trimGltf.ts <target> [--check]` and
`bun packages/assets/src/build/patchBasis.ts <target> [--check]` (the repo: `packages/render/src/vendor`).

## The stills

Each model, environment and texture asset of a project has a still: a WebP picture of 320 × 240 pixels in
`<project>/stills/<id>.webp`, which the content browser of the editor shows. The stills are in Git, as the build
outputs and the tile pictures of the lab are. The render needs a GPU, so this package does not draw: it plans the
stills and keeps their stamps, and the caller gives the renderer.

| Kind                     | The still                                                   | The file that the renderer draws                     |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| `model`, `skinned-model` | a framed view from the bounds, on a neutral background      | the current import `model.glb`, else the glTF source |
| `environment`            | the map behind a mirror sphere and a matte sphere           | the source HDR file                                  |
| `texture`                | the image scaled to fit (an HDR texture: as an environment) | the source image                                     |

The other kinds have no still. The stamp file `stills/stills.json` keeps, for each still, the input hash (the source
hash, the importer and its settings with the defaults, and the SHA-256 of each build output of the asset) and the
version of the renderer. A still is **stale** when one of them changed, and **missing** when its file does not exist.
The hash does not name the input file, because the imports are local (`.scenity` is not in Git).

- `planStills(projectDir, { renderer })` gives a job for each still with its state; `renderer` is optional (without
  it, the plan does not compare the renderer version).
- `makeStills(projectDir, renderer, { ids, force })` draws each missing or stale still with
  `renderer.render(job)` (the WebP bytes), writes the file and its stamp, and removes the stills of IDs that have no
  asset. `open` and `close` of the renderer run only when a still needs a render.
- The editor draws them: `bun apps/editor/scripts/stills/assetStills.ts <projectDir> [id ...] [--force]` opens the
  still page (`apps/editor/still.html`) in Chromium with the GPU lock of the tools. Its version is the hash of the
  page files, so a change of the page makes each still stale; `--check` also compares it.

## The glTF export of a scene

`exportScene(projectDir, scene, options)` gives one GLB file of a scene: `scene` is the ID of a scene of the
project or the path of a scene file. The export expands the prefabs and writes the entity tree (`export/writer.ts`):

- One node for each entity, with the entity ID as its name, the local transform of the document and `extras` with
  `entity`, `name`, `tags` and `components` (the component IDs). The scene keeps its ID and `environment` in its extras.
- The components are child nodes: `<entity>:shape` (a mesh with the geometry of the runtime presenter),
  `<entity>:model` (the nodes of the default scene of the model, with its meshes, materials and textures, and the
  material overrides), `<entity>:light` (KHR_lights_punctual), `<entity>:camera` (a perspective camera) and
  `<entity>#<socket>` (an empty node). A light or a camera with a target gets the rotation to it on its child node, so
  the node of the entity keeps the transform of the document.
- A model reads the current import of its asset, else its glTF or GLB source (as the build), not the built files: their
  KTX2 textures and the meshopt compression do not open in most tools. `runImports: false` does not run the importers.
- `visibility: false` is KHR_node_visibility. An ambient or a hemisphere light has no glTF form: its node keeps the
  values in `extras.light`, with a warning. The units and axes are the units and axes of glTF, so nothing converts.
- Two exports of the same files give the same bytes. The dedup step shares the meshes of a model used two times.

Blender reads the file with its glTF importer (Z up: a glTF point `(x, y, z)` is `(x, -z, y)` in Blender).
`blender/gltf_world.py` imports a GLB file and prints the world place of each object; `tests/exportBlender.test.ts`
compares it with the document.

## Blender

`runBlender(args, mounts)` runs Blender 5.2: `BLENDER` (a path), else the Blender app of macOS, else the toolchain
image (`toolchain/Dockerfile`; `BLENDER=docker` forces it). The arguments use paths relative to the workspace root.
The scripts in `blender/`: `export.py` (one master to GLB, fixed settings, `--kind model|skinned-model|animation`),
`import_drop.py` (a dropped FBX, OBJ, .blend or glTF file), `gltf_world.py` (the world place of each object of a GLB
file, the check of the glTF export), `import_fbx_prop.py` (the master of a bought prop; the paths
of the spec are relative to `--root`) and `master_io.py` (the helpers that the importers of a plugin also import).
`blender/tests/run.py` runs the Blender tests of this folder and of each folder after `--`.

## The asset record

Each source file has a record beside it: `<source file>.meta.json`, format `scenity.asset/1`, in the form of the
canonical writer of `@scenity/scene`.

```json
{
  "format": "scenity.asset/1",
  "id": "01J9Z6Q3R9",
  "kind": "model",
  "source": "chair.fbx",
  "importer": "fbx",
  "settings": { "scale": 0.01 },
  "rights": "rights/kenney-furniture.yaml",
  "tags": ["furniture"],
  "approvals": ["approvals/chair.yaml"],
  "dependencies": ["asset:01J9Z6Q3RA"]
}
```

- `id`: 10 to 26 letters, digits, `_` or `-`. A new asset gets a ULID (`newAssetId`). The ID stays when the source
  and its record move or get a new name.
- `kind`: a built-in kind (`model`, `skinned-model`, `animation`, `texture`, `material`, `environment`, `scene`,
  `prefab`, `audio`) or a plugin kind with a prefix (`acme.clip-family`).
- `source`, `rights` and each approval are paths relative to the record. `settings` follows the schema of the
  importer (see "The importers"); the record schema keeps it as an object. `approvals` (the approval records,
  see "The release gate") and `dependencies` are optional.
- `build` (optional): the build settings of this asset: `codecs` (the codec of a texture role) and `lods` (the
  number of levels of detail of the project that the asset keeps).

## The asset database

`AssetDatabase.open(projectDir)` reads `scenity.project.json` and scans the asset roots (`assets` of the project) for
`*.meta.json` and the project folder for the documents (the listed scenes and sequences, and each `*.scene.json`,
`*.prefab.json`, `*.sequence.json` and `*.material.json`). All paths are relative to the project folder.

| Call                    | Result                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `entries()`, `get(id)`  | The index: ID, kind, tags, record path, source path, hash, files, dependencies, outputs         |
| `findByPath(path)`      | The entry of a source path or a record path                                                     |
| `usedBy(id)`            | The `asset:` references in the documents: the document, the JSON Pointer and the entity         |
| `dependencies(id)`      | The asset IDs that the record lists in `dependencies`                                           |
| `dependents(id)`        | The assets whose records list the asset                                                         |
| `missing()`             | The references (documents and record dependencies) to an ID that no record has                  |
| `problems()`            | Bad records, duplicate IDs, missing sources, missing glTF files, broken references, bad docs    |
| `update(paths)`         | Read the changed paths again; the result has the changed IDs and documents                      |
| `watch(onChange, opts)` | A recursive `fs.watch` of the project folder that calls `update` after a quiet time             |
| `rescan()`              | Read the project file and all files again                                                       |
| `outputDir`             | The output folder of the build. The watcher skips it: after a build, call `update([outputDir])` |

The hash is the SHA-256 of the source file. For a `.gltf` source, the hash also covers the buffers and images that
the file names. A record whose source is missing is still in the index (its hash is `null`), and its problem names
each file with the same name and no record: when a source moves without its record, move the record beside it.

## The importers

`defaultImporterRegistry()` has an importer for each format; `register(importer)` adds the importer of a plugin
(`defineImporter({ name, version, extensions, kinds, schema, run })`). The `importer` of a record names the importer,
and its `settings` follow the schema of the importer. Each setting has a default, so `{}` is valid.

| Importer                      | Extensions                                | Kinds                                 | Writes            | Settings (schema file)                  |
| ----------------------------- | ----------------------------------------- | ------------------------------------- | ----------------- | --------------------------------------- |
| `gltf`, `glb`                 | `.gltf`, `.glb`                           | `model`, `skinned-model`, `animation` | `model.glb`       | `schema/model-import.schema.json`       |
| `fbx`, `obj`, `blend`         | `.fbx`, `.obj`, `.blend`                  | `model`                               | `model.glb`       | `schema/model-import.schema.json`       |
| `png`, `jpeg`, `webp`, `avif` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif` | `texture`                             | `texture.<ext>`   | `schema/texture-import.schema.json`     |
| `hdr`                         | `.hdr`                                    | `environment`, `texture`              | `environment.hdr` | `schema/environment-import.schema.json` |
| `wav`, `ogg`, `mp3`           | `.wav`, `.ogg`, `.oga`, `.opus`, `.mp3`   | `audio`                               | `audio.<ext>`     | `schema/audio-import.schema.json`       |
| `material`                    | `.material.json`                          | `material`                            | `material.json`   | `schema/material-import.schema.json`    |

The model settings: `scale` (`"auto"` or the factor to metres), `up` (`"y"`, or `"z"` to turn a Z-up model),
`origin` (`"source"`, `"base-centre"`, `"centre"`, or a point), `decimate` (a ratio, a spec or a list of specs),
`merge`, `maxTextureSize`, and the keys of the `fbx-prop` recipe of `import_fbx_prop.py` (`materials`, `bake`,
`parts`, `sockets`, `keep`, `drop`, `add`, `dropParts`, `splitParts`, `lift`, `colors`, `fills`, `surfaces`,
`textureSize`). The places of the recipe are metres in the frame of Blender (Z up).

A model goes one of three paths: **direct** (a glTF file: glTF Transform reads it, the images stay as they are),
**normalize** (FBX, OBJ, .blend, or a glTF file that glTF Transform does not read: `import_drop.py` in Blender) or
**recipe** (any model with a recipe key, a point origin or a Blender-only decimate spec: `import_fbx_prop.py`, then
`export.py`). The up axis, the origin modes, the merge and a decimate ratio then run in glTF Transform. A texture
import checks the header against the extension and copies the file; the build encodes it ("The build"). A
sound import checks the header too and copies the file as it is; its report has the codec, the channels, the
sample rate and the duration in seconds (`import/audioInfo.ts` reads them with no decode). A material import
reads the document (`scenity.material/1` of `@scenity/scene`), fails with the JSON Pointer of each error, and writes
the canonical text; its report has the type and the texture references. The build of a material checks that each
texture reference names a texture asset, warns when the colour space of a reference differs from the import settings
of the texture, and lists the texture IDs in the `dependencies` of the manifest record.

`importAsset(projectDir, recordPath, options)` writes into `<projectDir>/.scenity/imports/<id>/` with the stamp
`import.json`. The import key is the SHA-256 of the importer name and version, the settings with their defaults and
the source hash. The same key does nothing (`status: "current"`); a change of the settings or of the source bytes
imports again. A bad record, an unknown importer, a wrong kind, bad settings (with their JSON Pointers under
`/settings`) or a missing source throw an `ImportError`.

## The release gate

`releaseCheck(projectDir)` checks that the assets of a project can go into a release. The project document
gives the rules in `release`:

```json
{
  "release": {
    "licences": { "allow": ["CC0-1.0"], "register": "rights/register.json" },
    "rights": { "review": true },
    "denyTags": ["sample"],
    "approvals": [
      { "role": "art", "label": "art reviewer", "appliesTo": { "kinds": ["model"], "tags": ["furniture"] } }
    ]
  }
}
```

- Each asset has a rights record (the `rights` path of its record). The record reads, allows web delivery and has a
  licence that the project accepts: its `spdx` ID is in `licences.allow`, or the licence register `licences.register`
  allows its source and licence (with no open facts, and with the attribution text when the entry asks for it). With
  no licence rule, no licence passes.
- `rights.review: true`: each rights record has a `reviewer` and `textReview: done`.
- An asset with a tag of `denyTags` fails.
- Each approval rule names a role of the project. Each asset in the scope of the rule (`appliesTo`: the asset matches
  each list that the rule gives; no `appliesTo`: all assets) needs an approval of the role. The approval with the
  latest date decides: its verdict is `approved` and its `sourceHash` is the current hash of the asset. A rule with
  `required: false` gives warnings, not errors.
- A problem of the asset database (a bad record, a missing source, a broken reference) also stops the release.

An approval record (`scenity.approval/1`, JSON or YAML, `schema/approval.schema.json`) holds one verdict of one
reviewer. The asset record lists it in `approvals`:

```json
{
  "format": "scenity.approval/1",
  "asset": "01J9Z6Q3R9",
  "role": "art",
  "reviewer": "A. Reviewer",
  "date": "2026-10-15",
  "verdict": "approved",
  "sourceHash": "<the hash of the index entry at the time of the review>",
  "note": "optional text"
}
```

The verdict is `approved`, `changes` or `rejected`. A change of the source after the review makes the approval stale,
so the reviewer must look at the asset again. `rightsGate` and `approvalGate` are the parts under `releaseCheck`: a
content set with no project file gives its own subjects and rules (the room plugin of CodeBlue: `src/release.ts` of its `assets` part).
The showroom gives `"release": { "licences": { "allow": ["CC0-1.0"] } }` and no approval role.

## The CLI

From the repo root:

```sh
bun packages/assets/src/cli.ts index <projectDir> [--json]    # the index and the problems; exit 1 on a broken reference or a duplicate ID
bun packages/assets/src/cli.ts used-by <projectDir> <id> [--json]
bun packages/assets/src/cli.ts missing <projectDir> [--json]  # the broken references; exit 1 when there is one
bun packages/assets/src/cli.ts new-id                         # a new asset ID (a ULID)
bun packages/assets/src/cli.ts import <projectDir> <file|id> [--force] [--json] [--rights <path>] [--kind <kind>]
bun packages/assets/src/cli.ts build <projectDir> [--check] [--json] [--no-cache] [--no-import]
bun packages/assets/src/cli.ts release-check <projectDir> [--json]  # the release gate; exit 1 when it fails
bun packages/assets/src/cli.ts export <projectDir> <scene> [--out <file.glb>] [--no-import] [--json]
```

`import` runs the importer of a source file, a record or an asset ID. A source without a record gets a new record
(a new ID, the importer of its extension, empty settings) when `--rights` names its rights record. `build` builds the
project into its output folder; `--check` builds in memory and compares the bytes with the written files (exit 1 for an
error or a stale file). The cache of the optimized models is `<projectDir>/.scenity/cache/build`. `bun run check:assets`
runs `build samples/showroom --check` after the checks of the vendor files of the renderer. `export` writes the GLB file of a scene (see "The glTF
export of a scene"); the default file is `<projectDir>/.scenity/exports/<scene id>.glb`.

## The file map: to change X, edit Y

All paths are under `src/` unless the row names another folder.

| To change                                                    | Edit                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| The record schema, the reader and the writer                 | `record.ts`                                                                    |
| The JSON Schema export                                       | `jsonSchema.ts`; the file: `bun packages/assets/scripts/json-schema.ts`        |
| The ULID generator (pure, with an injected clock and random) | `ids.ts`; the default source (`Date.now`, `crypto`): `system.ts`               |
| The types of an entry, a problem and a use                   | `types.ts`                                                                     |
| The read of one record into an entry                         | `records.ts`                                                                   |
| The source hash and the glTF file references                 | `hash.ts`                                                                      |
| The document scan for `asset:` references                    | `documents.ts`                                                                 |
| The index, the duplicate check, the broken references        | `derive.ts`                                                                    |
| The database: open, queries, incremental update              | `database.ts`                                                                  |
| The file watcher                                             | `watch.ts`                                                                     |
| The file helpers (scan, project paths)                       | `files.ts`                                                                     |
| The CLI                                                      | `cli.ts`; the `import` command: `importCli.ts`                                 |
| The importer registry and `defineImporter`                   | `import/registry.ts`                                                           |
| The import settings (zod) and the recipe keys                | `import/settings.ts`; the schema files: `jsonSchema.ts`                        |
| The model importers and their three paths                    | `import/modelImporters.ts`; the Blender paths: `import/blenderPaths.ts`        |
| The model steps (up axis, scale, origin, merge, decimate)    | `import/modelSteps.ts`                                                         |
| The texture importers and the header read of an image        | `import/textureImporters.ts`, `import/textureInfo.ts`                          |
| The sound importers and the header read of a sound           | `import/audioImporters.ts`, `import/audioInfo.ts`; the build: `build/audio.ts` |
| The material importer and the build of a material            | `import/materialImporter.ts`; the build: `build/material.ts`                   |
| The import of an asset: the key, the stamp, the errors       | `import/run.ts`; the record of a new source: `import/newRecord.ts`             |
| The build of a project: kinds, jobs, textures, HDR maps      | `build/project.ts`; the inputs (imports, sources): `build/projectInputs.ts`    |
| The build settings: levels, codecs, budgets, defaults        | `build/settings.ts`; the schema: `build` of `@scenity/scene` `project.ts`      |
| The build command of the CLI                                 | `buildCli.ts`                                                                  |
| The image decoders (PNG, JPEG, WebP, AVIF)                   | `build/images.ts`                                                              |
| The build pipeline: jobs, the LFS pointers, the result       | `build/pipeline.ts`                                                            |
| The optimize step, the model and clip stats, the levels      | `build/optimize.ts`; the KTX2 textures: `build/textures.ts`                    |
| The generic checks (validator, budgets, KTX2, extensions)    | `build/checks.ts`; the GLB images and extensions: `build/glbImages.ts`         |
| The cache of the optimized models                            | `build/cache.ts`                                                               |
| The written output (compare, write) and the WebP size        | `build/output.ts`                                                              |
| The writer of manifest 2: records, the version hash          | `build/manifest.ts`; the drafts of a project build: `build/project.ts`         |
| The input stamps of the pictures that a browser renders      | `build/stamps.ts`                                                              |
| The trimmed GLTFLoader and the patched Basis transcoder      | `build/trimGltf.ts`, `build/patchBasis.ts`                                     |
| The three.js diet of the editor build                        | `build/threeDiet.ts`                                                           |
| The workspace root                                           | `build/workspace.ts`                                                           |
| The Blender runs, the export and its check                   | `blender/run.ts`; the image: `../toolchain/Dockerfile`                         |
| The import of a dropped file                                 | `blender/importDrop.ts`; the script: `../blender/import_drop.py`               |
| The settings of the prop importer                            | `blender/propImportSpec.ts`; the script: `../blender/import_fbx_prop.py`       |
| The rights records and the register check                    | `rights/records.ts`, `rights/licenceRegister.ts`                               |
| The rights checks of a build                                 | `rights/check.ts`                                                              |
| The approval record: schema, reader, writer                  | `release/approval.ts`; the rules: `release` of `@scenity/scene` `project.ts`   |
| The release gate: rights, licences, tags, approvals          | `release/gate.ts`; the gate of a project folder: `release/project.ts`          |
| The `release-check` command of the CLI                       | `releaseCli.ts`                                                                |
| The glTF export: the scene, the prefabs, the model files     | `export/project.ts`; the `export` command: `exportCli.ts`                      |
| The glTF writer: entity nodes, extras, visibility            | `export/writer.ts`                                                             |
| The shape meshes, the models, the lights, cameras, sockets   | `export/shapes.ts`, `export/models.ts`, `export/components.ts`                 |
| The colours and the aim rotation of the export               | `export/math.ts`; the Blender check: `../blender/gltf_world.py`                |

## Tests

`bun test ./packages/assets` (from the repo root). The import fixtures are in `tests/fixtures/import` (made from code by
`blender/tests/make_import_fixtures.py`). The tests of the Blender scripts, of the Blender importers and of the import of
a dropped file, and the Blender check of the glTF export (`exportBlender.test.ts`), run where Blender 5.2 is on this machine (`bun run py:test` runs the Python tests). The tests read the showroom sample (`samples/showroom`) and write
temp projects under the temp folder of the system; each test removes its folders. After a schema change, run
`bun packages/assets/scripts/json-schema.ts`; `--check` fails when the file is not current.
