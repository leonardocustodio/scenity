// SPDX-License-Identifier: Apache-2.0
/**
 * The text of the renderer backend of the lab: the backend that draws, its reason and the choice, from the frame
 * statistics or from the choice. No imports of the page, so the tests can read it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The backend and the reason are data values.
 */
import { runningBackend, type BackendChoice } from "@scenity/runtime/backend";
import type { SceneStats } from "@scenity/runtime/protocol";
import { t } from "../texts";

/** The backend fields of the frame statistics. */
type BackendStats = Pick<SceneStats, "backend" | "backendReason" | "backendChosen">;

/**
 * The backend that draws, as the statistics of the renderer give it, else as the choice gives it. The index key
 * contains it, so a frame of WebGL and a frame of WebGPU never share a key.
 */
export function drawnBackend(stats: BackendStats | null, choice: BackendChoice | null): "webgpu" | "webgl" | null {
  return stats?.backend ?? runningBackend(choice)?.backend ?? null;
}

/**
 * The text of the backend that draws and why, for the View tab and the card of the frame statistics:
 * "webgpu (supported)", or "webgl (url_override)", with the choice of the chooser when it is another backend.
 */
export function backendText(stats: BackendStats | null, choice: BackendChoice | null): string {
  const running = stats?.backend === undefined ? runningBackend(choice) : null;
  const backend = stats?.backend ?? running?.backend;
  if (backend === undefined) return "…";
  const reason = stats?.backendReason ?? running?.reason ?? "";
  const chosen = stats?.backendChosen ?? running?.chosen ?? backend;
  return chosen === backend
    ? t("lab-backend-text", { backend, reason })
    : t("lab-backend-text-chosen", { backend, reason, chosen });
}
