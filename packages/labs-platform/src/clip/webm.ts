// SPDX-License-Identifier: Apache-2.0
/**
 * A small WebM muxer for the clips of the lab and of `scenity clip`. It writes the encoded frames of WebCodecs into
 * one WebM file that Chromium and WebKit play. No dependency. It runs in a page and in Bun. The file has a SeekHead,
 * the Info with the duration, one video track, a Cluster for each key frame and the Cues. Thus a `<video>` knows its
 * duration and can seek. `readWebm` reads the file again (the tests and the checks of a clip).
 */
import {
  childOf,
  childrenOf,
  concat,
  encodeElement,
  idBytes,
  readElements,
  readFloat,
  readString,
  readUint,
} from "./ebml";
import type { EbmlElement } from "./ebml";

/** The element IDs of WebM that this muxer writes (the Matroska specification). */
export const WEBM = {
  ebml: 0x1a45dfa3,
  docType: 0x4282,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  defaultDuration: 0x23e383,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueClusterPosition: 0xf1,
} as const;

/** The WebM codec IDs of the WebCodecs codecs of a clip. */
export type WebmCodec = "V_VP9" | "V_AV1" | "V_VP8";

/** One encoded frame: its bytes, its time in microseconds from the start of the clip, and a key frame flag. */
export interface MuxFrame {
  readonly data: Uint8Array;
  readonly timestampUs: number;
  readonly key: boolean;
}

export interface MuxInput {
  readonly codec: WebmCodec;
  readonly width: number;
  readonly height: number;
  /** The time of one frame in microseconds (the default duration of the track and the end of the last frame). */
  readonly frameUs: number;
  readonly frames: readonly MuxFrame[];
  /** The codec private data (AV1: the `av1C` record), or none. */
  readonly codecPrivate?: Uint8Array | null;
}

/** The muxer writes times in milliseconds (a timestamp scale of 1 ms). */
const SCALE_NS = 1_000_000;
/** The largest time of a block from the start of its Cluster (a signed 16-bit number, in ms). */
const MAX_BLOCK_MS = 32_767;
/** The width of a SeekHead position: fixed, so the SeekHead has its size before the positions are known. */
const POSITION_WIDTH = 8;

function header(): Uint8Array {
  return encodeElement({
    id: WEBM.ebml,
    value: [
      { id: 0x4286, value: 1 },
      { id: 0x42f7, value: 1 },
      { id: 0x42f2, value: 4 },
      { id: 0x42f3, value: 8 },
      { id: WEBM.docType, value: "webm" },
      { id: 0x4287, value: 4 },
      { id: 0x4285, value: 2 },
    ],
  });
}

function info(durationMs: number): Uint8Array {
  return encodeElement({
    id: WEBM.info,
    value: [
      { id: WEBM.timestampScale, value: SCALE_NS },
      { id: WEBM.duration, value: { float: durationMs } },
      { id: 0x4d80, value: "scenity-editor" },
      { id: 0x5741, value: "scenity-editor" },
    ],
  });
}

function tracks(input: MuxInput): Uint8Array {
  const entry: EbmlElement[] = [
    { id: WEBM.trackNumber, value: 1 },
    { id: 0x73c5, value: 1 },
    { id: 0x83, value: 1 },
    { id: 0x9c, value: 0 },
    { id: WEBM.codecId, value: input.codec },
    { id: WEBM.defaultDuration, value: Math.round(input.frameUs * 1000) },
    {
      id: WEBM.video,
      value: [
        { id: WEBM.pixelWidth, value: input.width },
        { id: WEBM.pixelHeight, value: input.height },
      ],
    },
  ];
  if (input.codecPrivate !== undefined && input.codecPrivate !== null && input.codecPrivate.length > 0) {
    entry.push({ id: WEBM.codecPrivate, value: input.codecPrivate });
  }
  return encodeElement({ id: WEBM.tracks, value: [{ id: WEBM.trackEntry, value: entry }] });
}

