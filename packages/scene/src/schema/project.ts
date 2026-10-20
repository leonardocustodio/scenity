// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the project document `scenity.project.json`: the ID, the name, the scenes, the sequences, the
 * asset roots, the plugins, the units, the quality tiers and budgets, the rules, the asset build, the release rules
 * and the workbench settings.
 */
import { z } from "zod";
import { idSchema, relativePathSchema, tagSchema } from "./common";
import { ruleSchema, rulesPathSchema } from "./rules";

const pathList = z.array(relativePathSchema);
const nameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "a name has 1 to 64 letters, digits, '_', '.' or '-'");

/** The budget of one tier: each value is a maximum. */
export const budgetSchema = z.strictObject({
  triangles: z.number().int().min(0).optional(),
  bytes: z.number().int().min(0).optional(),
  drawCalls: z.number().int().min(0).optional(),
  textures: z.number().int().min(0).optional(),
  textureBytes: z.number().int().min(0).optional(),
  /** The largest edge of a texture in px. The asset build checks it for each asset of a kind. */
  maxTextureSize: z.number().int().min(0).optional(),
  /** The 95th percentile of the frame work (update and render calls) in ms, as `scenity bench` measures it. */
  workP95Ms: z.number().min(0).optional(),
  /** The 95th percentile of the GPU time of a frame in ms (only a browser with a GPU timer gives it). */
  gpuP95Ms: z.number().min(0).optional(),
  /** The time from the page load to the first frame with every asset in ms. */
  firstFrameMs: z.number().min(0).optional(),
});

export const qualitySchema = z.strictObject({
  /** The quality tiers from low to high (default: low, medium, high). */
  tiers: z.array(nameSchema).min(1).optional(),
  /**
   * The budgets by a group (`scene`, an asset kind) and then by a tier. The group `scene.<backend>` (`scene.webgl`,
   * `scene.webgpu`) replaces values of `scene` for one renderer backend in `scenity bench`.
   */
  budgets: z.record(nameSchema, z.record(nameSchema, budgetSchema)).optional(),
});

const edgeSchema = z.number().int().min(1).max(16384);

/** The texture roles of a model: colours (sRGB), normal maps and linear data (occlusion, roughness, metalness). */
export const MODEL_TEXTURE_ROLES = ["color", "normal", "data"] as const;
/** The KTX2 codecs of a model texture: Basis ETC1S (small files) or UASTC (higher quality). */
export const textureCodecSchema = z.enum(["etc1s", "uastc"]);
/** The codec of an environment map: `rgbe` keeps the Radiance HDR file. */
export const environmentCodecSchema = z.enum(["rgbe"]);

/** The texture codec of each role. An asset record can change the codec of a role for its asset. */
export const textureCodecsSchema = z.strictObject({
  color: textureCodecSchema.optional(),
  normal: textureCodecSchema.optional(),
  data: textureCodecSchema.optional(),
  environment: environmentCodecSchema.optional(),
});

/**
 * One level of detail of a built model. The build writes `<id>.<tier>.glb`, and the budgets of the tier in
 * `quality.budgets` apply. Each level starts from the source model.
 */
export const lodSchema = z.strictObject({
  /** The quality tier of the level, also the part of the file name. */
  tier: nameSchema,
  /** The part of the source triangles that the level keeps (1: no simplification). */
  ratio: z.number().gt(0).max(1).optional(),
  /** The scale of the texture edges against the source (1: the source size). */
  textureScale: z.number().gt(0).max(1).optional(),
  /** The largest texture edge in px for each role. */
  maxTextureSize: z
    .strictObject({ color: edgeSchema.optional(), normal: edgeSchema.optional(), data: edgeSchema.optional() })
    .optional(),
});

/**
 * The asset build of a project: the levels of detail, the texture codecs and the output folder. The schema has no
 * defaults. `@scenity/assets` gives them (`resolveBuildSettings`).
 */
export const assetBuildSchema = z.strictObject({
  /** The folder of the built files, relative to the project folder (default `build`). */
  output: relativePathSchema.optional(),
  /** The levels of detail from the full model to the smallest one (default: `high` and `low`). */
  lods: z
    .array(lodSchema)
    .min(1)
    .max(8)
    .refine((lods) => new Set(lods.map((lod) => lod.tier)).size === lods.length, {
      message: "each level of detail has its own tier",
    })
    .optional(),
  codecs: textureCodecsSchema.optional(),
  /** More glTF extensions that the loader of the project reads (default: the generic loader extensions). */
  extensions: z
    .array(z.string().regex(/^[A-Z0-9]+_[A-Za-z0-9_]+$/, "a glTF extension name (KHR_materials_unlit)"))
    .optional(),
  /** The generator text of the built glTF files. */
  generator: z.string().min(1).max(200).optional(),
});

