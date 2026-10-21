# @scenity/runtime

The runtime of Scenity: the host client,
the worker, the protocol, SceneCore, the scene builder, the systems, the plugin host and the clock.

The package can import only `@scenity/scene`, `@scenity/render`, `@scenity/character` and three.js. It is browser code:
no `node:` or `bun:` in `src`, and no Vue. The source imports a subpath of each engine package, never its barrel (the
ESLint guard `NO_ENGINE_BARREL`): a barrel pulls more code into the render workers.

## The host and the worker

A plugin binds the host client and the worker to its scene input and its core.

```ts
// The page: the worker client, or the main-thread core of the plugin (one chunk per backend).
const client = await createSceneClient<SceneInput, MyCore>(canvas, options, async (backend) => {
  const entry = await (backend === "webgpu" ? import("./coreGpu") : import("./coreGl")); // literal imports
  return (base) => Promise.resolve(new entry.MyCore({ ...base, backend: entry.backend }));
});
client.setInput(input);

// The worker entry: the backend first, then the handler of the plugin, then the call.
import { createWebGLBackend } from "@scenity/render/webgl";
attachSceneWorker(self, createWebGLBackend, { input: myInputSchema, createCore: (options) => new MyCore(options) });
```

- `protocol.ts` (`@scenity/runtime/protocol`): protocol 2: `ToWorker`, `FromWorker<Report>`,
  `PROTOCOL_VERSION`, the statistics (`SceneStats`), the asset report (`AssetReport`), the projected points
  (`ProjectedFrame`), the input schema (`InputSchema`), the flags, the tiers, `ManifestRef`, and the core contract
  (`SceneCoreOptions`, `SceneEvents`, `SceneCoreLike<Input>`). `protocolScene.ts` has the document part: `SceneLoad`
  (the documents and the asset manifest), `LoadResult`, `PatchResult` and `PickHit`. The protocol has no word of a
  domain.
- The "state" message carries the plugin input as an opaque value. The worker checks it with the input schema
  of the plugin (`SceneWorkerFactory.input`): an object with `safeParse`, as a zod schema has. A light check function
  is sufficient, so a worker does not need zod. A value
  that fails keeps the input before it, with one console warning. The main-thread core gets the typed value of the
  page.
- `client.ts` (`/client`): `createSceneClient(canvas, options, loadCore)`. The runtime never imports a core: the plugin
  gives `loadCore`, so the bundler keeps the core chunks of the plugin (`room3dCoreGl`, `room3dCoreGpu`).
  `workerClient.ts` is the worker path: the messages, the requests with an ID and the extension envelope.
- `worker/handler.ts` (`/worker`): `attachSceneWorker(scope, backend, factory)`. The factory makes the core at "init"
  and handles the messages of an extension (the labs worker).
- `worker/gpuProbe.ts` (`/gpuProbe`): `startGpuProbe(scope)`, the WebGPU probe of the worker context. The worker entry
  `worker/entries/gpuProbe.ts` (`/gpuProbeWorker`) calls it; load it with `?worker&url`. The files of
  `worker/entries/` are the only modules of the package with side effects (the `sideEffects` field).
- `host/backend.ts`, `host/backendRules.ts`, `host/probe.ts` (`/backend`, `/backendRules`, `/probe`): the backend
  choice, its blocklist and reasons, and the WebGL probe with the first tier.
- `adapt.ts` (`/adapt`): the adaptive quality. `camera.ts`, `framing.ts` (`/camera`, `/framing`): the field of view of
  the safe frame, the orbit of a lab camera, the framing and the projection. `hostMath.ts` (`/hostMath`): the
  percentile and the stable offset of the page chunks.
- `tuning.ts` (`/tuning`): the tune registry of `@scenity/scene/tuning` (one module, one registry).

## Protocol 2

| To the worker   | What it does                                                                                      | Core method                        |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `init`          | The canvas, the surface, the tier, the flags, the first built assets and `protocol` (2)           | `createCore`, `setAssets`, `start` |
| `load`          | The scene documents and the asset manifest (answer "loaded" with an `id`), or built assets        | `load?`, `setAssets`               |
| `patch`         | The scene ops of `@scenity/scene` as one transaction (answer "patched" with an `id`)              | `patch?`                           |
| `state`         | The plugin input, checked by the input schema of the plugin; a clock anchor after a seek          | `setInput`                         |
| `clock`         | A clock anchor of the page clock (10 per second)                                                  | the clock of the worker            |
| `surface`       | The canvas size and the device pixel ratio                                                        | `setSurface`                       |
| `flags`         | Reduced motion, pause, visible, and the GPU timer of the statistics; an absent field stays        | `setFlags`, `setGpuTimer`          |
| `tier`, `scale` | The quality tier, the render scale of the adaptive quality                                        | `setTier`, `setRenderScale`        |
| `pointer`       | A pointer move, press or leave (answer "hit")                                                     | `pointerAt`                        |
| `pick`          | The entity under a point (answer "picked": entity ID, component, sub-target, point, distance)     | `pickEntity?`                      |
| `points`        | The references of the projected points, `entity:<id>` or `entity:<id>#<sub>`                      | `setPoints?`                       |
| `camera`        | Draw with a document camera by entity ID or name, null for the first (answer "camera")            | `useCamera?`                       |
| `stats`         | The statistics (answer "stats")                                                                   | `stats`                            |
| `dispose`       | Stop the core and free the GPU                                                                    | `dispose`                          |
| `extension`     | An envelope for the messages of an extension (the labs worker); answers come in the same envelope | `factory.handle`                   |