function simpleBlock(frame: MuxFrame, relativeMs: number): Uint8Array {
  const head = new Uint8Array(4);
  // The track number as a variable-length integer (track 1), the time from the Cluster, and the key frame flag.
  head[0] = 0x81;
  new DataView(head.buffer).setInt16(1, relativeMs);
  head[3] = frame.key ? 0x80 : 0;
  return encodeElement({ id: WEBM.simpleBlock, value: concat([head, frame.data]) });
}

/** The frames in groups: a new group at each key frame, and before a block time goes past the 16-bit limit. */
function groups(frames: readonly MuxFrame[]): { readonly startMs: number; readonly frames: MuxFrame[] }[] {
  const out: { startMs: number; frames: MuxFrame[] }[] = [];
  for (const frame of frames) {
    const ms = Math.round(frame.timestampUs / 1000);
    const last = out.at(-1);
    if (last === undefined || frame.key || ms - last.startMs > MAX_BLOCK_MS) {
      if (last === undefined && !frame.key) throw new Error("WebM: the first frame of a clip must be a key frame.");
      out.push({ startMs: ms, frames: [frame] });
    } else {
      last.frames.push(frame);
    }
  }
  return out;
}

function seekHead(positions: readonly (readonly [number, number])[]): Uint8Array {
  return encodeElement({
    id: WEBM.seekHead,
    value: positions.map(([id, position]) => ({
      id: WEBM.seek,
      value: [
        { id: WEBM.seekId, value: idBytes(id) },
        { id: WEBM.seekPosition, value: position, width: POSITION_WIDTH },
      ],
    })),
  });
}

/** One WebM file from encoded frames (the times go up; the first frame is a key frame). */
export function muxWebm(input: MuxInput): Uint8Array {
  if (input.frames.length === 0) throw new Error("WebM: a clip needs at least one frame.");
  const last = input.frames.at(-1);
  const durationMs = ((last?.timestampUs ?? 0) + input.frameUs) / 1000;
  const infoBytes = info(durationMs);
  const trackBytes = tracks(input);
  const clusters = groups(input.frames).map((group) => ({
    startMs: group.startMs,
    key: group.frames[0]?.key === true,
    bytes: encodeElement({
      id: WEBM.cluster,
      value: concat([
        encodeElement({ id: WEBM.timestamp, value: group.startMs }),
        ...group.frames.map((frame) => simpleBlock(frame, Math.round(frame.timestampUs / 1000) - group.startMs)),
      ]),
    }),
  }));
  // The SeekHead has a fixed size: its positions are 8-byte numbers. The positions count from the Segment data.
  const headLength = seekHead([
    [WEBM.info, 0],
    [WEBM.tracks, 0],
    [WEBM.cues, 0],
  ]).length;
  const infoAt = headLength;
  const tracksAt = infoAt + infoBytes.length;
  let at = tracksAt + trackBytes.length;
  const cuePoints: EbmlElement[] = [];
  for (const cluster of clusters) {
    // A Cue for each Cluster that starts with a key frame: a seek can start to decode there.
    if (cluster.key)
      cuePoints.push({
        id: WEBM.cuePoint,
        value: [
          { id: WEBM.cueTime, value: cluster.startMs },
          {
            id: WEBM.cueTrackPositions,
            value: [
              { id: 0xf7, value: 1 },
              { id: WEBM.cueClusterPosition, value: at },
            ],
          },
        ],
      });
    at += cluster.bytes.length;
  }
  const cues = encodeElement({ id: WEBM.cues, value: cuePoints });
  const body = concat([
    seekHead([
      [WEBM.info, infoAt],
      [WEBM.tracks, tracksAt],
      [WEBM.cues, at],
    ]),
    infoBytes,
    trackBytes,
    ...clusters.map((cluster) => cluster.bytes),
    cues,
  ]);
  return concat([header(), encodeElement({ id: WEBM.segment, value: body })]);
}

