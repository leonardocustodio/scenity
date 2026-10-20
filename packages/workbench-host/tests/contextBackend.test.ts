// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer backend in the context packet. The camera line names the backend of the frame statistics and its
 * reason. A page without the field adds nothing.
 */
import { describe, expect, test } from "bun:test";
import { backendPart, buildPacket } from "../src/context";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";

describe("the backend of the context packet", () => {
  test("names the backend that runs, its reason and the choice when they differ", async () => {
    const stats = { backend: "webgl", backendReason: "entry_not_built", backendChosen: "webgpu" };
    const text = (await buildPacket(fakeContext(fakeLab({ ...labAnswers(), stats }).port))).text;
    expect(text).toContain(
      "Camera: side. Tier: high, worker. Backend: webgl (entry_not_built; the chooser gave webgpu).",
    );
  });

  test("gives the reason alone when the choice runs, and nothing without the field", () => {
    expect(backendPart({ backend: "webgl", backendReason: "url_override", backendChosen: "webgl" })).toBe(
      " Backend: webgl (url_override).",
    );
    expect(backendPart({ tier: "high" })).toBe("");
    expect(backendPart(null)).toBe("");
  });
});
