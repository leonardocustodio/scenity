// SPDX-License-Identifier: Apache-2.0
/**
 * The generic checks of the asset build. A project adds its own checks (a rig, a coverage, rights) to the findings of
 * the pipeline (pipeline.ts). The checks here:
 *
 * - glTF validator: no errors, before compression (the validator does not decode meshopt or KTX2) and after it;
 * - the budgets of the job per tier: triangles, file size, texture size;
 * - textures: every texture of a built model is KTX2, and every KTX2 image is Basis Universal (glbImages.ts);
 * - extensions: a built model or clip uses only the glTF extensions of the trimmed GLTFLoader;
 * - clips: one animation with a length, and the byte budget of a clip.
 */
import { validateBytes } from "gltf-validator";
import { extensionProblems, ktx2Problems } from "./glbImages";
import type { ClipStats, ModelStats, Optimized } from "./optimize";

export interface Finding {
  readonly level: "error" | "warning";
  readonly asset: string;
  readonly message: string;
}

/** The budget of a model on one tier. A missing value has no limit, because a project can give a part of a budget. */
export interface TierBudget {
  readonly triangles?: number;
  readonly bytes?: number;
  readonly maxTextureSize?: number;
}

interface ValidatorReport {
  readonly issues: {
    readonly numErrors: number;
    readonly messages: readonly {
      readonly code: string;
      readonly message: string;
      readonly pointer?: string;
      readonly severity: number;
    }[];
  };
}

/** The SHA-256 of a file in lowercase hex (as in a manifest). */
export function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** The errors of the glTF validator for a file. */
export async function gltfErrors(bytes: Uint8Array): Promise<string[]> {
  const report = (await validateBytes(bytes, { maxIssues: 20 })) as ValidatorReport;
  return report.issues.messages
    .filter((issue) => issue.severity === 0)
    .map((issue) => `${issue.code} ${issue.pointer ?? ""}: ${issue.message}`);
}

/** The budget problems of one tier of a model, and each texture that is not KTX2. */
export function budgetProblems(tier: string, stats: ModelStats, bytes: number, budget: TierBudget = {}): string[] {
  const problems: string[] = [];
  if (budget.triangles !== undefined && stats.triangles > budget.triangles)
    problems.push(`${tier}: ${String(stats.triangles)} triangles (budget ${String(budget.triangles)})`);
  if (budget.bytes !== undefined && bytes > budget.bytes)
    problems.push(`${tier}: ${String(bytes)} bytes (budget ${String(budget.bytes)})`);
  if (budget.maxTextureSize !== undefined && stats.maxTextureSize > budget.maxTextureSize) {
    problems.push(`${tier}: a texture of ${String(stats.maxTextureSize)} px (budget ${String(budget.maxTextureSize)})`);
  }
  for (const texture of stats.textures) {
    if (texture.mimeType !== "image/ktx2") problems.push(`${tier}: a texture is ${texture.mimeType}, not KTX2`);
  }
  return problems;
}

/** The problems of one tier of a built model: the budget, the validator, the KTX2 images and the extensions. */
export async function modelTierProblems(
  tier: string,
  built: Optimized<ModelStats>,
  budget: TierBudget | undefined,
  extensions: readonly string[] = [],
): Promise<string[]> {
  const problems = budgetProblems(tier, built.stats, built.glb.byteLength, budget);
  for (const problem of await gltfErrors(built.plain)) problems.push(`${tier} glTF validator: ${problem}`);
  for (const problem of await gltfErrors(built.glb)) problems.push(`${tier} built file, glTF validator: ${problem}`);
  for (const problem of ktx2Problems(built.glb)) problems.push(`${tier}: ${problem}`);
  for (const problem of extensionProblems(built.glb, extensions)) problems.push(`${tier}: ${problem}`);
  return problems;
}

/** The problems of a built clip: the byte budget, one animation with a length, the validator and the extensions. */
export async function clipProblems(
  built: Optimized<ClipStats>,
  maxBytes: number,
  extensions: readonly string[] = [],
): Promise<string[]> {
  const problems: string[] = [];
  const { stats, glb } = built;
  if (glb.byteLength > maxBytes) problems.push(`${String(glb.byteLength)} bytes (budget ${String(maxBytes)})`);
  if (stats.animations.length !== 1)
    problems.push(`${String(stats.animations.length)} animations (a clip file has one)`);
  if (!(stats.duration > 0)) problems.push("the clip has no length");
  for (const problem of await gltfErrors(built.plain)) problems.push(`glTF validator: ${problem}`);
  for (const problem of await gltfErrors(glb)) problems.push(`built file, glTF validator: ${problem}`);
  for (const problem of extensionProblems(glb, extensions)) problems.push(problem);
  return problems;
}

/** Sort findings: errors first, then by asset (a stable sort keeps the order of one asset). */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    a.level === b.level ? a.asset.localeCompare(b.asset) : a.level === "error" ? -1 : 1,
  );
}
