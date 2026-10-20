// SPDX-License-Identifier: Apache-2.0
// The import by drop of the lab page: the drop point from a pick or
// the floor under the pointer, the file types, the bridge calls of the import job, and the drop of the desktop shell
// (`importDropAt`: the point in the frame from the workbench page, the `import` event without a file).
import { describe, expect, it, vi } from "vitest";
import { extensionOf, previewFormat, type PickCamera, type PickResult } from "@scenity/runtime-dev";
import { shallowRef } from "vue";
import { IMPORT_BRIDGE_CALLS } from "../../src/core/importDrop/bridgeCalls";
import { dropPoint, FLOOR_HEIGHT } from "../../src/core/importDrop/dropPoint";
import { useImportDrop } from "../../src/core/importDrop/useImportDrop";

/** A camera at (0, 2, 4) that looks at the origin, 800 × 600 px, 60° vertical field (column-major matrices). */
function camera(): PickCamera {
  const n = Math.hypot(2, 4);
  // The axes of the camera: right, up, back (the camera looks along -back).
  const right = [1, 0, 0];
  const up = [0, 4 / n, -2 / n];
  const back = [0, 2 / n, 4 / n];
  const world = [...right, 0, ...up, 0, ...back, 0, 0, 2, 4, 1];
  const f = 1 / Math.tan(Math.PI / 6);
  const aspect = 800 / 600;
  const [near, far] = [0.1, 100];
  const a = (far + near) / (near - far);
  const b = (2 * far * near) / (near - far);
  // The inverse of the perspective projection of three.js.
  const projectionInverse = [aspect / f, 0, 0, 0, 0, 1 / f, 0, 0, 0, 0, 0, 1 / b, 0, 0, -1, a / b];
  return { world, projectionInverse, width: 800, height: 600 };
}

function pick(kind: PickResult["kind"], point: [number, number, number]): PickResult {
  return {
    kind,
    id: "x",
    object: "x",
    bone: null,
    point,
    distance: 3,
    near: [],
    local: null,
    pane: 0,
    camera: camera(),
  };
}

describe("dropPoint", () => {
  it("puts a drop on a prop top on its surface, and a drop on the floor on the floor", () => {
    expect(dropPoint(pick("prop", [0.5, 0.9, -1]), null, 0, 0)).toEqual({ at: [0.5, 0.9, -1], on: "surface" });
    expect(dropPoint(pick("room", [1.2345, FLOOR_HEIGHT / 2, 2]), null, 0, 0)).toEqual({
      at: [1.235, 0, 2],
      on: "floor",
    });
  });

  it("puts a drop on a wall, a member or an item of a plugin kind on the floor under the hit", () => {
    expect(dropPoint(pick("room", [2, 1.5, -3]), null, 0, 0)).toEqual({ at: [2, 0, -3], on: "floor" });
    expect(dropPoint(pick("member", [0.4, 1.2, 0.8]), null, 0, 0)).toEqual({ at: [0.4, 0, 0.8], on: "floor" });
    expect(dropPoint(pick("figure", [0, 0.9, 0]), null, 0, 0)?.on).toBe("floor");
  });

  it("without a hit, takes the floor plane under the pointer from the camera of the last pick", () => {
    // The centre of the canvas looks at the origin.
    const at = dropPoint(null, camera(), 400, 300)?.at ?? [9, 9, 9];
    expect(Math.abs(at[0])).toBeLessThan(1e-3);
    expect(Math.abs(at[2])).toBeLessThan(1e-3);
    expect(dropPoint(null, null, 400, 300)).toBeNull();
    // Above the horizon: no floor point.
    expect(dropPoint(null, camera(), 400, 0)).toBeNull();
  });
});

describe("the file types", () => {
  it("previews .glb, .gltf, .obj and .fbx; a .blend file needs the host", () => {
    expect(previewFormat("Chair.OBJ")).toBe(".obj");
    expect(previewFormat("a.fbx")).toBe(".fbx");
    expect(previewFormat("a.blend")).toBeNull();
    expect(extensionOf(".hidden")).toBe("");
  });
});

