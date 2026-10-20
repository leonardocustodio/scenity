// SPDX-License-Identifier: Apache-2.0
/**
 * The port of the asset browser to the dev server: the asset list of a project and the import of a file
 * (scripts/assetApi.ts). The browser reads only this port, so a test or the workbench host
 * can give another one.
 *
 * The text of a failed request is a Fluent message of `src/i18n/en-US/assets.ftl`. The page shows it.
 */
import { t } from "../texts";
import { drawStill, projectOfBase } from "./pageStills";
import {
  ASSET_GENERATE_ESTIMATE_PATH,
  ASSET_GENERATE_RUN_PATH,
  ASSET_GENERATORS_PATH,
  ASSET_SOURCES_IMPORT_PATH,
  ASSET_SOURCES_PATH,
  ASSET_SOURCES_PREVIEW_PATH,
  ASSET_SOURCES_SEARCH_PATH,
  ASSET_EXPORT_PATH,
  ASSET_FIX_PATH,
  ASSET_PROBLEMS_PATH,
  ASSET_RELEASE_RUN_PATH,
  ASSET_APPROVAL_ROLE_PATH,
  ASSET_APPROVAL_WRITE_PATH,
  ASSET_APPROVALS_PATH,
  ASSET_HEALTH_PATH,
  ASSET_LICENCES_PATH,
  ASSET_LICENCES_WRITE_PATH,
  ASSET_RIGHTS_ASSIGN_PATH,
  ASSET_BUILD_PATH,
  ASSET_BUILD_RUN_PATH,
  ASSET_BUILD_SETTINGS_PATH,
  ASSET_DETAILS_PATH,
  ASSET_STILL_WRITE_PATH,
  ASSET_STILLS_PATH,
  ASSET_REIMPORT_PATH,
  ASSET_IMPORT_PATH,
  ASSET_LIST_PATH,
  IMPORT_HEADER,
  NAME_HEADER,
  OPTIONS_HEADER,
  ASSET_IMPORTERS_PATH,
  ASSET_RIGHTS_PATH,
  ASSET_RIGHTS_WRITE_PATH,
  type GenerateEstimateResult,
  type GenerateInput,
  type GeneratorInfo,
  type SourceImportInput,
  type SourceItemInfo,
  type SourceKindName,
  type SourceProviderInfo,
  type GlbExportInput,
  type GlbExportResult,
  type DatabaseFix,
  type DatabaseProblem,
  type ReleaseRunResult,
  type ApprovalInput,
  type ApprovalQueue,
  type AssetHealth,
  type LicencePolicy,
  type AssetBuildReport,
  type AssetBuildSettings,
  type AssetDetails,
  type AssetImportResult,
  type AssetList,
  type ImporterForm,
  type ImportOptions,
  type ReimportInput,
  type ReimportResult,
  type RightsInput,
  type RightsSummary,
  type RightsWriteResult,
  type StillJobInfo,
  type StillWriteResult,
} from "./assetTypes";

/** What the browser asks of its source. */
export interface AssetSource {
  /** The URL of the project folder, with a "/" at the end (the stills are relative to it). */
  readonly base: string;
  list(): Promise<AssetList>;
  importFile(file: File, options?: ImportOptions): Promise<AssetImportResult>;
  /** The importers with their settings forms, and the rights records of the project (none: no dialog). */
  importers?(): Promise<readonly ImporterForm[]>;
  rights?(): Promise<readonly RightsSummary[]>;
  /** Write a new rights record of the project. */
  writeRights?(input: RightsInput): Promise<RightsWriteResult>;
  /** The details of one asset (null: no details), and an import again. */
  details?(id: string): Promise<AssetDetails | null>;
  reimport?(input: ReimportInput): Promise<ReimportResult>;
  /** The stills plan of the project, and the still of one asset (the page draws it, the source writes it). */
  stills?(): Promise<readonly StillJobInfo[]>;
  makeStill?(job: StillJobInfo): Promise<StillWriteResult>;
  /** The build report of the project, a run of the build, and the build settings of one asset. */
  build?(): Promise<AssetBuildReport | null>;
  runBuild?(): Promise<WriteResult>;
  writeBuildSettings?(id: string, build: AssetBuildSettings | null): Promise<WriteResult>;
  /** The licence policy of the project, a new list of SPDX IDs, and one rights record for many assets. */
  licences?(): Promise<LicencePolicy | null>;
  writeLicences?(allow: readonly string[]): Promise<WriteResult>;
  assignRights?(ids: readonly string[], rights: string): Promise<WriteResult>;
  /** The health of the assets (the assets that the release gate stops), for the marks of the tiles. */
  health?(): Promise<AssetHealth | null>;
  /** The review queue of each approval role, a review, and a new role of the project. */
  approvals?(): Promise<ApprovalQueue | null>;
  writeApproval?(input: ApprovalInput): Promise<WriteResult>;
  addApprovalRole?(role: string, label: string): Promise<WriteResult>;
  /** Run `assets release-check` for the project. */
  releaseCheck?(): Promise<ReleaseRunResult>;
  /** The problems of the asset database with the choices of their fixes, and a fix. */
  databaseProblems?(): Promise<readonly DatabaseProblem[] | null>;
  fix?(fix: DatabaseFix): Promise<WriteResult>;
  /** Export a scene of the project as GLB. */
  exportGlb?(input: GlbExportInput): Promise<GlbExportResult>;
  /** The asset sources: the providers, a search, the URL of a preview, and an import with the rights record. */
  sourceProviders?(): Promise<readonly SourceProviderInfo[] | null>;
  searchSource?(provider: string, kind: SourceKindName, text: string): Promise<readonly SourceItemInfo[] | null>;
  sourcePreview?(provider: string, id: string): string;
  importSource?(input: SourceImportInput): Promise<AssetImportResult>;
  /** The generators, the cost of a run, and a run with the import of its result. */
  generators?(): Promise<readonly GeneratorInfo[] | null>;
  estimateGenerate?(input: GenerateInput): Promise<GenerateEstimateResult>;
  generate?(input: GenerateInput): Promise<AssetImportResult>;
}