- Protocol 1 to protocol 2: "scene" is "state", "assets" is "load" with `assets`, "gpuTimer" is "flags" with
  `gpuTimer`, and a message of an extension is an "extension" envelope. `SceneLink.send` and `listen` add and remove
  the envelope, so an extension does not see it. A worker of another protocol version answers "init" with "error".
- A core without the optional methods answers "load" with documents and "patch" with a refusal,
  "pick" with `null` and "camera" with `false`, and ignores "points". The client methods are `load`, `patch`,
  `pickEntity`, `setPoints` and `useCamera` (`pick` is a method of the labs). The editor camera is not a document camera: it stays out of the documents and of
  the "camera" message.
- The records reach the worker in "load": `manifest` (Manifest 2, `AssetManifest` of `@scenity/runtime/manifest`),
  `files` (the URL of each file name of the records; the client makes them absolute and same-origin) and `tier` (the
  LOD tier, default "high"). The page reads and checks the manifest (`parseAssetManifest` for a build); the worker
  does not fetch or parse it again. A dev manifest of source files (the scene page) has no LODs, sizes or hashes.
  `decoders` gives the same-origin URLs of the WASM decoders (`basisWasm` for KTX2, `dracoWasm` for Draco). A plugin
  core takes a `ManifestRef` (the URL of its built manifest) in `init` and in "load" with `assets`.
- `SceneStats` is generic: `entities` (a core with documents), `memory`, `drawCalls`, `triangles`, `assets` and
  `loads` by a key of the plugin.
- "audio" (from the worker) carries the sounds of a frame (`AudioFrame` of `protocolAudio.ts`): the voices
  with their start on the time line, their `audioSource` values and the world place of their entity, the listener
  (the camera) and the audio assets. A worker cannot play a sound, so the page plays them (see "Audio"). The core
  sends a frame only when a value changes; the client gives it to `onAudio`. The generic scene worker posts it from
  its factory (`worker/documentMessages.ts`), so the shared handler and the worker of a plugin core do not send it.

## Audio

The document core gives the sounds of each frame to its `audio` event (`audio/frames.ts`: `soundCues` of
`@scenity/scene/sequence` over the scene of the frame, the world place of each entity and the camera pose). The page
plays them with `AudioPlayer` (`@scenity/runtime/audio`, main thread only): a buffer source, a gain and, for a spatial
voice, a `PannerNode` (HRTF) at the place of the entity; the listener follows the camera.

```ts
import { AudioPlayer } from "@scenity/runtime/audio";

const player = new AudioPlayer({ clock: () => ({ t: clock.now(), playing: clock.playing }), fetch: bytesOf });
const client = await createDocumentClient(canvas, { ...options, onAudio: (frame) => player.frame(frame) });
canvas.addEventListener("pointerdown", () => void player.resume()); // the user gesture of the audio context
clock.seek(5300);
player.sync(); // after each seek, play and pause of the page clock
```

- The position in a sound is `clock.t - voice.start` (`soundPosition`): a seek starts a sound at the right position,
  or not at all after its end. A voice that drifts more than `tolerance` (150 ms) from it starts again. A clock that
  stops stops each voice. With no sequence (`t` null), a voice plays once from its start, and a loop does not stop.
- The player starts no voice while the audio context does not run (a browser needs a user gesture). `started` is the
  debug list of the starts (ID, entity, asset, clock time, position); the scene page gives it as `__scenity.sounds()`.
- `context` gives a fake audio context to a test (`AudioContextLike` of `audio/nodes.ts`).

## The document core and the generic scene worker

