// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import type { AssetReport, SceneCoreOptions } from "@scenity/runtime/protocol";
import { SceneCore } from "@scenity/runtime/sceneCore";
import { tunable } from "@scenity/runtime/tuning";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import { withDevCore } from "../src/devCore";
import { parseSelect } from "../src/pickMath";
import { registerPickClassifier } from "../src/pickKinds";

// The dev core is a mixin over the generic scene core of the runtime. A plain core with no plugin gets the
// panes, the pick, the sweep and the tune hooks. The dev extension of a plugin tests the dev core over its own core.

interface BoxInput {
  readonly lift: number;
}

/** A plain scene core: a crate (a prop) and a lamp (an item of a plugin kind), and a counter as its frame memory. */
class BoxCore extends SceneCore<BoxInput, number, AssetReport> {
  readonly crate = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial());
  readonly lamp = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
  updates = 0;

  constructor(options: SceneCoreOptions) {
    super(options, { lift: 0 });
    this.crate.name = "prop-crate";
    this.lamp.name = "lamp-1";
    this.lamp.position.set(1.2, 0.5, 0);
    this.scene.add(this.crate, this.lamp);
    this.initView();
  }

  override setAssets(): void {
    // The test has no assets.
  }

  protected override assetReport(): AssetReport {
    return { assets: "none" } as AssetReport;
  }

  protected override aimCamera(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.position.set(0, 0.5, 3);
    this.camera.lookAt(0, 0.5, 0);
    this.camera.updateProjectionMatrix();
  }

  protected override updateScene(input: BoxInput): void {
    this.updates += 1;
    this.crate.position.set(0, 0.5 + input.lift, 0);
  }

  protected override saveMemory(): number {
    return this.updates;
  }

  protected override restoreMemory(): void {
    // The counter continues.
  }
}

/** The dev core over the plain core, with the places of its props and a tune hook. */
class DevBoxCore extends withDevCore(BoxCore) {
  readonly placed: boolean[] = [];

  protected override devPlaces() {
    return { crate: { at: [0, 0.5, 0] as const, yaw: 0 } };
  }

  protected override movesPlaces(changed: readonly string[]): boolean {
    return changed.length > 0;
  }

  protected override placeAgain(quick: boolean): void {
    this.placed.push(quick);
  }
}

function fakeBackend() {
  const draws: number[][] = [];
  let viewport = [0, 0, 800, 400];
  const renderer = {
    domElement: { width: 800, height: 400 } as OffscreenCanvas,
    shadowMap: { enabled: false, type: 1 as never },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    getSize: <T extends { set(x: number, y: number): T }>(target: T) => target.set(800, 400),
    render: () => undefined,
    getPixelRatio: () => 1,
    setViewport: (x: number, y: number, width: number, height: number) => {
      viewport = [x, y, width, height].map(Math.floor);
    },
    setScissor: () => undefined,
    setScissorTest: () => undefined,
  };
  const backend = {
    kind: "webgpu" as const,
    renderer,
    isReady: () => true,
    ready: Promise.resolve(),
    render: () => {
      draws.push([...viewport]);
    },
    info: () => ({ calls: 1, triangles: 1 }),
    memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
    timer: () => null,
    textureSupport: () => ({ gpuFeatures: { has: () => false } }),
    dispose: () => undefined,
  };
  return { draws, factory: () => backend };
}

function devCore(panes: "1" | "2h" = "1") {
  const backend = fakeBackend();
  let next: (() => void) | null = null;
  const options = {
    canvas: {} as OffscreenCanvas,
    surface: { width: 800, height: 400, dpr: 1 },
    tier: "high",
    flags: { paused: false, reducedMotion: false, visible: true, cards: false },
    clock: () => 1000,
    now: () => performance.now(),
    scheduler: {
      request: (callback: () => void) => {
        next = callback;
        return 1;
      },
      cancel: () => {
        next = null;
      },
    },
    mode: "main",
    backend: backend.factory,
    events: { ready: () => undefined, anchors: () => undefined, hit: () => undefined, context: () => undefined },
    panes: { layout: panes, views: [] },
  } as unknown as SceneCoreOptions;
  const core = new DevBoxCore(options);
  const frame = () => {
    const callback = next;
    next = null;
    callback?.();
  };
  return { core, draws: backend.draws, frame };
}

describe("the dev core over a plain scene core", () => {
  it("draws two panes after one update", () => {
    const { core, draws, frame } = devCore("2h");
    core.setClockStopped(true);
    frame();
    expect(core.updates).toBe(1);
    expect(draws).toEqual([
      [0, 0, 400, 400],
      [400, 0, 400, 400],
    ]);
    core.dispose();
  });

  it("picks a prop with its box, and an item of a kind that a plugin registers", () => {
    const { core, frame } = devCore();
    core.start();
    frame();
    const crate = core.pick(400, 200);
    expect(crate).toMatchObject({ kind: "prop", id: "crate", object: "prop-crate" });
    expect(crate?.local?.max[1]).toBeCloseTo(0.25, 6);
    registerPickClassifier({
      name: "test",
      kinds: ["lamp"],
      item: (name) => (name.startsWith("lamp-") ? { kind: "lamp", id: name } : null),
    });
    // The lamp is 1.2 m right at 3 m: the field of view is 45° high and the canvas is twice as wide as high.
    const lamp = core.pick(400 + (0.4 / (Math.tan(Math.PI / 8) * 2)) * 400, 200);
    expect(lamp).toMatchObject({ kind: "lamp", id: "lamp-1" });
    expect(parseSelect("lamp:lamp-1")).toEqual({ kind: "lamp", id: "lamp-1" });
    expect(parseSelect("shelf:a")).toBeNull();
    core.dispose();
  });

  it("gives a report at each time of a sweep without a render", () => {
    const { core } = devCore();
    const reports = core.sweep([
      { simMs: 100, input: { lift: 0.1 } },
      { simMs: 200, input: { lift: 0.2 } },
    ]);
    expect(reports.map((report) => report.simMs)).toEqual([100, 200]);
    expect(reports[1]?.members).toEqual([]);
    core.dispose();
  });

  it("places the props again after a tune change, the rest after a quick step", () => {
    const place = tunable("test.devCore.crate", { x: 0 });
    const { core } = devCore();
    expect(core.setTunes({ "no.such.path": 1 })).toEqual(["no.such.path"]);
    expect(core.placed).toEqual([]);
    // A quick step (a drag) places the props immediately; the call after the drag places them again in full.
    core.setTunes({ "test.devCore.crate.x": 0.3 }, true);
    expect(place.x).toBe(0.3);
    core.setTunes({ "test.devCore.crate.x": 0.3 });
    expect(core.placed).toEqual([true, false]);
    core.setTunes({});
    expect(place.x).toBe(0);
    core.dispose();
  });
});
