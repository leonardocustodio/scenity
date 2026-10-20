// SPDX-License-Identifier: Apache-2.0
/**
 * The preview and the facts of an asset in the asset inspector. Pure functions, no DOM.
 *
 * - The preview of each asset kind of docs/formats.md: a turntable for a model, a skinned model and an animation; the
 *   channels of a texture; the mirror and matte balls of an environment map; a player for audio; a material ball; the
 *   still for a scene, a prefab and a plugin kind.
 * - The facts: the size, the triangles, the meshes, the extent, the levels of detail, the clips and the rig (the list
 *   entry, the import report and the build manifest), and the facts of a texture and of a sound.
 */
import type { AssetDetails, AssetListEntry } from "../assetTypes";
import { markRaw, shallowReactive, type Component } from "vue";

/** The preview of an asset kind. */
export type PreviewKind = "turntable" | "texture" | "environment" | "audio" | "material" | "still";

const PREVIEWS: Readonly<Record<string, PreviewKind>> = {
  model: "turntable",
  "skinned-model": "turntable",
  animation: "turntable",
  texture: "texture",
  environment: "environment",
  audio: "audio",
  material: "material",
};

/** The preview of an asset kind (a scene, a prefab and a plugin kind show their still). */
export function previewOf(kind: string): PreviewKind {
  return PREVIEWS[kind] ?? "still";
}

/** A channel of the texture preview: all colours, one colour, or the alpha as grey. */
export type Channel = "rgb" | "r" | "g" | "b" | "a";
export const CHANNELS: readonly Channel[] = ["rgb", "r", "g", "b", "a"];

/** The pixels of one channel of RGBA pixels: the channel as grey, with full alpha ("rgb": the pixels as they are). */
export function channelPixels(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  channel: Channel,
): Uint8ClampedArray<ArrayBuffer> {
  if (channel === "rgb") return pixels;
  const at = { r: 0, g: 1, b: 2, a: 3 }[channel];
  const out = new Uint8ClampedArray(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index + at] ?? 0;
    out[index] = value;
    out[index + 1] = value;
    out[index + 2] = value;
    out[index + 3] = 255;
  }
  return out;
}

/** One fact of the inspector: the Fluent ID of its label and its value as data (no words to translate). */
export interface AssetFact {
  readonly label: string;
  readonly value: string;
}

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const group = (value: number): string => value.toLocaleString("en-US");

/** The size of a file in bytes as a short text (KB and MB with one decimal). */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The facts of a model report: the triangles, the meshes, the extent, the clips and the joints. */
function modelFacts(report: Readonly<Record<string, unknown>>, rig: unknown): AssetFact[] {
  const facts: AssetFact[] = [];
  const meshes = number(report.meshes);
  if (meshes !== null) facts.push({ label: "asset-fact-meshes", value: String(meshes) });
  const extent = Array.isArray(report.extent) ? report.extent.map(number) : [];
  if (extent.length === 3 && extent.every((value) => value !== null)) {
    facts.push({ label: "asset-fact-extent", value: `${extent.map((value) => String(value)).join(" × ")} m` });
  }
  if (Array.isArray(report.clips)) {
    const clips = report.clips.map(String);
    facts.push({ label: "asset-fact-clips", value: clips.length === 0 ? "0" : clips.join(", ") });
  }
  const joints = number(report.joints);
  if (typeof rig === "string") facts.push({ label: "asset-fact-rig", value: rig });
  else if (joints !== null && joints > 0) facts.push({ label: "asset-fact-joints", value: String(joints) });
  return facts;
}

/** The facts of a texture report (the pixel size and the type) and of a sound report (the length and the channels). */
function mediaFacts(report: Readonly<Record<string, unknown>>): AssetFact[] {
  const facts: AssetFact[] = [];
  const width = number(report.width);
  const height = number(report.height);
  if (width !== null && height !== null) {
    facts.push({ label: "asset-fact-pixels", value: `${String(width)} × ${String(height)}` });
  }
  if (typeof report.mimeType === "string") facts.push({ label: "asset-fact-type", value: report.mimeType });
  const duration = number(report.duration);
  if (duration !== null) facts.push({ label: "asset-fact-duration", value: `${duration.toFixed(2)} s` });
  const channels = number(report.channels);
  const rate = number(report.sampleRate);
  if (channels !== null && rate !== null) {
    facts.push({ label: "asset-fact-channels", value: `${String(channels)} · ${group(rate)} Hz` });
  }
  if (typeof report.codec === "string") facts.push({ label: "asset-fact-codec", value: report.codec });
  return facts;
}

/** The facts of an asset: the list entry, and the details when the source gives them. */
export function factsOf(asset: AssetListEntry, details: AssetDetails | null): AssetFact[] {
  const facts: AssetFact[] = [{ label: "asset-fact-size", value: sizeText(asset.stats.bytes) }];
  const report = details?.imported?.report ?? {};
  const triangles = asset.stats.triangles ?? number(report.triangles);
  if (triangles !== null) facts.push({ label: "asset-fact-triangles", value: group(triangles) });
  facts.push(...modelFacts(report, details?.record.rig), ...mediaFacts(report));
  const built = details?.built ?? [];
  if (built.length > 0) {
    const lods = built.map((lod) => (lod.triangles === null ? lod.tier : `${lod.tier} ${group(lod.triangles)}`));
    facts.push({ label: "asset-fact-lods", value: lods.join(" · ") });
  } else if (asset.stats.lods > 0) facts.push({ label: "asset-fact-lods", value: String(asset.stats.lods) });
  return facts;
}

/** The record fields of the inspector: the importer, the rights record, the tags, the build settings and the rig. */
export function recordFields(record: Readonly<Record<string, unknown>>): AssetFact[] {
  const fields: AssetFact[] = [];
  const text = (key: string, label: string): void => {
    const value = record[key];
    if (typeof value === "string") fields.push({ label, value });
  };
  text("importer", "asset-record-importer");
  text("source", "asset-record-source");
  text("rights", "asset-record-rights");
  if (Array.isArray(record.tags) && record.tags.length > 0) {
    fields.push({ label: "asset-record-tags", value: record.tags.map((tag) => `#${String(tag)}`).join(" ") });
  }
  if (typeof record.build === "object" && record.build !== null) {
    fields.push({ label: "asset-record-build", value: JSON.stringify(record.build) });
  }
  if (Array.isArray(record.approvals)) {
    fields.push({ label: "asset-record-approvals", value: String(record.approvals.length) });
  }
  return fields;
}

/** The previews of the plugins (the `previews` point of a studio face) by asset kind. */
export const PLUGIN_PREVIEWS = shallowReactive(new Map<string, Component>());

/** Add the preview of an asset kind of a plugin. The result removes it. */
export function addPluginPreview(kind: string, preview: Component): () => void {
  PLUGIN_PREVIEWS.set(kind, markRaw(preview));
  return () => {
    if (PLUGIN_PREVIEWS.get(kind) === preview) PLUGIN_PREVIEWS.delete(kind);
  };
}