`DocumentCore` (`@scenity/runtime/documentCore`) is a scene core that draws the scene documents with the scene builder.
`load` builds the graph over the assets of the manifest, `patch` applies ops with no full rebuild, and each answer comes
after the frame that shows the change. It draws with a document camera (`useCamera`), applies the scene-level values of
the document and reports the load state of each asset by its reference. Before each frame the tier limits the lights
and their shadows and each shadow camera fits the shadow casters (`scene/lighting.ts`), and the camera gets
the field of view of its safe frame and the clip planes from the bounds of the scene (`scene/cameraFrame.ts`).
`core/documentCoreGl.ts` makes it with the WebGL backend, the PMREM generator (an equirectangular or a cube map) and
`ManifestAssets` (`scene/manifestAssets.ts`, `@scenity/runtime/manifestAssets`: the file of the LOD tier of each
record, else its first LOD or file). The models load with `GenericAssetLoader` of `@scenity/render/genericAssets`
(the generic GLTFLoader, KTX2, meshopt, Draco as an optional chunk, `createImageBitmap` for the images), and a file of
a built record passes the size and SHA-256 checks before a parse; a dev record has no checks. The HDR environment maps
take the same bytes path. A texture asset loads as a KTX2 file of a build or an image file of a dev record
(`flipY` false, as glTF), and a material asset as a material document (`*.material.json`, checked with its schema).
`core/documentCoreGpu.ts` makes the core with the WebGPU backend (with the node materials of the physical, Lambert
and Phong materials, `@scenity/render/webgpuMaterials`) and the PMREM generator of `three/webgpu`:
`createDocumentClient` loads it for a WebGPU choice on the main thread. The generic scene worker has only the WebGL backend.
The effect values of the `environment` component (ambient occlusion, bloom, anti-aliasing, the selection
outline) draw through the effect pipeline of the backend (`@scenity/render/postWebgl` or `postWebgpu`, a lazy chunk)
under the tier caps of `@scenity/scene/effects` (`core/effectsHost.ts`). `DocumentCore.select(ids)` (the "select"
extension message of the worker, `selectionOf(link)` of `documentClient.ts`) sets the selection of the outline.

```ts
import sceneWorkerUrl from "@scenity/runtime/sceneWorker?worker&url";
import { createDocumentClient } from "@scenity/runtime/documentClient";

const client = await createDocumentClient(canvas, {
  workerUrl: sceneWorkerUrl,
  getSimMs: () => null,
  surface,
  tier,
  flags,
});
await client.load({ documents: { scene }, manifest }); // after the frame with each asset
await client.useCamera("front");
await client.patch([{ op: "remove", id: "shelf" }]); // after the frame that shows it
const hit = await client.pickEntity(320, 200); // { entity, component, target, point, distance }
const near = await client.pickEntity(320, 200, { layers: ["props"], sub: true }); // + sub: "top" (entity:<id>#top)
client.setPoints(["entity:table#top"]); // onAnchors gets its screen point when it moves
```

- The pick: the `pickable` component gives the hit test (`mesh`, the default, or `bounds`: the box of the
  entity objects with no child entity), the layers (default `["default"]`), `enabled` and `priority`. The best hit
  has the highest priority, then the nearest distance. With `sub`, the hit names the nearest socket, bone or path
  point (`path.<index>`) of the hit entity. `setPoints` sends the screen point of each reference after each frame that
  moves one, from the camera of the frame, through the same "anchors" frames as the cards of a plugin core.

- `worker/sceneWorker.ts` (`/sceneWorker`) is the generic scene worker: a separate entry, so the worker of a plugin
  does not grow. The view camera is the "camera" message of the protocol;
  `worker/documentMessages.ts` has the factory of the worker.
- The scene page of the editor (`apps/editor/scene.html`) uses it; `worker=0` draws on the main thread. The gallery
  project `scene` checks that both paths draw the same pixels.

## Manifest 2

The asset manifest of a build is a list of generic records. The asset
build of `@scenity/assets` writes it; a render worker loads it and checks it with `parseAssetManifest`
(`@scenity/runtime/manifest`, no zod) before a decoder reads a file. The types are in `@scenity/scene/manifest`; the
JSON Schema is `schema/manifest.schema.json`.

```json
{
  "format": "scenity.manifest/2",
  "tiers": ["high", "low"],
  "records": [
    {
      "id": "01J9Z6Q3R9",
      "kind": "model",
      "lods": [
        { "tier": "high", "file": "01J9Z6Q3R9.high.glb", "triangles": 900, "meshes": 1, "maxTextureSize": 1024 }
      ],
      "files": [{ "file": "01J9Z6Q3R9.high.glb", "bytes": 300000, "sha256": "…" }],
      "bytes": 300000,
      "sha256": "…",
      "stats": {},
      "tags": ["furniture"]
    }
  ]
}
```

- `files`: each built file of the asset (a name with no path parts, its size, its SHA-256). `lods`: the levels of
  detail, each with the name of its file and the numbers of the budgets. `bytes` is the sum of the files, and
  `sha256` the SHA-256 of the file hashes (one per line): the version of the built asset.
- `stats`: the facts of the build (a number, a flag, a text or a list of names), for example the duration of a clip.
- `tags`: the tags of the asset record, and the tags of a plugin. A plugin finds its assets by tag (`tagValues(record,
"acme.slot:")`), not by a closed list of names; the engine reads no tag of a plugin.
- `parseAssetManifest(value, budgets?)`: `budgets` has the form of `quality.budgets` of the project. A record takes the
  budget of its first tag that has one, else the budget of its kind; a file that is not a level takes the byte limit of
  the first tier. A file over its budget fails before any download.
- `lodOf(record, tier)` gives the level of a tier and its file.

## The scene core

`SceneCore<Input, Memory, Report>` (`@scenity/runtime/sceneCore`) is the generic part of a plugin core: the backend
and its renderer, the scene, the camera, the frame loop, the tiers, the statistics, the asset report and the projected
points. `Input` is the scene input of the plugin, `Memory` the frame memory that goes forward over a seek, and
`Report` the asset report (`AssetReport<Extra>`: `{ assets, loads }` and the fields of the plugin, if any).

