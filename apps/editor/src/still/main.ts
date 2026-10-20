// SPDX-License-Identifier: Apache-2.0
/**
 * The still page of the editor. It draws one asset of a Scenity project for the asset stills of @scenity/assets. The
 * stills script (scripts/stills/assetStills.ts) opens it in a browser with a GPU.
 *
 *   /still.html?project=<name>&mode=model|environment|texture&asset=<id>&file=<path in the project>&width=320&height=240
 *
 * A model or an environment map loads by its asset ID through the asset manifest, as on the scene page. It is the
 * built file of the "high" tier when the project has a build, else the source file. A texture loads from `file`. The
 * page loads the WASM decoders from `/decoders/` (the still server of scripts/stills serves them).
 *
 * The page sets `data-ready="1"` on the canvas when the view is drawn, or `data-error` with the message. Then
 * `globalThis.__scenityStill.capture(quality)` gives the WebP picture of the still size in base64.
 */
import type { Object3D, Texture } from "three";
import { ManifestAssets } from "@scenity/runtime/manifestAssets";
import { readAssets } from "../scene/assets";
import { environmentView, modelView, textureView, type StillDraw, type StillLoad } from "./views";

/** The WASM decoders of the still server (scripts/stills/stillServer.ts). */
const DECODERS = { basisWasm: "/decoders/basis_transcoder.wasm", dracoWasm: "/decoders/draco_decoder.wasm" };

/** The script API of the still page. */
export interface StillPageApi {
  /** The WebP picture of the still size in base64. */
  capture(quality: number): Promise<string>;
}

declare global {
  var __scenityStill: StillPageApi | undefined;
}

/** The load of an asset by its ID through the asset manifest of the project at `base`. */
function assetLoad<T extends Object3D | Texture>(
  base: string,
  id: string,
  kind: "model" | "environment",
): StillLoad<T> {
  return async (support) => {
    const { manifest, files, decoders } = await readAssets(base, null, DECODERS);
    const source = new ManifestAssets({ manifest, files, tier: "high", decoders }, support);
    return (await source.load(`asset:${id}`, kind)) as T;
  };
}

function drawFor(canvas: HTMLCanvasElement, params: URLSearchParams, base: string, url: string): Promise<StillDraw> {
  const mode = params.get("mode");
  if (mode === "texture") return textureView(url);
  const id = params.get("asset") ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`"${id}" is not an asset ID`);
  if (mode === "model") return modelView(canvas, assetLoad(base, id, "model"));
  if (mode === "environment") return environmentView(canvas, assetLoad(base, id, "environment"));
  throw new Error(`"${mode ?? ""}" is not a still mode`);
}

/** The bytes of a blob in base64. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

async function start(canvas: HTMLCanvasElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const project = params.get("project") ?? "";
  const file = params.get("file") ?? "";
  if (!/^[a-z0-9-]+$/.test(project)) throw new Error(`"${project}" is not a project name`);
  if (file === "" || file.split("/").includes("..")) throw new Error(`"${file}" is not a file of the project`);
  const width = Number(params.get("width") ?? 320);
  const height = Number(params.get("height") ?? 240);
  const base = `/projects/${project}/`;
  const url = `${base}${file.split("/").map(encodeURIComponent).join("/")}`;
  const draw = await drawFor(canvas, params, base, url);
  globalThis.__scenityStill = {
    async capture(quality) {
      const still = new OffscreenCanvas(width, height);
      const context = still.getContext("2d");
      if (context === null) throw new Error("no 2D context");
      context.imageSmoothingQuality = "high";
      draw(context, width, height);
      return base64(await still.convertToBlob({ type: "image/webp", quality }));
    },
  };
  canvas.dataset.ready = "1";
}

const canvas = document.querySelector<HTMLCanvasElement>("#still");
if (canvas !== null) {
  start(canvas).catch((error: unknown) => {
    canvas.dataset.error = error instanceof Error ? error.message : String(error);
    console.error(error);
  });
}
