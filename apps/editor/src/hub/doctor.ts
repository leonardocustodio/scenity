// SPDX-License-Identifier: Apache-2.0
/**
 * The WebGPU check of the doctor in the Hub. The host has no browser, thus the page does the check.
 */
/** True when this browser gives a WebGPU adapter. */
export async function webgpuWorks(
  gpu: unknown = (globalThis.navigator as { gpu?: unknown } | undefined)?.gpu,
): Promise<boolean> {
  const api = gpu as { requestAdapter?: () => Promise<unknown> } | undefined;
  if (api?.requestAdapter === undefined) return false;
  try {
    return (await api.requestAdapter()) !== null;
  } catch {
    return false;
  }
}