```ts
class MyCore extends SceneCore<MyInput, MyMemory, AssetReport> {
  constructor(options: SceneCoreOptions) {
    super(options, EMPTY_INPUT); // the backend, the scene, the camera; no hook call
    this.parts = makeParts(this.scene); // keep the order of the three.js objects (the draw sort)
    this.initView(); // the last line: applyTier() and applySurface()
  }
  override setAssets(ref: ManifestRef | null): void {
    /* … */
  }
  protected override assetReport() {
    return { assets: "ready", loads: { "my.chair": "ready" } } as const;
  }
  protected override updateScene(input: MyInput, simOrNull: number | null): void {
    /* … */
  }
  protected override saveMemory(): MyMemory {
    /* … */
  }
  protected override restoreMemory(memory: MyMemory): void {
    /* … */
  }
}
```

- The constructor calls no hook: the fields of a subclass do not exist during `super()`. The subclass calls
  `initView()` as the last line of its constructor.
- The template methods: `setInput` (store, `inputChanged`, invalidate), `pointerAt` (`hitTargets`, `hitIdOf`,
  `setHover`), `stats`, `dispose` (`disposeScene`, then the backend), `applyTier` (the shadow map, then `tierChanged`),
  `applySurface` (`aimCamera`), `frame` (`forgetHistory` on a seek, `beforeUpdate`, `update`, `afterUpdate`,
  `renderPasses`, the projected points from `anchorPoints`, `afterFrame`), `update(simOrNull)` (`updateScene(input, simOrNull)`;
  the labs core overrides it), `reportAssets` (the key is `JSON.stringify(report)`), `assetFailed` (the statistics,
  the report and one console warning).
- The hooks and their defaults are in `core/sceneHooks.ts`: `inputChanged`, `tierChanged`, `walking` (false),
  `hitTargets` ([]), `hitIdOf` (the object name), `setHover`, `anchorPoints` ([]), `disposeScene`, `aimCamera`,
  `forgetHistory`, `clockStopped` (false), `beforeUpdate`, `afterUpdate`, `afterFrame`. `renderPasses` (one pass) is in
  `sceneCore.ts`. Abstract: `setAssets`, `assetReport`, `updateScene`, `saveMemory`, `restoreMemory`.
- `core/tiers.ts`: `TIERS` and `Tiering` (the pixel ratio cap, the shadow map, the frame cap and the light limits of
  each tier: `lights` and `shadowLights`).
  `core/anchors.ts` (`@scenity/runtime/anchors`): `nextProjectedFrame`, `onCanvas` (pure) and `ANCHOR_EPSILON`.

## The scene builder

`SceneBuilder` turns a scene document of `@scenity/scene` into a three.js graph. Each entity is one `Group`
with the entity ID as its name and `userData.entity`; the `transform` component gives its local transform. One presenter
for each component type adds child objects to it. `parent` and `index` give the tree and the order of the children.

```ts
const builder = new SceneBuilder({ assets }); // assets: AssetSource of the host
builder.build(doc); // synchronous; the model loads start here
scene.add(builder.root);
await builder.ready(); // each pending load has ended
builder.apply([{ op: "set", path: "/entities/table/components/transform/position/0", value: 2 }]);
const camera = builder.camera("front");
const { background, fog, toneMapping, exposure, map } = builder.environment();
```

- `build` and `apply` are synchronous. A model appears under its entity at the end of its load; `ready()` resolves
  when each pending load and dispose has ended.
- `apply` uses `applyOps` of `@scenity/scene`, which shares each branch that does not change. A reference compare finds
  the touched entities and components: an unchanged entity keeps its objects, a changed component goes to
  `presenter.update`, and `update` → `false` makes the object again. A bad op changes nothing.
- The asset cache loads each asset one time, with reference counts. The last user of an asset disposes its geometries,
  materials and textures and calls `AssetSource.release`. A material override with values clones the material; the
  entity disposes the clone.
- The material assets (`scene/materials.ts`): `makeMaterial` makes the three.js material of a material
  document (`standard`, `physical`, `lambert`, `phong`, `unlit`) with a copy of each texture asset (the colour space,
  the repeat and the offset of the reference). `MaterialCache` keeps one material for each asset over the asset cache
  of the builder; the material document and each texture are assets with their own counts. A shape with `material`
  draws with the shared material. The overrides of a model (`presenters/modelOverrides.ts`) name a part by
  `mesh:<node name>` (the meshes under that node) or by a material name; a patch of the overrides changes the same
  clone: the original materials return, the copies go, and the builder releases the unused material assets.
- The host applies the scene-level values: the background, the fog, the tone mapping and the exposure, and the PMREM of
  the environment map (it needs the renderer).
