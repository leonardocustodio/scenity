// SPDX-License-Identifier: Apache-2.0
// The render queue: the check of a request, and the CLI arguments of a sheet and a clip.
import { describe, expect, it } from "vitest";
import { readRequest, renderArgs } from "../../scripts/renderQueueApi";

describe("the render queue", () => {
  it("checks a request", () => {
    expect(readRequest({ kind: "film", sequence: "s.sequence.json", from: 0, to: 1 })).toContain("a sheet or a clip");
    expect(readRequest({ kind: "clip", sequence: "../x", from: 0, to: 1 })).toContain("no sequence");
    expect(readRequest({ kind: "clip", sequence: "s.sequence.json", from: 500, to: 100 })).toContain("from < to");
    expect(
      readRequest({
        kind: "clip",
        sequence: "s.sequence.json",
        from: 0,
        to: 500.4,
        fps: 6,
        size: "320x200",
        camera: "front",
      }),
    ).toEqual({
      kind: "clip",
      sequence: "s.sequence.json",
      from: 0,
      to: 500,
      camera: "front",
      size: "320x200",
      fps: 6,
    });
  });

  it("gives the arguments of a sheet and of a clip", () => {
    const sheet = renderArgs(
      "/p",
      { kind: "sheet", sequence: "s.sequence.json", from: 0, to: 1000, step: 250 },
      "out.png",
    );
    expect(sheet.slice(1)).toEqual(
      expect.arrayContaining(["sheet", "/p", "--sequence", "s.sequence.json", "--step", "250", "--out", "/p/out.png"]),
    );
    const clip = renderArgs("/p", { kind: "clip", sequence: "s.sequence.json", from: 0, to: 500, fps: 6 }, "out.webm");
    expect(clip).toEqual(expect.arrayContaining(["clip", "--fps", "6", "--from", "0", "--to", "500"]));
  });
});
