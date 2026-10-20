// SPDX-License-Identifier: Apache-2.0
/**
 * The hot reload of assets on the scene page. The dev server sends the custom HMR
 * event `scenity:asset-reload` after a new import of an asset (scripts/assetReload.ts). The page replaces the record of
 * that asset with one dev record of the new file, puts the version in the file URL and sends a "load" with `reload`.
 * The document core loads the new file and swaps it into each entity that uses it, with no page reload: the camera,
 * the clock and the document stay. The build of the page (no dev server) has no `import.meta.hot`, so no reload.
 * Each reload gives one toast in the editor window (the file of the asset, and its warnings).
 */
import type { DocumentClient } from "@scenity/runtime/documentClient";
import { currentShell } from "../studio/shell/shell";
import { t } from "../texts";
import type { AssetManifest, AssetRecord } from "@scenity/runtime/manifest";

/** The custom HMR event of the dev server. */
export const ASSET_RELOAD_EVENT = "scenity:asset-reload";

/** The fields of the event that the page reads (`AssetReloadEvent` of scripts/assetReload.ts). */
export interface AssetReloadData {
  readonly project: string;
  readonly id: string;
  readonly kind: string;
  readonly version: string;
  /** The file to load, relative to the project folder. */
  readonly file: string;
  /** The time of the import on the server (ms). */
  readonly ms: number;
  readonly warnings: readonly string[];
}

/** One reload of the page: the asset, its version and the time from the event to the frame that shows it (ms). */
export interface AssetReload {
  readonly id: string;
  readonly version: string;
  readonly file: string;
  readonly ms: number;
  /** The time of the import on the server (ms). */
  readonly importMs: number;
  readonly ok: boolean;
  readonly warnings: readonly string[];
}

/** The asset part of the "load" messages: the page keeps it current over the reloads. */
export interface PageAssets {
  manifest: AssetManifest;
  files: Readonly<Record<string, string>>;
}

/** The manifest and the file URLs with the record of the asset of `event` replaced by one dev record of its file. */
export function reloadedAssets(assets: PageAssets, base: string, event: AssetReloadData): PageAssets {
  const old = assets.manifest.records.find((record) => record.id === event.id);
  const record: AssetRecord = {
    id: event.id,
    kind: event.kind,
    lods: [],
    files: [{ file: event.file, bytes: 0, sha256: "" }],
    bytes: 0,
    sha256: "",
    stats: {},
    tags: old?.tags ?? [],
  };
  const records = assets.manifest.records.filter((each) => each.id !== event.id);
  const url = `${base}${encodeURI(event.file)}?v=${encodeURIComponent(event.version)}`;
  return {
    manifest: { ...assets.manifest, records: [...records, record] },
    files: { ...assets.files, [event.file]: url },
  };
}

/** Listen to the reload events of a project. The result lists the reloads, oldest first. */
export function listenAssetReloads(
  hot: NonNullable<ImportMeta["hot"]>,
  project: string,
  base: string,
  assets: PageAssets,
  client: DocumentClient,
  onReload: (reload: AssetReload) => void = () => undefined,
): readonly AssetReload[] {
  const reloads: AssetReload[] = [];
  let queue = Promise.resolve();
  hot.on(ASSET_RELOAD_EVENT, (event: AssetReloadData) => {
    if (event.project !== project) return;
    const start = performance.now();
    // One reload at a time: each "load" carries the manifest with every reload before it.
    queue = queue.then(async () => {
      const next = reloadedAssets(assets, base, event);
      assets.manifest = next.manifest;
      assets.files = next.files;
      const result = await client.load({ ...next, reload: [`asset:${event.id}`] });
      const warnings = [...event.warnings, ...(result.ok ? result.warnings : [result.reason])];
      const ms = Math.round(performance.now() - start);
      const reload: AssetReload = {
        id: event.id,
        version: event.version,
        file: event.file,
        ms,
        importMs: event.ms,
        ok: result.ok,
        warnings,
      };
      reloads.push(reload);
      if (warnings.length > 0) console.warn(`asset ${event.id} reloaded with warnings: ${warnings.join("; ")}`);
      const title = t(result.ok ? "scene-asset-reloaded" : "scene-asset-reload-failed", { file: event.file });
      currentShell()?.notices.toast(
        title,
        warnings.length === 0 ? undefined : warnings.join("; "),
        result.ok ? "status" : "alert",
      );
      onReload(reload);
    });
    queue = queue.catch((error: unknown) => {
      console.error(`asset ${event.id} did not reload`, error);
    });
  });
  return reloads;
}
