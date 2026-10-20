// SPDX-License-Identifier: Apache-2.0
/**
 * The load of the documents into a document client: the scene, the sequence and the asset manifest in one "load"
 * message, then the document camera, then an empty patch that answers after the frame of the camera. The module is a
 * dep of the player, so the light player of a plugin core does not include it.
 */
import type { DocumentClient } from "@scenity/runtime/documentClient";
import type { LoadContext } from "./deps";
import type { PlayerContent } from "./project";
import { loadPluginCore } from "./source";

/** Send the documents and the manifest, then use the camera; the warnings of the load. */
export async function loadDocuments(
  client: DocumentClient,
  content: PlayerContent,
  context: LoadContext,
): Promise<string[]> {
  const { scene, sequence, manifest, files } = content;
  const documents = sequence === null ? { scene } : { scene, sequence };
  const { decoders, tier, camera } = context;
  const loaded = await client.load({ documents, manifest, files, decoders, tier });
  if (!loaded.ok) throw new Error(loaded.reason);
  if (!(await client.useCamera(camera))) throw new Error(`the scene has no camera "${camera ?? ""}"`);
  await client.patch([]);
  return [...content.warnings, ...context.warnings, ...loaded.warnings];
}

/** The loader of the full player: the documents, or the first frame of a plugin core. */
export function loadContentInto(
  client: DocumentClient,
  content: PlayerContent,
  context: LoadContext,
): Promise<string[]> {
  return context.core ? loadPluginCore(client, content, context) : loadDocuments(client, content, context);
}

/** The URL of the file of an `audio` asset (`asset:<id>`): the first file of its record. */
export function audioUrl(content: PlayerContent, asset: string): string {
  const id = asset.startsWith("asset:") ? asset.slice("asset:".length) : asset;
  const file = content.manifest.records.find((record) => record.id === id)?.files[0]?.file;
  const url = file === undefined ? undefined : content.files[file];
  if (url === undefined) throw new Error(`the manifest has no file for the sound ${asset}`);
  return url;
}

/** The loader of the sounds of the content: the bytes of an `audio` asset. */
export function soundFetch(
  fetch: (url: string) => Promise<Response>,
  content: PlayerContent,
): (asset: string) => Promise<ArrayBuffer> {
  return async (asset) => {
    const response = await fetch(audioUrl(content, asset));
    if (!response.ok) throw new Error(`the sound ${asset} did not load (${String(response.status)})`);
    return response.arrayBuffer();
  };
}
