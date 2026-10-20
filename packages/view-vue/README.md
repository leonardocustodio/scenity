# @scenity/view-vue

`SceneView.vue`: the generic Vue view of a scene. It holds the renderer life cycle, the fallback
ladder, the adaptive quality, the poster, the fog of the asset loads and the pointer. A plugin wraps it with its own
props and overlays (the room plugin of CodeBlue: `Room3DView.vue` of its `view` part).

The package can import only `@scenity/scene`, `@scenity/runtime` and Vue (`docs/architecture.md`). It has no word
of a domain (the domain word lint).

| Entry point                       | What it holds                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@scenity/view-vue`               | `SceneView` and its types (`SceneRendererFactory`, `SceneViewOptions`, `SceneViewHandle`, ...) |
| `@scenity/view-vue/SceneView.vue` | The component file alone, for a lazy import with its own chunk                                 |
| `@scenity/view-vue/styles.css`    | The Tailwind source of the package (`@source`): a host app imports it after `tailwindcss`      |

```vue
<SceneView
  :input="input"
  :create-renderer="createMyRenderer"
  :paused="paused"
  :assets="(tier) => myAssets(tier)"
  :poster="poster"
  :loading-label="t('loading')"
  @failed="showFallback"
  @hit="(id, kind) => kind === 'down' && id !== null && select(id)"
  @frame="(frame) => placeLabels(frame)"
>
  <template #default="{ hovered }"><MyOverlay :hovered="hovered" /></template>
</SceneView>
```

## The contract

- **Input.** `input` is the scene input of the plugin (the component is generic over its type). A new value goes to
  the renderer with `setInput`.
- **Renderer.** `createRenderer(canvas, options)` gives a `SceneClient<Input>` of `@scenity/runtime/client` (the client
  of a plugin, or a labs renderer). The view calls it once per canvas. The exposed `renderer()` gives the current
  renderer, `stats(reset)` its frame statistics, `quality()` the level of the adaptive quality and `element()` the root
  element.
- **The fallback ladder.** A failure of the render worker starts the same core on the main thread on a new
  canvas; a failure of the WebGPU backend starts it once with WebGL (`device_lost`). A second failure, a lost context
  that the browser does not restore in 5 s, no first frame in 15 s or the last step of the adaptive quality emits `failed`: the
  host shows its fallback.
- **Adaptive quality (`adaptive.ts`).** Every window of `@scenity/runtime/adapt` the view reads the frame
  statistics and the cadence of the page and of a second view (`getSecondCadence`). It lowers the render scale, then the
  tier, then uses still poses. `adaptive: false` keeps fixed frames (the visual tests). `statsMark` puts the statistics
  of each window on the User Timing time line under that name.
- **Assets and poster.** `assets(tier)` gives the built assets of a tier (`ManifestRef`), or null for no
  files. A fog lies over the scene until the renderer reports the files (`assetState.ts`); the `assets` event gives
  each report to the host (the load keys of the plugin are in `loads`). `poster` shows until the first frame when its
  aspect fits the view.
- **Pointer.** One move per animation frame. The view gives the hit test of the renderer as the `hit` event; the default
  slot gets `hovered`.
- **Texts.** The view has one text, the loading label (`loadingLabel`); the host gives it from its own Fluent files.
- **Reduced motion.** The host gives `reducedMotion` (the system setting and the attribute of the page, for example
  `usePrefersReducedMotion` of `@scenity/ui`); the view then draws still poses.

The class names start with `scene-view` (the fog fade of the lab is the variable `--scene-view-fog-duration`). The
test IDs (`room-3d-canvas`, `room-3d-poster`, `room-3d-fog`, `room-3d-loading`) keep the names of the room view of
CodeBlue, so the tests and the lab find the same elements. The root has the test ID
`scene-view`; a wrapper can set another one through its attributes.

## Tests

The lab page of the room plugin of CodeBlue renders through this view (`LabsRoomView.vue` → `Room3DView` →
`SceneView`): the lab end-to-end tests, the gallery and the parity suite of that plugin (in CodeBlue) cover it. The adaptive rules have their tests in
`packages/runtime/tests/adapt.test.ts`.
