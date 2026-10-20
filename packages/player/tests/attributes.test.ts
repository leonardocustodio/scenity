// SPDX-License-Identifier: Apache-2.0
// The player options of the attributes of <scenity-player>. An absent attribute gives no option. A flag is on with
// no value or any value but "false". A bad tier or backend gives no option.
import { describe, expect, test } from "bun:test";
import { optionsOf } from "../src/attributes";

function element(attributes: Readonly<Record<string, string>>) {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
  };
}

describe("the attributes of <scenity-player>", () => {
  test("the attributes of the characters page", () => {
    const options = optionsOf(
      element({
        src: "/projects/characters/scenity.project.json",
        scene: "scenes/main.scene.json",
        sequence: "sequences/walk-wave.sequence.json",
        camera: "front",
        autoplay: "",
        loop: "",
      }),
    );
    expect(options).toEqual({
      project: "/projects/characters/scenity.project.json",
      scene: "scenes/main.scene.json",
      sequence: "sequences/walk-wave.sequence.json",
      camera: "front",
      autoplay: true,
      loop: true,
      start: 0,
    });
  });

  test("no sequence, the main thread, muted, a tier, a backend, a start time and a loop turned off", () => {
    const options = optionsOf(
      element({
        manifest: "/build/manifest.json",
        sequence: "none",
        worker: "false",
        muted: "",
        tier: "low",
        backend: "webgpu",
        start: "1500",
        loop: "false",
      }),
    );
    expect(options).toEqual({
      manifestUrl: "/build/manifest.json",
      sequence: null,
      worker: false,
      audio: false,
      tier: "low",
      backend: "webgpu",
      start: 1500,
      loop: false,
    });
  });

  test("a bad tier, a bad backend and a bad start give the defaults", () => {
    expect(optionsOf(element({ tier: "huge", backend: "metal", start: "soon" }))).toEqual({ start: 0 });
  });
});