/**
 * The size budget of one entry of a project build: the largest gzip size (level 9) of the files of the entry,
 * in KB of 1,024 bytes. `scenity build` names the entries (`player`, `element`, `worker`, `plugins`, `lazy`).
 */
export const entryBudgetSchema = z.strictObject({
  gzipKB: z.number().gt(0),
  /** Why the limit has this value (for example the measure and the margin). */
  note: z.string().min(1).max(400).optional(),
});

export const buildSchema = z.strictObject({
  assets: assetBuildSchema.optional(),
  /** The size budgets of the entries of `scenity build`, by the entry ID. */
  budgets: z.record(nameSchema, entryBudgetSchema).optional(),
});

/** An SPDX licence ID (`CC0-1.0`, `CC-BY-4.0`, `LicenseRef-<name>` for a licence with no SPDX ID). */
export const spdxIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/, "an SPDX licence ID (CC0-1.0, CC-BY-4.0, LicenseRef-name)");

/**
 * The licence rules of a release. A rights record passes when its `spdx` ID is in `allow`, or when the
 * licence register in `register` allows its source and licence. With no rule, no licence passes.
 */
export const licenceRulesSchema = z.strictObject({
  /** The SPDX IDs that the project accepts. */
  allow: z.array(spdxIdSchema).optional(),
  /** The path of a licence register file (`register.json`), relative to the project folder. */
  register: relativePathSchema.optional(),
});

const assetKindPattern = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "an asset kind (model, texture, acme.name)");

/** The assets that an approval rule applies to. An asset must match each list that the rule gives. */
export const approvalScopeSchema = z.strictObject({
  kinds: z.array(assetKindPattern).min(1).optional(),
  /** The asset must have one of these tags. */
  tags: z.array(tagSchema).min(1).optional(),
});

/** An approval role of the project: a reviewer of this role approves each asset in the scope. */
export const approvalRuleSchema = z.strictObject({
  role: nameSchema,
  label: z.string().min(1).max(80).optional(),
  /** True (the default): the release gate needs a current approval of this role. */
  required: z.boolean().optional(),
  /** The assets of the rule (default: all assets). */
  appliesTo: approvalScopeSchema.optional(),
});

/** The rules of the release gate: the licences, the rights reviews, the refused tags and the approvals. */
export const releaseSchema = z.strictObject({
  licences: licenceRulesSchema.optional(),
  /** `review: true`: each rights record needs a reviewer and a done text review. */
  rights: z.strictObject({ review: z.boolean().optional() }).optional(),
  /** An asset with one of these tags cannot go into a release (for example `sample`). */
  denyTags: z.array(tagSchema).optional(),
  approvals: z
    .array(approvalRuleSchema)
    .refine((rules) => new Set(rules.map((rule) => rule.role)).size === rules.length, {
      message: "each approval rule has its own role",
    })
    .optional(),
});

export const unitsSchema = z.strictObject({
  length: z.literal("m").optional(),
  up: z.literal("y").optional(),
  /** The scale of one metre in the source assets, when the art uses another unit (0.01 for centimetres). */
  assetScale: z.number().gt(0).optional(),
});

export const surfaceSchema = z.strictObject({
  id: nameSchema,
  /** The surface kind: `scene` (the editor), `web`, `console`, `gallery` or a kind of a plugin. */
  kind: nameSchema,
  label: z.string().min(1).max(80),
  /**
   * What the page of the surface can do, for example `scene` (the scene bridge of the tools) and `index` (the
   * frames fill the frame index). Without the list, the workbench host gives the defaults of the kind.
   */
  capabilities: z
    .array(nameSchema)
    .refine((names) => new Set(names).size === names.length, { message: "each capability is in the list once" })
    .optional(),
  /** The start path of the frame on the server of the surface, for example `/` or `/scene.html`. */
  page: z
    .string()
    .regex(/^\/[^\\\s]*$/, "a page is a path on the server that starts with '/'")
    .optional(),
  /** A hidden surface runs, but it has no tab and no key. */
  hidden: z.boolean().optional(),
  /** The place of the tab: a low order comes first. ⌘1 to ⌘9 follow the order of the tabs. */
  order: z.number().int().optional(),
});

/** A button of a run in the Runs tab: a label and the arguments of the run. */
export const runPresetSchema = z.strictObject({
  label: z.string().min(1).max(80),
  args: z.array(z.string()).optional(),
  /** The button gets a sequence field with this start text. The sequence goes in front of the arguments. */
  sequence: z.string().optional(),
  /** The button asks the owner with this text first. Then the run starts as a confirmed run. */
  confirm: z.string().min(1).optional(),
});

