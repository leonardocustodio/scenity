// SPDX-License-Identifier: Apache-2.0
/**
 * The WebM muxer of the clips. A file of `muxWebm` parses to the same header, track, frames, key frames, duration,
 * Cues and SeekHead (a header parse round trip). The EBML numbers have their correct widths.
 */
import { describe, expect, it } from "vitest";
import { encodeElement, readElements, sizeBytes, uintBytes } from "@scenity/labs-platform/ebml";
import { muxWebm, readWebm, WEBM, type MuxFrame } from "@scenity/labs-platform/webm";

function frame(ms: number, key: boolean, size = 10): MuxFrame {
  return { data: new Uint8Array(size).fill(ms % 251), timestampUs: ms * 1000, key };
}

describe("EBML numbers", () => {
  it("writes sizes in the shortest width and keeps the reserved all-ones value out", () => {
    expect([...sizeBytes(0)]).toEqual([0x80]);
    expect([...sizeBytes(126)]).toEqual([0xfe]);
    // 127 in one byte is 0xff, the reserved "unknown size": it takes two bytes.
    expect([...sizeBytes(127)]).toEqual([0x40, 0x7f]);
    expect([...sizeBytes(300)]).toEqual([0x41, 0x2c]);
  });

  it("writes unsigned integers in the shortest or a fixed width", () => {
    expect([...uintBytes(0)]).toEqual([0]);
    expect([...uintBytes(0x1234)]).toEqual([0x12, 0x34]);
    expect([...uintBytes(5, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 5]);
    expect(() => uintBytes(0x10000, 2)).toThrow(/too large/);
  });

  it("reads back the elements that it writes", () => {
    const bytes = encodeElement({ id: WEBM.info, value: [{ id: WEBM.timestampScale, value: 1_000_000 }] });
    const [info] = readElements(bytes);
    expect(info?.id).toBe(WEBM.info);
    const [scale] = readElements(bytes, info?.dataStart, info?.dataEnd);
    expect(scale?.id).toBe(WEBM.timestampScale);
    expect(scale === undefined ? 0 : scale.dataEnd - scale.dataStart).toBe(3);
  });
});

describe("muxWebm", () => {
  const frames = [0, 83, 167, 250, 333, 417].map((ms, index) => frame(ms, index % 3 === 0, 20 + index));

  it("gives a file whose header parses back to the same clip", () => {
    const file = muxWebm({ codec: "V_VP9", width: 640, height: 400, frameUs: 83_333, frames });
    const read = readWebm(file);
    expect(read.docType).toBe("webm");
    expect(read.codec).toBe("V_VP9");
    expect([read.width, read.height]).toEqual([640, 400]);
    expect(read.defaultDurationNs).toBe(83_333_000);
    // The last frame time and one frame: 417 + 83.333 ms.
    expect(read.durationMs).toBeCloseTo(500.333, 3);
    expect(read.codecPrivate).toBeNull();
    expect(read.blocks).toEqual(
      frames.map((item) => ({ ms: item.timestampUs / 1000, key: item.key, bytes: item.data.length })),
    );
  });

  it("starts a Cluster at each key frame, with a Cue that points at it", () => {
    const read = readWebm(muxWebm({ codec: "V_VP9", width: 640, height: 400, frameUs: 83_333, frames }));
    expect(read.cues).toEqual([
      { ms: 0, target: WEBM.cluster },
      { ms: 250, target: WEBM.cluster },
    ]);
  });

  it("has a SeekHead that points at the Info, the Tracks and the Cues", () => {
    const read = readWebm(muxWebm({ codec: "V_VP9", width: 640, height: 400, frameUs: 83_333, frames }));
    expect(read.seeks).toEqual([
      { id: WEBM.info, target: WEBM.info },
      { id: WEBM.tracks, target: WEBM.tracks },
      { id: WEBM.cues, target: WEBM.cues },
    ]);
  });

  it("writes the codec private data of AV1", () => {
    const av1c = Uint8Array.from([0x81, 0x04, 0x0c, 0]);
    const read = readWebm(
      muxWebm({ codec: "V_AV1", width: 320, height: 200, frameUs: 100_000, frames, codecPrivate: av1c }),
    );
    expect(read.codec).toBe("V_AV1");
    expect([...(read.codecPrivate ?? [])]).toEqual([...av1c]);
  });

  it("starts a new Cluster before a block time goes past the 16-bit limit", () => {
    const long = [frame(0, true), frame(20_000, false), frame(40_000, false)];
    const read = readWebm(muxWebm({ codec: "V_VP8", width: 64, height: 64, frameUs: 1_000_000, frames: long }));
    expect(read.blocks.map((block) => block.ms)).toEqual([0, 20_000, 40_000]);
    // The second Cluster starts with a frame that is not a key frame: it gets no Cue.
    expect(read.cues.map((cue) => cue.ms)).toEqual([0]);
  });

  it("refuses a clip without frames or with a first frame that is not a key frame", () => {
    expect(() => muxWebm({ codec: "V_VP9", width: 64, height: 64, frameUs: 1, frames: [] })).toThrow(/one frame/);
    expect(() => muxWebm({ codec: "V_VP9", width: 64, height: 64, frameUs: 1, frames: [frame(0, false)] })).toThrow(
      /key frame/,
    );
  });

  it("gives the same bytes for the same frames", () => {
    const input = { codec: "V_VP9" as const, width: 640, height: 400, frameUs: 83_333, frames };
    expect(muxWebm(input)).toEqual(muxWebm(input));
  });
});
