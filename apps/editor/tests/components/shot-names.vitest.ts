// SPDX-License-Identifier: Apache-2.0
// The Shots panel: the parts of a shot name, the scene of a name, the poster value of a scene, and the result of each
// shot step of a verify log.
import { describe, expect, it } from "vitest";
import { verifySteps } from "../../scripts/shotsApi";
import { posterValue, sceneOfName, shotParts } from "../../src/scene/build/shotNames";

describe("the names of the Shots panel", () => {
  it("reads a shot name and the scene of a name", () => {
    expect(shotParts("test-results/shots/main--front@2500.png")).toEqual({ scene: "main", camera: "front", at: 2500 });
    expect(shotParts("main--scene.png")).toEqual({ scene: "main", camera: "scene", at: null });
    expect(shotParts("notes.txt")).toBeNull();
    expect(sceneOfName(["scenes/main.scene.json", "scenes/crowd.scene.json"], "crowd")).toBe("scenes/crowd.scene.json");
    expect(posterValue("scenes/main.scene.json", "posters/main.png")).toBe("../posters/main.png");
  });

  it("reads the shot steps of a verify log", () => {
    const log = [
      "== scenity check",
      "-- scenity check: passed",
      "== scenity shot scenes/main.scene.json front",
      "-- scenity shot scenes/main.scene.json front: FAILED",
      "== scenity shot scenes/main.scene.json (scene camera)",
      "-- scenity shot scenes/main.scene.json (scene camera): passed",
    ];
    expect(verifySteps(log)).toEqual([
      { name: "main--front.png", passed: false },
      { name: "main--scene.png", passed: true },
    ]);
  });
});