- Lights: any number of lights of each kind. A directional or spot light points at its `target` (a world
  point or an entity), else along -Z of the entity. `applyLight` (`scene/lights.ts`, `@scenity/runtime/lights`) writes
  the values; a plugin core with its own lights uses it too. Each frame, `frameLighting`
  (`scene/lighting.ts`) applies the tier: `Tiering.lights` directional, point and spot lights show and
  `Tiering.shadowLights` of them cast a shadow, in the order of the entities; the shadow map is the size of the tier
  (a spot light half, a point light a quarter). A `shadowCamera` value of the document stays; the runtime fits the
  other values to the shadow casters (`scene/shadowFit.ts`): the box of a directional light from the casters seen from
  the light, its far plane to the farthest receiver; near and far of a spot or point light from the distances.
- Cameras: with a `safeFrame` (the bounds of its entities or a box, a margin), `fov` is the narrowest field
  of view, and the camera widens up to `safeFrame.maxFov` (default 90°) so that the safe frame fits the canvas
  (`framedFov` of `camera.ts`). A clip plane that the document does not give comes from the bounds of the scene.
- The builder uses no random numbers and no wall clock.

Built-in presenters: `transform`, `visibility`, `shape`, `light`, `camera`, `model` and `animator`. A plugin adds a
presenter through the plugin host: give `host.presenters` and `host.components` to the builder.

## The animator and the time line

The `animator` presenter (`scene/presenters/animator.ts`) keeps the component value in an empty holder group; it has no
time. `AnimatorDriver` (`scene/animate.ts`) poses the skinned model of each entity with an animator at a time, with
no AnimationMixer: the animator of `@scenity/character/animator` gives the layer poses, the `PoseMixer` puts them on
the clone of the model (its clips are `Object3D.animations`: the asset source sets them from the glTF), and the
`FootLock` holds the feet in contact. A change of the parameter values only keeps the animator (the parameter source
gives them); each other change of the component, a new model instance or `invalidate()` binds it again.

```ts
const driver = new AnimatorDriver(builder.root, { sequence, worldAt: (entity, t) => matrixAt(entity, t) });
driver.at(t, since); // after the transforms of `t` are in the graph; the reports have the states and the events
const timeline = new SceneTimeline(builder, scene, sequence); // the evaluator, the builder and the driver
timeline.at(t); // the scene of the sequence at t (a build by reference compare), then the poses at t
```

`SceneTimeline` (`scene/timeline.ts`) is the time line of a scene: the document core makes one when "load" has a
`sequence` (`SceneDocuments.sequence`) and calls `at(sim)` in its update, so the scene page plays a sequence of the
project in the worker and on the main thread. A patch then changes the base scene of the sequence (`edit`). The
frame at a time is a function of the documents and the time: a seek gives the frame of a play.

An entity with a `locomotion` component walks to the stand points of its walks around the `obstacle`
components. The time line plans the walks from the base scene (`sceneWalkers` of `@scenity/character/sceneWalks`),
puts the transform of each walker at `t` over the scene of the evaluator, and gives its animator the walk speed in the
speed parameter of the component (`walkParameters`). A transform track of the sequence on a walker has no effect. A
footprint `bounds` of a model is not an obstacle here: the bounds come only after the load.

## The characters and the attach keys

After the animators, the time line poses the characters (`scene/characters.ts`, `CharacterPoser`): the hands go to
the targets of the IK goals of the `character` component (`solveLimb` of `@scenity/character/ik`, the default pole out
to the side, down and a little back) and the head turns to the look target (`aimAt`). The targets are the world places
of entities and sockets in the scene of the time, with no attach. Before the animators, the nodes of each character
return to their rest turns, so a model with no animator keeps no turn of an earlier frame. The active variant of a
character merges into the material overrides of its model (`withVariants`; the merged value keeps its object over
frames, so the builder sees no change). A document core with no sequence has no time line: the IK goals and the
variants apply only on the time line of a sequence.

Then the attach keys of the sequence put their entities under bones and sockets (`scene/attach.ts`, `SceneAttach`).
The offset of a key with no local place is the place of the entity at the key time in the frame of the parent at the
key time: the time line poses the graph at each key time one time, keeps the result until an edit or a new model
load, and then poses the frame. So the place at a time is a function of the documents and the time, and a seek gives
the frame of a play. Before its first key an entity is at its place in the scene.

An animator with a `clipSource` loads that model too (the `animator` presenter; `SceneBuilder.ready()` waits for it),
and the driver retargets its clips onto the model of the entity with the bone maps of the two rigs
(`clipsFrom` of `@scenity/character/characterRig`).

## The systems

A system runs each frame after `evaluate()`. It reads the frame state and writes presenter outputs. Import
it from `@scenity/runtime/systems`.

```ts
function swingSystem() {
  let angle = 0; // the memory of the system
  return defineSystem<DoorsInput, number>({
    id: "doors.swing", // the plugin ID, a dot and a name
    order: 10, // a lower order runs first; the same order runs in ID order
    reads: ["doors.panel"], // the plugin host checks that the registry knows them
    update(ctx) {
      // ctx.frame (FrameState), ctx.input, ctx.t and ctx.dt (ms), ctx.random(name), ctx.out
      angle += ctx.dt * ctx.random("wind").range(0, 1e-3);
      ctx.out.setTransform("front-door", { rotation: quatAboutY(angle) });
      ctx.out.setVisible("front-door", true);
      ctx.out.setValue("front-door", "glow", 0.5); // a pose or material value; the presenter knows the key
    },
    save: () => angle, // plain JSON, a copy
    restore: (memory) => {
      angle = memory;
    },
  });
}

const runner = new SystemRunner([swingSystem()], { documentId: scene.id, seed: 1 });
const out = runner.step({ frame: evaluator.at(t), input }); // PresenterOutputs of the frame
const checkpoint = runner.save(); // { t, systems, random }: plain JSON
runner.restore(checkpoint); // a seek: restore the nearest checkpoint, then step to the time
```