/**
 * One run of the workbench: a command line and what the host does with it. The host adds `--out <folder>` when `out`
 * has a value. It adds the arguments of the owner or the agent after the command line.
 */
export const runSpecSchema = z.strictObject({
  /** The command line, for example `scenity check` or `bun run lint`. The host runs it with no shell. */
  command: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  /** The kind: `check`, `render`, `write`, `release`, `review` (the review pack of a loop) or `tool` (the default). */
  kind: nameSchema.optional(),
  /** The folder of the output folders, relative to the project folder. Each run gets `<out>/<id>-<run>`. */
  out: relativePathSchema.optional(),
  /** True: one run of this kind at a time per checkout. `confirmed`: only a confirmed run uses the GPU. */
  gpu: z.union([z.boolean(), z.literal("confirmed")]).optional(),
  /** The flags that make a run with no GPU use, for example `--check`. */
  gpuOff: z.array(z.string().regex(/^--/)).optional(),
  /** True: the host adds `--dry` until the owner confirms the run. */
  confirm: z.boolean().optional(),
  /** True: the host adds `--ref <the commit of the session start>` when the arguments have no `--ref`. */
  ref: z.boolean().optional(),
  /** How the run takes a sequence: a flag (`--sequence`), or "" for the first argument. `required`: no default. */
  sequence: z.strictObject({ flag: z.string(), required: z.boolean().optional() }).optional(),
  /** False: the agent tool `workbench_run` cannot start the run (the default is true, false for `write`). */
  agent: z.boolean().optional(),
  /** Other command lines that do the same. The hook of the agent names the run for them. */
  aliases: z.array(z.string().min(1)).optional(),
  /** The buttons of the run in the Runs tab. */
  presets: z.array(runPresetSchema).optional(),
});

export const workbenchSchema = z.strictObject({
  surfaces: z.array(surfaceSchema),
  /** The runs of the Runs tab: a name and a command line, or a name and a run. */
  runs: z.record(nameSchema, z.union([z.string().min(1), runSpecSchema])).optional(),
  /** The command that prepares a new checkout. */
  setup: z.string().min(1).optional(),
  /**
   * The stop gate: the run (its name or its command line) that a turn of an agent must pass before it ends. Without
   * it, a project with a manifest gets `scenity check`.
   */
  gate: z.string().min(1).optional(),
  contentRoots: pathList.optional(),
  /** The path patterns that an agent and an import must not read. */
  denylist: z.array(z.string().min(1)).optional(),
  credentialFile: relativePathSchema.optional(),
  theme: nameSchema.optional(),
});

/** True when each inline rule of a list has its own ID. */
function uniqueRuleIds(items: readonly (string | { readonly id: string })[]): boolean {
  const ids = items.flatMap((item) => (typeof item === "string" ? [] : [item.id]));
  return new Set(ids).size === ids.length;
}

export const projectSchema = z.strictObject({
  format: z.literal("scenity.project/1"),
  id: idSchema,
  name: z.string().min(1).max(200),
  scenes: pathList,
  sequences: pathList.optional(),
  /** The asset roots, relative to the project folder. */
  assets: pathList.optional(),
  /** The plugins: a path relative to the project, or a package name. */
  plugins: z.array(z.string().min(1)).optional(),
  /**
   * The rules of the project: the path of a rules document (`*.rules.json`), or a rule. Each inline rule ID is
   * in the list one time.
   */
  rules: z
    .array(z.union([rulesPathSchema, ruleSchema]))
    .refine((items) => uniqueRuleIds(items), { message: "each rule ID is in the list one time" })
    .optional(),
  units: unitsSchema.optional(),
  quality: qualitySchema.optional(),
  /** The build settings (the asset build is in `build.assets`). */
  build: buildSchema.optional(),
  /** The rules of the release gate: licences, rights reviews and approval roles. */
  release: releaseSchema.optional(),
  workbench: workbenchSchema.optional(),
});

export type ProjectDocument = z.infer<typeof projectSchema>;
export type WorkbenchSettings = z.infer<typeof workbenchSchema>;
export type RunSpec = z.infer<typeof runSpecSchema>;
export type RunPreset = z.infer<typeof runPresetSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type AssetBuildConfig = z.infer<typeof assetBuildSchema>;
export type LodConfig = z.infer<typeof lodSchema>;
export type TextureCodecsConfig = z.infer<typeof textureCodecsSchema>;
export type QualityConfig = z.infer<typeof qualitySchema>;
export type ReleaseConfig = z.infer<typeof releaseSchema>;
export type ApprovalRule = z.infer<typeof approvalRuleSchema>;
export type EntryBudgetConfig = z.infer<typeof entryBudgetSchema>;