/** The answer of a write: done, or the reason of a refusal. */
export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Read a JSON answer (null: no answer, or a failed request). */
async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  return response?.ok === true ? ((await response.json()) as T) : null;
}

/** Send a request as JSON (with the import header) and read its JSON answer. */
async function postAny<T extends { readonly ok: boolean }>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) return { ok: false, reason: response.message } as unknown as T;
  return (await response.json()) as T;
}

/** Send a write of the build panel as JSON (with the import header). */
function postJson(url: string, body: unknown): Promise<WriteResult> {
  return postAny<WriteResult>(url, body);
}

/** The text of a failed request: the reason of the answer, else the status. */
async function failure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { reason?: unknown };
    if (typeof body.reason === "string") return body.reason;
  } catch {
    // The answer is not JSON, so the function uses the status text.
  }
  return t("assets-server-answered", { status: String(response.status), text: response.statusText });
}

/** Draw the still of a job of the stills plan in the page, and send it to the dev server of the project `base`. */
async function makeStill(base: string, job: StillJobInfo): Promise<StillWriteResult> {
  const project = projectOfBase(base);
  if (project === null) return { ok: false, reason: t("assets-no-project-folder", { base }) };
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await drawStill(project, job);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const response = await fetch(`${base}${ASSET_STILL_WRITE_PATH}?id=${encodeURIComponent(job.id)}`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "image/webp" },
    body: bytes,
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) return { ok: false, reason: response.message };
  return (await response.json()) as StillWriteResult;
}

