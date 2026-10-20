// SPDX-License-Identifier: Apache-2.0
/**
 * The bridge calls of the scratch props. The workbench page gives the lab a new scratch prop of an import
 * (`scratchAdd`) and the models that the lab asked for (`scratchModel`). The host gives the answer of "Promote to the
 * room" (`promoteResult`).
 */
import type { BridgeCall } from "../bridge/workbenchBridge";

function api() {
  const value = globalThis.__labScratch;
  if (value === undefined) throw new Error("The scratch props of the lab are not ready.");
  return value;
}

function bytesOf(value: unknown, call: string): ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) throw new Error(`${call} needs the bytes of a GLB file.`);
  return value;
}

export const SCRATCH_BRIDGE_CALLS: Readonly<Record<string, BridgeCall>> = {
  /** `[bytes, { import, name, source, licence, pass, triangles, kb, warnings, point, drop }]`: the ID of the new prop. */
  scratchAdd: (args) => api().add(bytesOf(args[0], "scratchAdd"), args[1]),
  /** `[bytes | null, { import, … } | { import, error }]`: a model that the lab asked for, or why it failed. */
  scratchModel: async (args) => {
    await api().model(args[0] === null ? null : bytesOf(args[0], "scratchModel"), args[1]);
    return null;
  },
  /** `[{ dry, refused, changes, prompt, to }]`: the answer of the host to a promote. */
  promoteResult: (args) => {
    api().promoteResult(args[0]);
    return null;
  },
};
