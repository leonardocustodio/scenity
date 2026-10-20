// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point of @scenity/view-vue: SceneView, the generic Vue view of a scene, and its types.
 * `@scenity/view-vue/SceneView.vue` is the component file alone, for a lazy import with its own chunk.
 */
export { default as SceneView } from "./SceneView.vue";
export type {
  PosterImage,
  SceneAssets,
  SceneQuality,
  SceneRendererFactory,
  SceneViewHandle,
  SceneViewOptions,
} from "./types";