/** The calls of the asset panels (the build, the rights, the approvals, the release check). */
function projectCalls(base: string): Partial<AssetSource> {
  return {
    build: () => getJson<AssetBuildReport>(`${base}${ASSET_BUILD_PATH}`),
    runBuild: () => postJson(`${base}${ASSET_BUILD_RUN_PATH}`, {}),
    licences: () => getJson<LicencePolicy>(`${base}${ASSET_LICENCES_PATH}`),
    writeLicences: (allow: readonly string[]) => postJson(`${base}${ASSET_LICENCES_WRITE_PATH}`, { allow }),
    assignRights: (ids: readonly string[], rights: string) =>
      postJson(`${base}${ASSET_RIGHTS_ASSIGN_PATH}`, { ids, rights }),
    health: () => getJson<AssetHealth>(`${base}${ASSET_HEALTH_PATH}`),
    approvals: () => getJson<ApprovalQueue>(`${base}${ASSET_APPROVALS_PATH}`),
    writeApproval: (input: ApprovalInput) => postJson(`${base}${ASSET_APPROVAL_WRITE_PATH}`, input),
    addApprovalRole: (role: string, label: string) => postJson(`${base}${ASSET_APPROVAL_ROLE_PATH}`, { role, label }),
    async releaseCheck(): Promise<ReleaseRunResult> {
      const response = await fetch(`${base}${ASSET_RELEASE_RUN_PATH}`, {
        method: "POST",
        headers: { [IMPORT_HEADER]: "1" },
      }).catch((error: unknown) => error as Error);
      if (response instanceof Error) return { ok: false, reason: response.message };
      return (await response.json()) as ReleaseRunResult;
    },
    databaseProblems: () => getJson<DatabaseProblem[]>(`${base}${ASSET_PROBLEMS_PATH}`),
    fix: (fix: DatabaseFix) => postJson(`${base}${ASSET_FIX_PATH}`, fix),
    sourceProviders: () => getJson<SourceProviderInfo[]>(`${base}${ASSET_SOURCES_PATH}`),
    searchSource: (provider: string, kind: SourceKindName, text: string) =>
      getJson<SourceItemInfo[]>(
        `${base}${ASSET_SOURCES_SEARCH_PATH}?${new URLSearchParams({ provider, kind, q: text }).toString()}`,
      ),
    sourcePreview: (provider: string, id: string) =>
      `${base}${ASSET_SOURCES_PREVIEW_PATH}?${new URLSearchParams({ provider, id }).toString()}`,
    importSource: (input: SourceImportInput) =>
      postAny<AssetImportResult>(`${base}${ASSET_SOURCES_IMPORT_PATH}`, input),
    generators: () => getJson<GeneratorInfo[]>(`${base}${ASSET_GENERATORS_PATH}`),
    estimateGenerate: (input: GenerateInput) =>
      postAny<GenerateEstimateResult>(`${base}${ASSET_GENERATE_ESTIMATE_PATH}`, input),
    generate: (input: GenerateInput) => postAny<AssetImportResult>(`${base}${ASSET_GENERATE_RUN_PATH}`, input),
    exportGlb: (input: GlbExportInput) => postAny<GlbExportResult>(`${base}${ASSET_EXPORT_PATH}`, input),
    writeBuildSettings: (id: string, build: AssetBuildSettings | null) =>
      postJson(`${base}${ASSET_BUILD_SETTINGS_PATH}`, { id, build }),
  };
}

/** The source of the dev server of the page for the project folder `base` (`/projects/<name>/`). */
export function devServerAssets(base: string): AssetSource {
  return {
    base,
    async list() {
      const response = await fetch(`${base}${ASSET_LIST_PATH}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await failure(response));
      // A static host answers each path with the page, so the source has no asset list.
      if (!(response.headers.get("content-type") ?? "").includes("json")) throw new Error(t("assets-no-server"));
      return (await response.json()) as AssetList;
    },
    async importFile(file, options = {}) {
      const response = await fetch(`${base}${ASSET_IMPORT_PATH}`, {
        method: "POST",
        headers: {
          [IMPORT_HEADER]: "1",
          [NAME_HEADER]: encodeURIComponent(file.name),
          ...(Object.keys(options).length === 0
            ? {}
            : { [OPTIONS_HEADER]: encodeURIComponent(JSON.stringify(options)) }),
          "Content-Type": "application/octet-stream",
        },
        body: file,
      }).catch((error: unknown) => error as Error);
      if (response instanceof Error) return { ok: false, reason: response.message };
      if (!response.ok) return { ok: false, reason: await failure(response) };
      return (await response.json()) as AssetImportResult;
    },
    async importers() {
      const response = await fetch(`${base}${ASSET_IMPORTERS_PATH}`, { cache: "no-store" });
      return response.ok ? ((await response.json()) as ImporterForm[]) : [];
    },
    async rights() {
      const response = await fetch(`${base}${ASSET_RIGHTS_PATH}`, { cache: "no-store" });
      return response.ok ? ((await response.json()) as RightsSummary[]) : [];
    },
    async writeRights(input) {
      const response = await fetch(`${base}${ASSET_RIGHTS_WRITE_PATH}`, {
        method: "POST",
        headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch((error: unknown) => error as Error);
      if (response instanceof Error) return { ok: false, reason: response.message };
      return (await response.json()) as RightsWriteResult;
    },
    async details(id) {
      const url = `${base}${ASSET_DETAILS_PATH}?id=${encodeURIComponent(id)}`;
      const response = await fetch(url, { cache: "no-store" }).catch(() => null);
      return response?.ok === true ? ((await response.json()) as AssetDetails) : null;
    },
    async reimport(input) {
      const response = await fetch(`${base}${ASSET_REIMPORT_PATH}`, {
        method: "POST",
        headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch((error: unknown) => error as Error);
      if (response instanceof Error) return { ok: false, reason: response.message };
      return (await response.json()) as ReimportResult;
    },
    async stills() {
      const response = await fetch(`${base}${ASSET_STILLS_PATH}`, { cache: "no-store" }).catch(() => null);
      return response?.ok === true ? ((await response.json()) as StillJobInfo[]) : [];
    },
    makeStill: (job) => makeStill(base, job),
    ...projectCalls(base),
  };
}