- The runner sorts the systems by `order`, then by ID (no locale compare). Each step starts with empty outputs, so an
  output is a function of the frame, the input and the memory. A step back in time is an error: restore first.
- `ctx.random(name)` is a mulberry32 stream of the system. Its seed is the FNV-1a hash of the document ID, the key
  `<system ID>/<name>` and the seed of the runner. The memory holds the state of each stream.
- `save` gives the memory of each system, the random states and the time of the last step. `restore` gives each
  system a copy; a system that the checkpoint does not hold gets its initial memory. `reset` goes to the start.
- A system definition holds its memory in its closure, so one definition belongs to one runner. A plugin gives a
  factory (`() => defineSystem(...)`) for a system with memory; the plugin host calls it for each runner.
- The determinism lint (`bun tools/determinism.ts`) reads `src/systems/` of this package and the `sim/` and
  `systems/` folders of the plugins: no wall clock, no `Math.random`, no timers, no loop over a `Set` or a `Map`.
  A comment `// determinism: ordered` accepts a line.

## The runtime plugins

The runtime face of a plugin. Import it from `@scenity/runtime/plugins`.

```ts
export default defineRuntimePlugin({
  id: "doors",
  components: [panelComponent], // defineComponent of @scenity/scene/components
  presenters: { "doors.panel": panelPresenter }, // by component ID; the key is the presenter ID
  input: doorsInputSchema, // a zod schema (any object with safeParse)
  systems: [() => swingSystem()], // a definition or a factory
  simulation: doorsSimulation, // defineSimulation of @scenity/scene/sequence
});

const host = new PluginHost(await loadPlugins()); // loadPlugins of virtual:scenity/plugins (@scenity/cli/vite)
const builder = new SceneBuilder({ assets, registry: host.components, presenters: host.presenters });
const parsed = host.parseInput({ doors: liveInput }); // { ok, input } or { ok: false, problems }
const runner = host.createRunner({ documentId: scene.id });
```

- The host refuses (with one `PluginHostError` that lists all the problems) a plugin ID two times, a bad plugin ID,
  a part ID that does not start with `<plugin ID>.` (components, presenters, systems), a presenter with no component,
  a presenter key that is not its ID, and a system that reads an unknown component.
- Each system gets the input of its own plugin as `ctx.input` (the key of the plugin ID in the runner input).
- `parseInput` checks the input of each plugin with its schema. A key with no plugin is a problem.
- The debug layers and the metrics of a plugin are its dev face, not its runtime face: `defineDevPlugin({ id, layers,
metrics, library })` of `@scenity/runtime-dev`. A player build holds no dev code.

### The plugins in the document core

`DocumentCore` takes the `plugins` option: the runtime faces, or a promise of them (`core/documentPlugins.ts`). The
core checks them with `PluginHost` and waits for them before the first "load". Their components go to the registry
of the builder, their presenters to its presenter registry, and their simulations to the evaluator of the time line.
Their systems run in fixed steps of 60 per second at whole ms (`core/systemSteps.ts`), never at the frame times, with
a checkpoint of the system memory each second: a seek restores the last checkpoint before its time and runs the steps
from there, so a seek gives the frame of a play on both paths. The transform and visibility outputs change the scene
of the frame before the build. A system of a plugin with a simulation gets its `project` output as `ctx.input`; else
the key of its plugin ID in the page input. A patch starts the system memory again. With no plugins, nothing changes.

A render worker loads the plugins of its own build: `attachDocumentWorker(scope, loader)` (`worker/documentWorker.ts`,
`@scenity/runtime/documentWorker`) or `documentWorkerFactory(create, post, loader)`. The page names the plugin set in
the "init" message (`init: { plugins: "<set>" }`) and gives `plugins: () => loadPlugins(set)` to
`createDocumentClient` for a main-thread core. The worker entry imports `virtual:scenity/plugins` (the player,
`@scenity/player`) or `virtual:scenity/project-plugins` (the scene page of the editor), so each plugin is an ES chunk
of the worker build with the three.js of the worker. The page sends no code and no module URL (no eval, no Blob
worker). The generic entry `sceneWorker.ts` has no loader.

### The input of the play mode

A plugin declares its input actions with `defineInputMap` (`@scenity/runtime/inputMap`, no zod) in the `inputMap` of
`defineRuntimePlugin`: key actions (`KeyboardEvent.code` values) and pointer actions (a press on an entity with a
component). Each action name is `<plugin ID>.<name>`; the plugin host refuses another prefix.

