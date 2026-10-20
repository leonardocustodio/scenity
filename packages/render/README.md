# @scenity/render

The renderer backends of Scenity: WebGL and WebGPU, the glTF loader, KTX2, the GPU timer and the WebGPU fixes of the
materials. three.js only: no Vue, no DOM framework, no other
workspace package.

A core of a plugin has no renderer code: its entry gives it a backend factory.

## Entry points

Import a subpath, never the barrel: one backend must not pull the other into a chunk (the render workers have size
budgets). The package has `"sideEffects": false`.

| Entry                             | What it gives                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@scenity/render/types`           | The backend contract: `RenderBackend`, `RenderBackendFactory`, `SceneRenderer`, `BackendKind`, … |
| `@scenity/render/webgl`           | `createWebGLBackend`: the classic WebGLRenderer with tone mapping, shadows and timer queries     |
| `@scenity/render/webgpu`          | `createWebGPUBackend`: the WebGPU renderer of three.js, its node library and timestamp queries   |
| `@scenity/render/webgpuMaterials` | `addSceneMaterials`: the physical, Lambert and Phong node materials of a generic scene           |
| `@scenity/render/postTypes`       | The effect contract, `PostSettings`, `PostPipeline`, `PostFactory` (types)                       |
| `@scenity/render/postWebgl`       | `createWebGLPost`, the EffectComposer passes of the effects (a lazy chunk)                       |
| `@scenity/render/postWebgpu`      | `createWebGPUPost`, the `three/tsl` node passes of the effects (a lazy chunk)                    |
| `@scenity/render/gpuTimer`        | `GpuTimer`: the timer queries of WebGL (EXT_disjoint_timer_query_webgl2)                         |
| `@scenity/render/ktx2`            | The KTX2 loader without workers, the transcode target of a GPU, the Basis transcoder load        |
| `@scenity/render/assets`          | `AssetLoader`: the same-origin glTF loader with the size and SHA-256 checks, `AssetFileRef`      |
| `@scenity/render/genericAssets`   | `GenericAssetLoader`: the loader of the generic scene worker, more glTF extensions               |

The barrel `@scenity/render` has the types only.

## The file map: to change X, edit Y

All paths are under `src/`.

| To change                                                                                 | Edit                                                                                    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The backend contract (the renderer parts that a core uses, the events)                    | `types.ts`                                                                              |
| The WebGL renderer: its construction, tone mapping, shadows, the context loss             | `webgl.ts`                                                                              |
| The WebGPU renderer: the first-frame check, the device loss, the node library             | `webgpu.ts`                                                                             |
| The node materials of a generic scene on WebGPU (physical, Lambert, Phong)                | `webgpuMaterials.ts`                                                                    |
| The effects: the order of the passes and the settings                                     | `postTypes.ts`                                                                          |
| The effects on WebGL: GTAO, Unreal bloom, the outline, SMAA, FXAA, MSAA                   | `postWebgl.ts`, `smaaPassGl.ts` (SMAA with no `Image`, for the worker)                  |
| The effects on WebGPU: the same passes as node passes                                     | `postWebgpu.ts`                                                                         |
| The seeded noise of the denoise of the ambient occlusion (both backends)                  | `postNoise.ts`                                                                          |
| The GPU timer of WebGL                                                                    | `gpuTimer.ts`                                                                           |
| The new geometry of a mesh on WebGPU (the layout of the vertex buffers)                   | `geometrySwap.ts`                                                                       |
| The morph targets of quantized meshes on WebGPU                                           | `morphKey.ts`                                                                           |
| The shadows of the alpha-tested materials on WebGPU                                       | `shadowAlpha.ts`                                                                        |
| The background colour of a pane on WebGPU (the tone mapping of a clear colour)            | `toneClear.ts`                                                                          |
| The KTX2 transcode target of a GPU                                                        | `ktx2.ts`                                                                               |
| The glTF load: the queue, the checks, the meshopt decoder, the images                     | `assets.ts`                                                                             |
| The trimmed GLTFLoader (only the glTF extensions of the built assets)                     | `vendor/GLTFLoader.js`: `bun packages/assets/src/build/trimGltf.ts` writes it           |
| The generic GLTFLoader (lights, physical materials, unlit, WebP, AVIF, instancing, Draco) | `vendor/GLTFLoaderGeneric.js`: `trimGltf.ts <target> --loader generic` writes it        |
| The generic asset loader: the queue, the optional checks, the decoders                    | `genericAssets.ts`                                                                      |
| The images and the URIs of the generic loader (`createImageBitmap`, data URIs)            | `imageSources.ts`                                                                       |
| Draco without Blob workers: the lazy loader and the decoder chunk                         | `dracoLoader.ts`, `dracoDecoder.ts`                                                     |
| The Draco decoder as an ES module (the CSP of the app)                                    | `vendor/draco_wasm_wrapper.js`: `bun packages/assets/src/build/patchDraco.ts` writes it |
| The Basis transcoder without `new Function` (the CSP of the app)                          | `vendor/basis_transcoder.js`: `bun packages/assets/src/build/patchBasis.ts` writes it   |
| The stub of the Zstandard decoder of three.js (the Vite alias of the apps)                | `vendor/zstdStub.ts`                                                                    |

Never edit the four generated vendor files by hand: `bun run check:assets` fails when they are not current. `NOTICE`
names their licences.

## The generic loader

A plugin core keeps the trimmed loader and `AssetLoader`, so its workers do not grow. The generic scene worker
and the scene and still pages of the editor use `GenericAssetLoader` with a second trimmed copy of GLTFLoader:

- The extensions of the trimmed loader, `KHR_lights_punctual`, the physical `KHR_materials_*` set (transmission, volume,
  ior, specular, clearcoat, sheen, iridescence, anisotropy), `KHR_materials_emissive_strength`, `KHR_materials_unlit`,
  `EXT_texture_webp`, `EXT_texture_avif`, `EXT_mesh_gpu_instancing`, `KHR_meshopt_compression` and
  `KHR_draco_mesh_compression` (`GENERIC_GLTF_EXTENSIONS` of `trimGltf.ts`). Another extension is an error.
  `KHR_materials_dispersion` and `EXT_materials_bump` are not in the list yet.
- Draco is an optional chunk: the first Draco primitive imports `dracoDecoder.ts`, which fetches `draco_decoder.wasm`
  (the glTF build of three.js, `decoders.dracoWasm`). DRACOLoader of three.js starts Blob workers, which the CSP
  blocks; the decoder runs in the thread of the caller, with no `eval` and no `new Function`.
- Every image goes to `createImageBitmap(Blob)` with the options of the ImageBitmapLoader of three.js, in every
  browser, so a Safari worker can load a model. A URI of a `.gltf` file is a same-origin fetch or a data URI decode.
- A file reference with `bytes` and `sha256` (a built file) gets the checks of `verifiedBytes`; a dev file has none.
- `texture(ref)` loads the texture of a material asset: a KTX2 file, else an image through the image decoder.
  The texture has `flipY` false, as a glTF texture.

## The node materials of a generic scene

`addSceneMaterials(backend)` adds the physical, Lambert and Phong node materials to the library of a WebGPU backend.
Only the generic document core calls it, so the entries of a plugin core keep the trimmed library. WebGLRenderer lights a Lambert
or a Phong material with the irradiance of `scene.environment`; the node materials of three.js do not, so the two
node materials here add that irradiance when the material has no `envMap`.

## Tests

`bun test ./packages/render` (from the repo root). The tests run three.js in Bun with no GPU: the geometry swap, the
morph keys, the shadow alpha, the tone of a clear colour, the GPU timer, the KTX2 transcode (with a small KTX2 file
that `tests/fixtures.ts` makes in memory and the Basis WASM of three.js), the transcoder under a CSP without
`unsafe-eval`, and the trimmed GLTFLoader against the stock loader on every built asset of a plugin
(`plugins/<plugin>/content/built`) and of a sample build with only its extensions. `gltf-generic.test.ts` checks the generic loader against the stock loader
on the showroom build and the Khronos samples (`samples/gltf-samples`), loads each sample with its extensions, decodes
Draco while `new Function` and `eval` throw, and checks the size and SHA-256 of a built file.
