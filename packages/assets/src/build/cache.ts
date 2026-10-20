// SPDX-License-Identifier: Apache-2.0
/**
 * The cache of the optimized models of the asset build. The optimize step of a model takes 0.2 to 11 s for each tier
 * (the KTX2 textures and the LOD). This step takes almost all the time of a full build. The cache keeps the result of
 * each model and level under a key. The key comes from the export bytes, the level of detail, the options of the
 * optimize step (OptimizeOptions), and the code of the step. The code is optimize.ts, textures.ts, images.ts,
 * settings.ts and the lockfile of the workspace (`bun.lock` in a checkout). The build is deterministic, so a hit gives
 * the bytes that a new optimize gives. After a change of one asset, the build optimizes only that asset.
 *
 * The caller gives the cache folder (Git must not keep it, for example `node_modules/.cache/<name>`). A disabled cache
 * optimizes every model again. A build removes the entries that it did not use, so the cache holds one build.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { optimizeModel, type ModelStats, type OptimizeOptions, type Optimized } from "./optimize";
import type { LodLevel } from "./settings";
import { workspaceLock } from "./workspace";

/** The files whose change changes the result of the optimize step, relative to this folder. */
const CODE = ["optimize.ts", "textures.ts", "images.ts", "settings.ts"] as const;

let salt: string | null = null;

function codeSalt(): string {
  if (salt !== null) return salt;
  const hash = createHash("sha256");
  for (const name of CODE) hash.update(name).update(readFileSync(join(dirname(fileURLToPath(import.meta.url)), name)));
  const { root, lockfile } = workspaceLock();
  hash.update(lockfile).update(readFileSync(join(root, lockfile)));
  salt = hash.digest("hex");
  return salt;
}

/** The part of a model cache that the build pipeline calls. */
export interface ModelOptimizer {
  optimize(input: Uint8Array, level: LodLevel, options: OptimizeOptions): Promise<Optimized<ModelStats>>;
}

export class ModelCache implements ModelOptimizer {
  private readonly used = new Set<string>();
  /** The entries that the build read and the entries that it optimized. */
  hits = 0;
  misses = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly folder: string,
  ) {}

  /** The key of a model and level: its file names in the cache are `<key>.glb`, `<key>.plain.glb` and `<key>.json`. */
  keyOf(input: Uint8Array, level: LodLevel, options: OptimizeOptions): string {
    return createHash("sha256")
      .update(codeSalt())
      .update(JSON.stringify(level))
      .update(JSON.stringify(options))
      .update(createHash("sha256").update(input).digest("hex"))
      .digest("hex");
  }

  /** The optimized model of a level: from the cache, else from the optimize step (then into the cache). */
  async optimize(input: Uint8Array, level: LodLevel, options: OptimizeOptions): Promise<Optimized<ModelStats>> {
    if (!this.enabled) return optimizeModel(input, level, options);
    const key = this.keyOf(input, level, options);
    this.used.add(key);
    const base = join(this.folder, key);
    if (existsSync(`${base}.json`)) {
      this.hits += 1;
      return {
        glb: new Uint8Array(readFileSync(`${base}.glb`)),
        plain: new Uint8Array(readFileSync(`${base}.plain.glb`)),
        stats: JSON.parse(readFileSync(`${base}.json`, "utf8")) as ModelStats,
      };
    }
    this.misses += 1;
    const built = await optimizeModel(input, level, options);
    mkdirSync(this.folder, { recursive: true });
    writeFileSync(`${base}.glb`, built.glb);
    writeFileSync(`${base}.plain.glb`, built.plain);
    // The JSON file goes last: an entry without it is not a hit.
    writeFileSync(`${base}.json`, JSON.stringify(built.stats));
    return built;
  }

  /** Remove the entries that this build did not use. */
  prune(): void {
    if (!this.enabled || !existsSync(this.folder)) return;
    for (const name of readdirSync(this.folder)) {
      const key = name.slice(0, name.indexOf("."));
      if (!this.used.has(key)) rmSync(join(this.folder, name), { force: true });
    }
  }
}