```ts
export const inputMap = defineInputMap({
  keys: { "demo.faster": ["ArrowUp"], "demo.slower": ["ArrowDown"] },
  pointer: { "demo.toggle": { component: "demo.spin" } },
});
// In a system: the events of the step, and the actions that stay down.
for (const press of ctx.inputs?.pressed("demo.toggle") ?? []) toggle(press.entity);
if (ctx.inputs?.held("demo.faster") === true) speed += 1;
```

- An input event is `{ t, kind: "press" | "release", action, entity?, point? }` (`InputEvent` of
  `@scenity/scene/input`); `t` is the simulation time of the page clock in whole ms.
- The page turns the DOM events into input events with `PageInput` (`@scenity/runtime/pageInput`) and sends them with
  `inputsOf(link)` (`documentClient.ts`): the extension message "inputs" to the generic scene worker, or
  `DocumentCore.setInputs(events, replace)` on the main thread. A plugin worker can omit it.
- The document core (`core/documentInputs.ts`) gives a system step at time `s` the events in (`s` - dt, `s`] as
  `ctx.inputs` (`StepInputs`: `events`, `pressed(action)`, `held(action)`). So an event applies at a step boundary,
  never at the wall time of its message. An event for a time that the steps passed makes the steps from that time
  run again (`SystemSteps.forget`). A plain `SystemRunner` gives no `ctx.inputs`.
- A plugin simulation reduces the events as action keys: the time line gets the sequence with one more action track
  (`withInputs`; the key args hold `kind`, `entity` and `point`).
- A recording is a `scenity.input/1` document (`inputRecording`, `readInputRecording`, `writeInputRecording` of
  `@scenity/scene/sequence`; `packages/scene/schema/input.schema.json`). A replay sends its events with
  `replace: true`, so the frames equal the frames of the live session, and a seek after it equals a play.

## The file map: to change X, edit Y

All paths are under `src/`.

| To change                                                      | Edit                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| The clock of the render workers                                | `clock.ts`                                             |
| The frame loop of a core                                       | `scheduler.ts`                                         |
| The presenter, context and asset source contracts              | `scene/types.ts`                                       |
| The builder API (build, apply, ready, cameras, bounds)         | `scene/builder.ts`                                     |
| The entity groups, the diff of two entity maps, the order      | `scene/graph.ts`                                       |
| The asset cache, the reference counts, the dispose of an asset | `scene/assets.ts`                                      |
| The scene-level values (background, fog, tone mapping)         | `scene/environment.ts`                                 |
| The presenter registry                                         | `scene/registry.ts`                                    |
| The document colour to a three.js colour                       | `scene/colour.ts`                                      |
| The list of built-in presenters                                | `scene/presenters/index.ts`                            |
| The local transform and the visibility                         | `scene/presenters/transform.ts`                        |
| The shapes (box, plane, cylinder, sphere)                      | `scene/presenters/shape.ts`                            |
| The light presenter: the light kinds and their targets         | `scene/presenters/light.ts`                            |
| The light values, the tier limits of the lights                | `scene/lights.ts`                                      |
| The lights and the boxes of a frame                            | `scene/lighting.ts`                                    |
| The shadow camera from the shadow casters                      | `scene/shadowFit.ts`                                   |
| The safe frame and the clip planes of a camera                 | `scene/cameraFrame.ts`                                 |
| The cameras and their targets                                  | `scene/presenters/camera.ts`                           |
| The models and the material overrides                          | `scene/presenters/model.ts`, `modelOverrides.ts`       |
| The material assets and their cache                            | `scene/materials.ts`                                   |
| The animator holder                                            | `scene/presenters/animator.ts`                         |
| The animator driver: mixer, foot lock, parameters              | `scene/animate.ts`                                     |
| The time line: a sequence over a scene in a builder            | `scene/timeline.ts`                                    |
| The walks of the `locomotion` component in the time line       | `scene/timeline.ts`; the walks in `@scenity/character` |
| The IK goals and the variants of the characters                | `scene/characters.ts`                                  |
| The attach keys of a sequence on the graph                     | `scene/attach.ts`                                      |
| The system definition and the context of an update             | `systems/types.ts`, `define.ts`                        |
| The run order, the step, the save and restore of the memory    | `systems/runner.ts`                                    |
| The named random streams and their seeds                       | `systems/random.ts`                                    |
| The presenter outputs of the systems                           | `systems/outputs.ts`                                   |
| The runtime plugin contract                                    | `plugins/types.ts`                                     |
| `defineRuntimePlugin` and the plugin ID pattern                | `plugins/define.ts`                                    |
| The plugin host: ID checks, merged registries, input, runner   | `plugins/host.ts`                                      |
| The worker messages and the core contract                      | `protocol.ts`                                          |
| The documents, the manifest, the results and the pick          | `protocolScene.ts`                                     |
| The document core: load, patch, camera, pick                   | `core/documentCore.ts`                                 |
| The document core with the WebGL backend                       | `core/documentCoreGl.ts`                               |
| The project plugins in the document core                       | `core/documentPlugins.ts`                              |
| The fixed steps and the checkpoints of the plugin systems      | `core/systemSteps.ts`                                  |
| The input events of the play mode in the core                  | `core/documentInputs.ts`                               |
| The input map of a plugin                                      | `plugins/inputMap.ts`                                  |
| The DOM events to input events on a page                       | `pageInput.ts`                                         |
| The generic scene worker with a plugin loader                  | `worker/documentWorker.ts`, `documentMessages.ts`      |
| The effects of the frames and the selection outline            | `core/effectsHost.ts`                                  |
| The document core with the WebGPU backend                      | `core/documentCoreGpu.ts`                              |
| The asset source over the manifest records                     | `scene/manifestAssets.ts`                              |
| The pick of the builder graph: hit tests, layers               | `scene/pick.ts`                                        |
| The sub-targets and the points of entity references            | `scene/subTargets.ts`                                  |
| The page client of the document core                           | `documentClient.ts`                                    |
| The generic scene worker and its factory                       | `worker/sceneWorker.ts`, `documentMessages.ts`         |
| The "audio" message: voices, listener, assets                  | `protocolAudio.ts`                                     |
| The audio frames of a document core                            | `audio/frames.ts`                                      |
| The audio player of the page: clock, drift, seek               | `audio/player.ts`                                      |
| The Web Audio nodes of a voice and the listener                | `audio/nodes.ts`                                       |
| The generic scene core: the loop, the stats, the hit test      | `core/sceneCore.ts`                                    |
| The hook points of a scene core and their defaults             | `core/sceneHooks.ts`                                   |
| The quality tiers (pixel ratio, shadows, frame cap, lights)    | `core/tiers.ts`                                        |
| The projected points to the host (when a point moves)          | `core/anchors.ts`                                      |
| The page client: worker or main-thread core, the clock samples | `client.ts`, `workerClient.ts`                         |
| The worker URL rules (Trusted Types, same origin, the probe)   | `workerUrl.ts`                                         |
| The message handler of a render worker                         | `worker/handler.ts`                                    |
| The WebGPU probe of the worker context                         | `worker/gpuProbe.ts`                                   |
| The backend choice, the blocklist, the reasons                 | `host/backend.ts`, `host/backendRules.ts`              |
| The WebGL probe and the first tier                             | `host/probe.ts`                                        |
| The adaptive quality                                           | `adapt.ts`                                             |
| The camera math, the framing and the projection                | `camera.ts`, `framing.ts`                              |
| The percentile and the stable offset of the page chunks        | `hostMath.ts`                                          |
| The tune registry (one module of `@scenity/scene/tuning`)      | `tuning.ts`                                            |

