// SPDX-License-Identifier: Apache-2.0
/**
 * The picture path of the workbench. A picture goes from a surface frame
 * to the host as bytes, never as base64:
 *
 * 1. The bridge of the frame gives the encoded bytes as an `ArrayBuffer` in the transfer list of `postMessage`.
 * 2. The page sends one binary WebSocket frame (`encodePictureHeader` + the bytes), then the JSON `surface.call` of the
 *    same request. The JSON result has `bytes: <byte count>` in place of the bytes.
 * 3. The host joins the two (`readPictureFrame`), keeps the bytes and stores the pictures that the page shows as
 *    files (`<state>/pictures/<id>.<ext>`). Base64 happens only at the MCP boundary (a tool result).
 * 4. The page shows a picture by its ID: `GET /pictures/<id>` with the token header, then an object URL.
 *
 * The module is pure (no `node:` or `bun:` import): the page imports it through `@scenity/workbench-host/protocol`.
 */

/**
 * The picture types of a capture: WebP; JPEG from WebKit (the Tauri window), which has no WebP encoder; PNG as
 * the last resort.
 */
export const CAPTURE_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;
export type CaptureMime = (typeof CAPTURE_MIMES)[number];

/** The file extension of each picture type in the picture store. */
export const PICTURE_EXTENSIONS: Readonly<Record<CaptureMime, string>> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** True for a picture type of a capture. */
export function isCaptureMime(value: unknown): value is CaptureMime {
  return (CAPTURE_MIMES as readonly unknown[]).includes(value);
}

/**
 * A picture of a frame in the host: the bytes of the encoded picture. Only the host has the bytes; the
 * page gets a `PictureRef`.
 */
export interface Capture {
  readonly simMs: number | null;
  readonly width: number;
  readonly height: number;
  readonly mime: CaptureMime;
  readonly bytes: Uint8Array;
}

/** A picture of the picture store for the page: the page reads the bytes at `GET /pictures/<id>`. */
export interface PictureRef {
  /** 32 lowercase hex characters: the start of the SHA-256 of the bytes. */
  readonly id: string;
  readonly simMs: number | null;
  readonly width: number;
  readonly height: number;
  readonly mime: CaptureMime;
}

/** The path of the picture route of the host: `GET /pictures/<id>` with the token header. */
export const PICTURE_PATH = "/pictures/";
/** The form of a picture ID. */
export const PICTURE_ID_PATTERN = /^[0-9a-f]{32}$/;

/** True for a picture ID. */
export function isPictureId(value: unknown): value is string {
  return typeof value === "string" && PICTURE_ID_PATTERN.test(value);
}

/** True for a picture reference of the host. */
export function isPictureRef(value: unknown): value is PictureRef {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isPictureId(item.id) &&
    (item.simMs === null || typeof item.simMs === "number") &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    isCaptureMime(item.mime)
  );
}

// The binary WebSocket frame of a picture (page to host).
/** The first bytes of a picture frame: "WBP" and the version of the frame layout. */
export const PICTURE_FRAME_MAGIC = [0x57, 0x42, 0x50, 0x01] as const;
/** The longest MIME text of a frame. */
const MIME_MAX = 64;
/** The size of the fixed part of the header: the magic, the request (u32) and the MIME length (u8). */
const FIXED_HEADER = PICTURE_FRAME_MAGIC.length + 4 + 1;

/** A picture frame: the `surface.request` number, the MIME type and the bytes. */
export interface PictureFrame {
  readonly request: number;
  readonly mime: string;
  /** A view into the frame (no copy). */
  readonly bytes: Uint8Array;
}

/**
 * The header of a picture frame: the magic, the request number (u32, little-endian), the length of the MIME text (u8)
 * and the MIME text (ASCII). The bytes of the picture follow the header.
 */
export function encodePictureHeader(request: number, mime: string): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(request) || request < 0 || request > 0xffff_ffff) {
    throw new Error("A picture frame needs a request number from 0 to 2^32 - 1.");
  }
  if (mime.length === 0 || mime.length > MIME_MAX || !/^[\x21-\x7e]+$/.test(mime)) {
    throw new Error("A picture frame needs a MIME type of 1 to 64 ASCII characters.");
  }
  const header = new Uint8Array(FIXED_HEADER + mime.length);
  header.set(PICTURE_FRAME_MAGIC, 0);
  new DataView(header.buffer).setUint32(PICTURE_FRAME_MAGIC.length, request, true);
  header[FIXED_HEADER - 1] = mime.length;
  for (let index = 0; index < mime.length; index += 1) header[FIXED_HEADER + index] = mime.charCodeAt(index);
  return header;
}

/** A whole picture frame in one buffer (the tests and the clients without `Blob`). */
export function encodePictureFrame(request: number, mime: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = encodePictureHeader(request, mime);
  const frame = new Uint8Array(header.length + bytes.length);
  frame.set(header, 0);
  frame.set(bytes, header.length);
  return frame;
}

/** Read a picture frame. Give null for bytes that are not a picture frame. */
export function readPictureFrame(data: Uint8Array): PictureFrame | null {
  if (data.length < FIXED_HEADER) return null;
  if (PICTURE_FRAME_MAGIC.some((byte, index) => data[index] !== byte)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const request = view.getUint32(PICTURE_FRAME_MAGIC.length, true);
  const length = data[FIXED_HEADER - 1] ?? 0;
  if (length === 0 || length > MIME_MAX || data.length < FIXED_HEADER + length) return null;
  let mime = "";
  for (let index = 0; index < length; index += 1) {
    const code = data[FIXED_HEADER + index] ?? 0;
    if (code < 0x21 || code > 0x7e) return null;
    mime += String.fromCharCode(code);
  }
  return { request, mime, bytes: data.subarray(FIXED_HEADER + length) };
}

/**
 * The JSON result of a call whose picture came as a binary frame: the fields of the result, and `bytes` with the byte
 * count in place of the bytes. The host puts the bytes of the frame into `bytes` again.
 */
export function isBytesMarker(value: unknown): value is Record<string, unknown> & { bytes: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const bytes = (value as { bytes?: unknown }).bytes;
  return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0;
}

/** True for a capture of the bridge `capture` call, with its bytes (after the host joined the binary frame). */
export function isCapture(value: unknown): value is Capture {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.simMs === null || typeof item.simMs === "number") &&
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    isCaptureMime(item.mime) &&
    item.bytes instanceof Uint8Array
  );
}
