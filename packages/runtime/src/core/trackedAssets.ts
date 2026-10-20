// SPDX-License-Identifier: Apache-2.0
/**
 * The asset load states of a document core: an asset source that keeps the load state of each asset for the asset
 * report. documentCore.ts has the core.
 */
import type { AssetLoad, AssetState } from "../protocol";
import type { AssetKind, AssetSource, AssetValue } from "../scene/types";

/** An asset source that keeps the load state of each asset for the asset report, over a source that can change. */
export class TrackedAssets implements AssetSource {
  readonly states = new Map<string, AssetLoad>();

  constructor(
    public source: AssetSource,
    private readonly settled: () => void,
  ) {}

  async load(ref: string, kind: AssetKind): Promise<AssetValue> {
    this.states.set(ref, "loading");
    try {
      const value = await this.source.load(ref, kind);
      this.states.set(ref, "ready");
      return value;
    } catch (error) {
      this.states.set(ref, "failed");
      throw error;
    } finally {
      this.settled();
    }
  }

  release(ref: string, kind: AssetKind): void {
    this.states.delete(ref);
    this.source.release?.(ref, kind);
  }

  lods(ref: string): readonly string[] {
    return this.source.lods?.(ref) ?? [];
  }
}

/** The asset state of the scene from the load states: "none" with no document or no asset. */
export function stateOf(loaded: boolean, loads: readonly AssetLoad[]): AssetState {
  if (!loaded || loads.length === 0) return "none";
  if (loads.includes("loading")) return "loading";
  return loads.includes("failed") ? "failed" : "ready";
}
