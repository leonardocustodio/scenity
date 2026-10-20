// SPDX-License-Identifier: Apache-2.0
// The idle time of the projects: `SCENITY_STUDIO_IDLE_MS` gives the idle time of the host. A value that is not a
// positive number keeps the default.
import { describe, expect, test } from "bun:test";
import { idleOf } from "../src/main";

describe("the idle time of the projects", () => {
  test("comes from the variable when it is a positive number", () => {
    expect(idleOf({ SCENITY_STUDIO_IDLE_MS: "5000" })).toEqual({ idleMs: 5000 });
    expect(idleOf({ SCENITY_STUDIO_IDLE_MS: "0" })).toEqual({});
    expect(idleOf({ SCENITY_STUDIO_IDLE_MS: "soon" })).toEqual({});
    expect(idleOf({})).toEqual({});
  });
});
