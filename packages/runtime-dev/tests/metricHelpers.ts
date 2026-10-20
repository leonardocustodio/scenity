// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers of the metric tests: a document core with no GPU at a time that the test sets, the sample
 * documents, and the asset sources of the samples (the built showroom models, the robot of the characters sample).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, type ProjectDocument, type SceneDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { AssetKind, AssetSource, AssetValue } from "@scenity/runtime";
import { DocumentCore } from "@scenity/runtime/documentCore";
import { builderMetricContext, type BuilderMetricOptions } from "../src/document/metricContext";
import { coreOptions } from "../../runtime/tests/pickHelpers";

export { ShowroomAssets } from "../../runtime/tests/pickHelpers";

const SAMPLES = join(import.meta.dir, "../../../samples");
const registry = builtinRegistry();

function text(path: string): string {
  return readFileSync(join(SAMPLES, path), "utf8");
}

function failed(path: string, errors: unknown): never {
  throw new Error(`${path}: ${JSON.stringify(errors)}`);
}

export function sampleScene(path: string): SceneDocument {
  const result = readDocument(text(path), "scene", { registry });
  return result.ok ? result.doc : failed(path, result.errors);
}

export function sampleSequence(path: string): SequenceDocument {
  const result = readDocument(text(path), "sequence", { registry });
  return result.ok ? result.doc : failed(path, result.errors);
}

export function sampleProject(path: string): ProjectDocument {
  const result = readDocument(text(path), "project", { registry });
  return result.ok ? result.doc : failed(path, result.errors);
}

/** The robot of the characters sample for each model reference (the source GLB: the sample has no build). */
export class RobotAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") return new Texture();
    const data = readFileSync(join(SAMPLES, "characters/assets/sources/RobotExpressive/RobotExpressive.glb"));
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

/** A document core with no GPU and a paused clock at a time that `at` sets: each frame draws that time. */
export class MetricScene {
  readonly core: DocumentCore;
  #time = 0;
  #base: SceneDocument | null = null;

  constructor(assets: AssetSource) {
    const options = coreOptions([]);
    this.core = new DocumentCore({
      ...options,
      flags: { ...options.flags, paused: true },
      clock: () => this.#time,
      assetSource: () => assets,
    });
    this.core.start();
  }

  /** Load a scene and a sequence, and wait for the frame at the time. */
  async load(scene: SceneDocument, sequence?: SequenceDocument, time = 0): Promise<this> {
    this.#time = time;
    this.#base = scene;
    const result = await this.core.load({ documents: { scene, ...(sequence === undefined ? {} : { sequence }) } });
    if (!result.ok) throw new Error(result.reason);
    return this;
  }

  /** Show the frame of another time. */
  async at(time: number): Promise<this> {
    this.#time = time;
    await this.core.patch([]);
    return this;
  }

  /** The metric context of the current frame. */
  context(options: BuilderMetricOptions = {}) {
    return builderMetricContext(this.core.builder, {
      time: this.#time,
      ...(this.#base === null ? {} : { base: this.#base }),
      ...options,
    });
  }

  dispose(): void {
    this.core.dispose();
  }
}