describe("the bridge calls of the import", () => {
  it("gives the state and the model of a job to the import functions of the page", async () => {
    const show = vi.fn(() => Promise.resolve({ id: "import-1", triangles: 12, scale: 1 }));
    const status = vi.fn();
    globalThis.__labImport = { show, status, list: () => [], clear: () => undefined };
    try {
      IMPORT_BRIDGE_CALLS.importStatus?.([{ drop: "drop-1", state: "running", text: "Importing" }]);
      expect(status).toHaveBeenCalledWith({ drop: "drop-1", state: "running", text: "Importing" });
      const bytes = new ArrayBuffer(4);
      await IMPORT_BRIDGE_CALLS.importPreview?.([
        bytes,
        { name: "a.glb", point: [1, 0, 2], label: "optimized, not placed", drop: "drop-1" },
      ]);
      expect(show).toHaveBeenCalledWith(bytes, {
        name: "a.glb",
        point: [1, 0, 2],
        label: "optimized, not placed",
        drop: "drop-1",
      });
      expect(() => IMPORT_BRIDGE_CALLS.importPreview?.(["no bytes", {}])).toThrow("bytes of a GLB");
      expect(() => IMPORT_BRIDGE_CALLS.importStatus?.([{ drop: 1 }])).toThrow("drop must be a text");
    } finally {
      globalThis.__labImport = undefined;
    }
  });
});

describe("the drop of the desktop shell", () => {
  function setUp() {
    const emitted: Record<string, unknown>[] = [];
    globalThis.__workbench = { origin: "tauri://localhost", calls: () => [], emit: (body) => emitted.push(body) };
    const picks: [number, number][] = [];
    const view = {
      pick: (x: number, y: number) => {
        picks.push([x, y]);
        return Promise.resolve(pick("room", [1.2, 0.001, -0.4]));
      },
      previews: vi.fn(),
    };
    const drop = useImportDrop({ view: () => view, scene: shallowRef(null) });
    return { emitted, picks, view, drop };
  }

  it("takes the drop point at the point of the page, asks, and sends the import without a file", async () => {
    const { emitted, picks, view, drop } = setUp();
    try {
      IMPORT_BRIDGE_CALLS.importDragHint?.([true]);
      expect(drop.dragging.value).toBe(true);
      const answer = await IMPORT_BRIDGE_CALLS.importDropAt?.([{ drop: "shell-1", name: "box.glb", x: 119, y: 261 }]);
      expect(answer).toEqual({ point: [1.2, 0, -0.4], on: "floor" });
      expect(picks).toEqual([[119, 261]]);
      expect(drop.dragging.value).toBe(false);
      expect(drop.pending.value).toMatchObject({ drop: "shell-1", name: "box.glb", file: null });
      drop.send(" made by me ", "CC0-1.0");
      expect(emitted).toEqual([
        {
          event: "import",
          drop: "shell-1",
          file: null,
          name: "box.glb",
          point: [1.2, 0, -0.4],
          source: "made by me",
          licence: "CC0-1.0",
        },
      ]);
      // No bytes in the page: no quick preview.
      expect(view.previews).not.toHaveBeenCalled();
      expect(drop.status.value).toBe("box.glb: sent to the host for the import");
    } finally {
      globalThis.__workbench = undefined;
      globalThis.__labImport = undefined;
    }
  });

  it("refuses another format and checks the arguments of the call", async () => {
    const { emitted, drop } = setUp();
    try {
      const answer = await IMPORT_BRIDGE_CALLS.importDropAt?.([{ drop: "shell-2", name: "photo.png", x: 1, y: 1 }]);
      expect((answer as { refused: string }).refused).toContain("photo.png: the lab imports");
      expect(drop.pending.value).toBeNull();
      expect(drop.status.value).toContain("photo.png");
      expect(() => IMPORT_BRIDGE_CALLS.importDropAt?.([{ drop: "d", name: "a.glb", x: "1", y: 1 }])).toThrow(
        "x must be a finite number",
      );
      expect(emitted).toEqual([]);
    } finally {
      globalThis.__workbench = undefined;
      globalThis.__labImport = undefined;
    }
  });
});
