// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  assetRef,
  brokenReferences,
  entityRef,
  findReferences,
  formatRef,
  parseRef,
  sceneRef,
  joinPath,
  resolveFrom,
} from "../src/index";
import { fixture } from "./helpers";

describe("references", () => {
  test("parse and format each form", () => {
    expect(parseRef("asset:01J9Z6Q3R9")).toEqual({ kind: "asset", id: "01J9Z6Q3R9" });
    expect(parseRef("entity:cart")).toEqual({ kind: "entity", id: "cart" });
    expect(parseRef("entity:robot#hand_r")).toEqual({ kind: "entity", id: "robot", sub: "hand_r" });
    expect(parseRef("scene:main")).toEqual({ kind: "scene", id: "main" });
    for (const text of ["asset:01J9Z6Q3R9", "entity:cart", "entity:robot#hand_r", "scene:main"]) {
      expect(formatRef(parseRef(text)!)).toBe(text);
    }
    expect(assetRef("a")).toBe("asset:a");
    expect(entityRef("e", "s")).toBe("entity:e#s");
    expect(sceneRef("s")).toBe("scene:s");
  });

  test("text that is not a reference", () => {
    for (const text of ["cart", "entity:", "entity:a b", "entity:a#", "asset:", "file:x", "scene:a#b", "http://x"]) {
      expect(parseRef(text)).toBeUndefined();
    }
  });

  test("findReferences gives each reference with its path", () => {
    const refs = findReferences(fixture("main.scene.json", "scene"));
    expect(refs.map((item) => item.path)).toEqual(["/entities/cart/components/model/asset", "/environment/map"]);
  });

  test("brokenReferences reports an entity reference to a missing entity", () => {
    const workshop = fixture("workshop.scene.json", "scene");
    expect(brokenReferences(workshop)).toEqual([]);
    const broken = { ...workshop, entities: { ...workshop.entities } };
    delete broken.entities.cart;
    expect(brokenReferences(broken).map((item) => item.path)).toEqual([
      "/entities/top/components/camera/safeFrame/entities/1",
    ]);
  });
});

describe("paths", () => {
  test("join and resolve relative paths", () => {
    expect(joinPath("a/b", "../c/./d.json")).toBe("a/c/d.json");
    expect(joinPath("", "x.json")).toBe("x.json");
    expect(joinPath("a", "../../x")).toBe("../x");
    expect(resolveFrom("scenes/main.scene.json", "variants/wide.overrides.json")).toBe(
      "scenes/variants/wide.overrides.json",
    );
  });
});