/** What `readWebm` finds in a file. */
export interface WebmSummary {
  readonly docType: string;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly defaultDurationNs: number;
  readonly codecPrivate: Uint8Array | null;
  /** Each block: its time (ms from the start), its key frame flag and its size in bytes. */
  readonly blocks: readonly { readonly ms: number; readonly key: boolean; readonly bytes: number }[];
  /** Each cue: its time and the element ID at its Cluster position (a Cluster ID when it is right). */
  readonly cues: readonly { readonly ms: number; readonly target: number }[];
  /** Each SeekHead entry: the ID and the element ID at its position. */
  readonly seeks: readonly { readonly id: number; readonly target: number }[];
}

/** Read a WebM file of `muxWebm` (one video track). */
export function readWebm(bytes: Uint8Array): WebmSummary {
  const top = readElements(bytes);
  const ebml = top.find((node) => node.id === WEBM.ebml);
  const segment = top.find((node) => node.id === WEBM.segment);
  if (ebml === undefined || segment === undefined) throw new Error("WebM: no EBML header or no Segment.");
  const docType = childOf(bytes, ebml, WEBM.docType);
  const parts = childrenOf(bytes, segment);
  const find = (id: number) => {
    const node = parts.find((part) => part.id === id);
    if (node === undefined) throw new Error(`WebM: no element ${id.toString(16)}.`);
    return node;
  };
  const entry = childOf(bytes, find(WEBM.tracks), WEBM.trackEntry);
  const video = entry === undefined ? undefined : childOf(bytes, entry, WEBM.video);
  if (entry === undefined || video === undefined) throw new Error("WebM: no video track.");
  const uint = (parent: typeof entry, id: number) => {
    const node = childOf(bytes, parent, id);
    return node === undefined ? 0 : readUint(bytes, node);
  };
  const durationNode = childOf(bytes, find(WEBM.info), WEBM.duration);
  const codecNode = childOf(bytes, entry, WEBM.codecId);
  const privateNode = childOf(bytes, entry, WEBM.codecPrivate);
  const idAt = (position: number) => readElements(bytes, segment.dataStart + position, segment.dataEnd)[0]?.id ?? 0;
  const blocks = parts
    .filter((part) => part.id === WEBM.cluster)
    .flatMap((cluster) => {
      const children = childrenOf(bytes, cluster);
      const time = children.find((child) => child.id === WEBM.timestamp);
      const base = time === undefined ? 0 : readUint(bytes, time);
      return children
        .filter((child) => child.id === WEBM.simpleBlock)
        .map((block) => {
          const view = new DataView(bytes.buffer, bytes.byteOffset + block.dataStart, 4);
          return {
            ms: base + view.getInt16(1),
            key: (view.getUint8(3) & 0x80) !== 0,
            bytes: block.dataEnd - block.dataStart - 4,
          };
        });
    });
  const cues = childrenOf(bytes, find(WEBM.cues)).map((point) => {
    const positions = childOf(bytes, point, WEBM.cueTrackPositions);
    return {
      ms: uint(point, WEBM.cueTime),
      target: positions === undefined ? 0 : idAt(uint(positions, WEBM.cueClusterPosition)),
    };
  });
  const seeks = childrenOf(bytes, find(WEBM.seekHead)).map((seek) => {
    const idNode = childOf(bytes, seek, WEBM.seekId);
    return {
      id: idNode === undefined ? 0 : readUint(bytes, idNode),
      target: idAt(uint(seek, WEBM.seekPosition)),
    };
  });
  return {
    docType: docType === undefined ? "" : readString(bytes, docType),
    codec: codecNode === undefined ? "" : readString(bytes, codecNode),
    width: uint(video, WEBM.pixelWidth),
    height: uint(video, WEBM.pixelHeight),
    durationMs: durationNode === undefined ? 0 : readFloat(bytes, durationNode),
    defaultDurationNs: uint(entry, WEBM.defaultDuration),
    codecPrivate: privateNode === undefined ? null : bytes.slice(privateNode.dataStart, privateNode.dataEnd),
    blocks,
    cues,
    seeks,
  };
}
