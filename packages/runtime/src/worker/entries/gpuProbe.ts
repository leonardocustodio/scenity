// SPDX-License-Identifier: Apache-2.0
/**
 * The worker entry of the WebGPU probe. The code is in `worker/gpuProbe.ts`. This file is a real module with an
 * explicit import and a call, so a bundler cannot remove it.
 * The built worker keeps the name of this file (`gpuProbe-*.js`). Load it with a same-origin URL:
 *
 *     import gpuProbeUrl from "@scenity/runtime/gpuProbeWorker?worker&url";
 */
import { startGpuProbe } from "../gpuProbe";

startGpuProbe(self);