## Not yet

A camera and a light cannot point at a socket or a bone: their target is a world point or an entity. The document core
has no WebGPU worker entry.

## Tests

`bun test ./packages/runtime` (from the repo root). Three.js runs in Bun with no renderer.

- `tests/adapt.test.ts`, `tests/backend.test.ts` and `tests/client-assets.test.ts` test the adaptive quality, the
  backend choice and the absolute asset URLs.
- `tests/manifest.test.ts` tests the check of manifest 2 with the built manifest of the showroom.
- The builder tests build `samples/showroom/scenes/main.scene.json` with a fake asset source. A property test applies
  seeded random ops one by one and compares the graph with a fresh build of the final document.
- `tests/systems.test.ts` checks that a seek and then a play equals a play from 0. A system with memory (`dt` and two
  random streams) runs over the tour sequence of `@scenity/scene`. A save in the middle, a restore in a new runner and
  a seek back give the same outputs at each frame.
- `tests/plugins.test.ts` checks the plugin host.
- `tests/protocol.test.ts` checks the worker handler of protocol 2: the input check, the version, "load", "patch",
  "pick", "flags" and the extension envelope.
- `tests/protocol-paths.test.ts` checks that the worker path and the main-thread path give the same calls to the core
  and the same answers to the client, with the "camera" message.
- `tests/lighting.test.ts` checks the lights of the showroom, the light targets, the tier limits, the fitted shadow
  cameras, the safe frame and the clip planes.
- `tests/documentCore.test.ts` checks the document core with a fake backend: load, patch, pick, and the same frame
  from the worker handler and from the calls.
- `tests/animator.test.ts` builds `samples/characters` with its robot glTF and plays its sequence with `SceneTimeline`.
  The robot walks, stops and waves at the expected times, and the wave lifts the hand. The bones of a play and of the
  seeks are the same.
- `tests/locomotion.test.ts` plays the table scene of the sample. The robot walks around the table to the stand point,
  and its animator walks while it moves. A seek equals a play, and an edit of the stand point plans the walk again.
- `tests/attach.test.ts` plays the pickup scene of the sample. The IK goal moves the right hand to the grip of the cup.
  The cup stays on the table before the pickup time and follows the hand after it, and a seek gives the frame of a
  play. The test also checks a key with a local place and a null key.
- `tests/characters.test.ts` plays the idle of the Rigify mannequin through a clip source, a variant of the look, and
  an IK goal on a model with no animator.
