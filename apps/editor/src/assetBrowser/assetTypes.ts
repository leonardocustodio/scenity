// SPDX-License-Identifier: Apache-2.0
/**
 * The data of the asset browser: the asset list and the import result of the dev server (scripts/assetApi.ts), the
 * request names and the drag payload of a tile. The page and the server share these types. No Vue and no Node imports.
 */

/** The request path of the asset list, under `/projects/<name>/`. */
export const ASSET_LIST_PATH = "assets.list.json";
/** The request path of an import (a POST of the file bytes), under `/projects/<name>/`. */
export const ASSET_IMPORT_PATH = "assets.import";
/** The path of the health of the assets (the release gate and the build) under the project folder. */
export const ASSET_HEALTH_PATH = "assets.health.json";

/** The health of the assets: the assets that the release gate stops, and the assets with no build output. */
export interface AssetHealth {
  readonly rights: readonly { readonly id: string; readonly problems: readonly string[] }[];
  readonly unbuilt: readonly string[];
}
/** The header of an import request. Its value is "1". */
export const IMPORT_HEADER = "x-scenity-asset-import";
/** The header with the file name of an import (URI-encoded). */
export const NAME_HEADER = "x-scenity-file-name";
/** The header with the options of an import, as URI-encoded JSON (`ImportOptions`). */
export const OPTIONS_HEADER = "x-scenity-import-options";
/** The request paths of the importers with their settings forms, and of the rights records. */
export const ASSET_IMPORTERS_PATH = "assets.importers.json";
export const ASSET_RIGHTS_PATH = "assets.rights.json";
/** The request path of a new rights record (a POST of `RightsInput` as JSON, with the import header). */
export const ASSET_RIGHTS_WRITE_PATH = "assets.rights.write";

/** The request path of the details of one asset (`?id=<asset ID>`), under `/projects/<name>/`. */
export const ASSET_DETAILS_PATH = "assets.asset.json";
/** The request path of an import again (a POST of `ReimportInput` as JSON, with the import header). */
export const ASSET_REIMPORT_PATH = "assets.reimport";

/** The import of an asset: the stamp `.scenity/imports/<id>/import.json` of `@scenity/assets/import`. */
export interface AssetImportFacts {
  readonly importer: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
  /** The report of the importer (a model: meshes, triangles, extent, textures, clips, joints). */
  readonly report: Readonly<Record<string, unknown>>;
  /** The output files, relative to the project folder. */
  readonly files: readonly string[];
}

/** One level of detail of the build of an asset. */
export interface BuiltLod {
  readonly tier: string;
  readonly file: string;
  readonly triangles: number | null;
  readonly bytes: number | null;
}

/** The details of one asset for the asset inspector. */
export interface AssetDetails {
  readonly id: string;
  /** The asset record as JSON (`*.meta.json`). */
  readonly record: Readonly<Record<string, unknown>>;
  /** The import of the asset, or null before the first import. */
  readonly imported: AssetImportFacts | null;
  /** The levels of detail of the build (empty: no build of the asset). */
  readonly built: readonly BuiltLod[];
}

/** An import again of an asset. `settings` replace the settings of the record first. */
export interface ReimportInput {
  readonly id: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** The answer of an import again: the new details, or the reason of a failure. */
export type ReimportResult =
  { readonly ok: true; readonly details: AssetDetails } | { readonly ok: false; readonly reason: string };

/** The request paths of the asset build panel: its state, a run of the build and the settings of an asset. */
export const ASSET_BUILD_PATH = "assets.build.json";
export const ASSET_BUILD_RUN_PATH = "assets.build.run";
export const ASSET_BUILD_SETTINGS_PATH = "assets.build.settings";

/** The build settings of one asset (`build` of the asset record): the texture codecs and the levels. */
export interface AssetBuildSettings {
  readonly codecs?: {
    readonly color?: string;
    readonly normal?: string;
    readonly data?: string;
    readonly environment?: string;
  };
  readonly lods?: number;
}

/** The build of one asset: its state (`AssetBuildState` of `@scenity/assets/build`) and its settings. */
export interface AssetBuildInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly state: "built" | "stale" | "unbuilt" | "failed";
  readonly reason: string | null;
  readonly lods: readonly BuiltLod[];
  readonly build: AssetBuildSettings | null;
}

