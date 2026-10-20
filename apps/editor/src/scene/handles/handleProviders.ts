// SPDX-License-Identifier: Apache-2.0
/**
 * The providers of the handles of the Scene view, in the order of their draw: the
 * places (sockets, paths, footprints, stand points), the ranges and the cones, then the targets, the shadow boxes and
 * the safe frames.
 */
import { HANDLE_PROVIDERS, type HandleProvider } from "./handleModel";
import { audioRangeHandles, cameraFrustumHandles, lightRangeHandles } from "./rangeHandles";
import { footprintHandles, pathHandles, socketHandles, standPointHandles } from "./spatialHandles";

export const ALL_HANDLE_PROVIDERS: readonly HandleProvider[] = [
  socketHandles,
  pathHandles,
  footprintHandles,
  standPointHandles,
  lightRangeHandles,
  cameraFrustumHandles,
  audioRangeHandles,
  ...HANDLE_PROVIDERS,
];