/** The build job of the project: its state, its log lines and its exit code. */
export interface BuildJobInfo {
  readonly running: boolean;
  readonly log: readonly string[];
  /** The exit code of the last run (null: no run, or an active run). */
  readonly code: number | null;
}

/** The answer of the build request. */
export interface AssetBuildReport {
  readonly job: BuildJobInfo;
  readonly assets: readonly AssetBuildInfo[];
}

/** The request path of the stills plan of the project, under `/projects/<name>/`. */
export const ASSET_STILLS_PATH = "assets.stills.json";
/** The request path of a still that the page drew (a POST of the WebP bytes, `?id=<ID>`, with the import header). */
export const ASSET_STILL_WRITE_PATH = "assets.still.write";

/** The state of the still of an asset (`StillState` of `@scenity/assets/stills`). */
export type StillState = "current" | "stale" | "missing";

/** One still of the stills plan: what the still page draws, and the state of the still. */
export interface StillJobInfo {
  readonly id: string;
  readonly kind: string;
  /** The mode of the still page (model, environment, texture). */
  readonly mode: string;
  /** The file that the still page draws, relative to the project folder, or null (`problem` says why). */
  readonly input: string | null;
  readonly problem: string | null;
  readonly status: StillState;
  readonly reason: string | null;
  /** The size of the still in pixels (`STILL_SIZE` of `@scenity/assets/stills`). */
  readonly width: number;
  readonly height: number;
}

/** The answer of a still write. */
export type StillWriteResult =
  { readonly ok: true; readonly still: string } | { readonly ok: false; readonly reason: string };

/** The fields of a new rights record (`RightsInput` of `@scenity/assets/rights`). */
export interface RightsInput {
  readonly name: string;
  readonly source: string;
  readonly author: string;
  readonly licence: string;
  readonly spdx?: string | null;
  readonly licenceUrl?: string | null;
  readonly licenceDate: string;
  readonly allowedUse: readonly string[];
  readonly webDelivery: boolean | "pending";
  readonly attribution?: string | null;
}

/** The answer of a write of a rights record. */
export type RightsWriteResult =
  | { readonly ok: true; readonly path: string; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** An importer with the JSON Schema of its settings (`ImporterForm` of `@scenity/assets`). */
export interface ImporterForm {
  readonly name: string;
  readonly extensions: readonly string[];
  readonly kinds: readonly string[];
  readonly schema: Readonly<Record<string, unknown>>;
}

/** A rights record of the project (`RightsSummary` of `@scenity/assets/rights`). */
export interface RightsSummary {
  readonly path: string;
  readonly name: string;
  readonly licence: string;
  readonly spdx: string | null;
  readonly source: string;
  /** The problems of the record that the release gate sees. */
  readonly problems?: readonly string[];
}

/** The request paths of the licence policy of the project (`release.licences`) and of a rights assignment. */
export const ASSET_LICENCES_PATH = "assets.licences.json";
export const ASSET_LICENCES_WRITE_PATH = "assets.licences.write";
export const ASSET_RIGHTS_ASSIGN_PATH = "assets.rights.assign";

/** The licence policy of the project: the SPDX IDs that the release gate accepts, and the register file. */
export interface LicencePolicy {
  readonly allow: readonly string[];
  readonly register: string | null;
}

/** The request paths of the approvals: the queue of each role, a review, and a new role. */
export const ASSET_APPROVALS_PATH = "assets.approvals.json";
export const ASSET_APPROVAL_WRITE_PATH = "assets.approval.write";
export const ASSET_APPROVAL_ROLE_PATH = "assets.approval.role";

/** The state of a role for an asset (`ApprovalState` of `@scenity/assets/release`). */
export type ApprovalStateName = "missing" | "refused" | "stale" | "current";
/** The verdicts of a review. */
export type ApprovalVerdictName = "approved" | "changes" | "rejected";

/** An approval role of the project (`release.approvals`). */
export interface ApprovalRoleInfo {
  readonly role: string;
  readonly label: string | null;
  readonly required: boolean;
}

/** The review of one role for one asset: the state and the last verdict. */
export interface ApprovalCell {
  readonly state: ApprovalStateName;
  readonly verdict: ApprovalVerdictName | null;
  readonly reviewer: string | null;
  readonly date: string | null;
  readonly note: string | null;
}

/** One asset of the review queue, with the review of each role that applies to it. */
export interface ApprovalAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly roles: Readonly<Record<string, ApprovalCell>>;
}

/** The answer of the approvals request. */
export interface ApprovalQueue {
  readonly roles: readonly ApprovalRoleInfo[];
  readonly assets: readonly ApprovalAsset[];
}

/** A review from the panel. */
export interface ApprovalInput {
  readonly id: string;
  readonly role: string;
  readonly reviewer: string;
  readonly verdict: ApprovalVerdictName;
  readonly note?: string;
}

/** The request path of a run of `assets release-check` (a POST with the import header). */
export const ASSET_RELEASE_RUN_PATH = "assets.release.run";

/** One finding of the release gate (`ReleaseFinding` of `@scenity/assets/release`). */
export interface ReleaseFindingInfo {
  readonly level: "error" | "warning";
  readonly check: "record" | "rights" | "licence" | "tag" | "approval";
  /** An asset ID, a rights record name or a file. */
  readonly subject: string;
  /** The IDs of the assets that the finding stops. */
  readonly assets: readonly string[];
  readonly message: string;
}

/** The report of `assets release-check --json`, or the reason of a run that gave no report. */
export type ReleaseRunResult =
  | {
      readonly ok: true;
      readonly project: string;
      readonly assets: number;
      readonly passed: boolean;
      readonly findings: readonly ReleaseFindingInfo[];
    }
  | { readonly ok: false; readonly reason: string };

/** The request paths of the asset database tools: the problems of the database and a fix. */
export const ASSET_PROBLEMS_PATH = "assets.problems.json";
export const ASSET_FIX_PATH = "assets.fix";

/** One problem of the asset database (`AssetProblem` of `@scenity/assets`) with the choices of its fix. */
export interface DatabaseProblem {
  readonly code: string;
  /** The file of the problem (a record, a source or a document), relative to the project folder. */
  readonly file: string;
  readonly pointer: string | null;
  readonly id: string | null;
  readonly message: string;
  /** A missing source: the project files that can be the source (the same name first, then the same extension). */
  readonly sources: readonly string[];
  /** A broken reference: the assets that can take its place (the same kind of use first). */
  readonly assets: readonly { readonly id: string; readonly name: string; readonly kind: string }[];
}

/** A fix of the asset database. */
export type DatabaseFix =
  | { readonly action: "source"; readonly id: string; readonly source: string }
  | { readonly action: "reference"; readonly file: string; readonly pointer: string; readonly id: string }
  | { readonly action: "new-id"; readonly file: string };

/** The request path of a GLB export of a scene (a POST of `GlbExportInput` with the import header). */
export const ASSET_EXPORT_PATH = "assets.export.run";

/** The options of a GLB export. */
export interface GlbExportInput {
  /** The path of the scene file, relative to the project folder (or the ID of a scene of the project). */
  readonly scene: string;
  /** The output file, relative to the project folder (default `.scenity/exports/<scene id>.glb`). */
  readonly out?: string;
  /** Run the importer of each model first (default true). */
  readonly runImports?: boolean;
}

/** The result of a GLB export: the file, its size, the warnings and the errors of the glTF validator. */
export type GlbExportResult =
  | {
      readonly ok: true;
      readonly file: string;
      readonly bytes: number;
      readonly entities: number;
      readonly models: number;
      readonly warnings: readonly string[];
      readonly validatorErrors: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** The request paths of the asset sources: the providers, a search, a preview and an import. */
export const ASSET_SOURCES_PATH = "assets.sources.json";
export const ASSET_SOURCES_SEARCH_PATH = "assets.sources.search";
export const ASSET_SOURCES_PREVIEW_PATH = "assets.sources.preview";
export const ASSET_SOURCES_IMPORT_PATH = "assets.sources.import";

/** The kinds of items of a source (`SourceKind` of `@scenity/assets/sources`). */
export type SourceKindName = "environment" | "model" | "texture";

/** A provider of assets. */
export interface SourceProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly SourceKindName[];
  /** The SPDX ID of the licence of its items, or null. */
  readonly licence: string | null;
}

/** One item of a search (`SourceItem` of `@scenity/assets/sources`). */
export interface SourceItemInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKindName;
  readonly tags: readonly string[];
  readonly licence: string;
  readonly authors: readonly string[];
}

/** An import of an item of a source. */
export interface SourceImportInput {
  readonly provider: string;
  readonly id: string;
  readonly kind: SourceKindName;
  readonly resolution?: string;
}

/** The request paths of the generators: the list, the cost of a run, and a run with its import. */
export const ASSET_GENERATORS_PATH = "assets.generators.json";
export const ASSET_GENERATE_ESTIMATE_PATH = "assets.generate.estimate";
export const ASSET_GENERATE_RUN_PATH = "assets.generate.run";

/** A generator of assets. */
export interface GeneratorInfo {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly SourceKindName[];
}

/** A request to a generator. */
export interface GenerateInput {
  readonly generator: string;
  readonly prompt: string;
  readonly kind: SourceKindName;
}

/** The cost of a run, or the reason of a refusal. */
export type GenerateEstimateResult =
  | { readonly ok: true; readonly cost: number; readonly unit: string; readonly seconds: number }
  | { readonly ok: false; readonly reason: string };

/** The options of an import: the settings of the importer, the rights record and the folder. */
export interface ImportOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The rights record, relative to the project folder (default `rights/imports.yaml`). */
  readonly rights?: string;
  /** The import folder, relative to the project folder (default `assets/sources`). */
  readonly folder?: string;
}
/** The data type of the drag payload of a tile. The value is `asset:<id>` (a drop into the viewport reads it). */
export const ASSET_DRAG_TYPE = "application/x-scenity-asset";
/** The data type of the name of the dragged asset (the name of the new entity of a drop). */
export const ASSET_NAME_DRAG_TYPE = "application/x-scenity-asset-name";
/** The data type of the kind of the dragged asset (a texture for a slot, a material for a part). */
export const ASSET_KIND_DRAG_TYPE = "application/x-scenity-asset-kind";

/** One use of an asset in a document of the project. */
export interface AssetUseInfo {
  /** The path of the document, relative to the project folder. */
  readonly document: string;
  /** The entity that holds the reference, when the reference is under `/entities/<id>`. */
  readonly entity?: string;
  /** The JSON Pointer of the reference. */
  readonly pointer: string;
}

/** The numbers of an asset: from the build manifest when the project has a build, else from the source files. */
export interface AssetStats {
  readonly bytes: number;
  /** The triangles of the first level of detail, or null when the build does not give them. */
  readonly triangles: number | null;
  /** The levels of detail of the build (0: no build of the asset). */
  readonly lods: number;
}

/** One asset of the list. */
export interface AssetListEntry {
  readonly id: string;
  readonly kind: string;
  /** The name of the tile: the source file name with no extension. */
  readonly name: string;
  readonly tags: readonly string[];
  /** The source file and the record file, relative to the project folder. */
  readonly source: string;
  readonly record: string;
  /** The still of the tile, relative to the project folder, or null (the tile shows the icon of the kind). */
  readonly still: string | null;
  readonly stats: AssetStats;
  readonly usedBy: readonly AssetUseInfo[];
  /** The problems of the asset database for this asset (a missing source, a bad record). */
  readonly problems: readonly string[];
}

/** The answer of the asset list request. */
export interface AssetList {
  readonly assets: readonly AssetListEntry[];
  /** True when an import can write into the project. */
  readonly importable: boolean;
  /** Why an import cannot write, or null. */
  readonly reason: string | null;
  /** The file extensions that an importer reads (with the dot). */
  readonly extensions: readonly string[];
}

/** The answer of an import request. */
export type AssetImportResult =
  | {
      readonly ok: true;
      readonly asset: AssetListEntry;
      readonly warnings: readonly string[];
      /** The rights record of the new asset and one sentence about the release gate (absent: an older server). */
      readonly rights?: { readonly record: string; readonly note: string };
    }
  | { readonly ok: false; readonly reason: string };

/** The drag payload of an asset. */
export function assetDragValue(id: string): string {
  return `asset:${id}`;
}
