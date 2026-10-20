// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dietThree, dietThreeWebgpu, SHADER_LIB_KEEP } from "../src/build/threeDiet";

// three is a dependency of the render package, not of this package or of the workspace root.
const source = readFileSync(Bun.resolveSync("three", `${import.meta.dir}/../../render`), "utf8");

describe("the three.js diet", () => {
  it("replaces the environments and the WebXR manager with stubs, and the module still parses", () => {
    const out = dietThree(source);
    expect(out).toContain("The three.js of the 3D room has no environment maps");
    expect(out).toContain("The three.js of the 3D room has no WebXR");
    expect(out).not.toContain("new PMREMGenerator( renderer )");
    expect(out).not.toContain("new WebXRDepthSensing");
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(out)).not.toThrow();
    expect(out.length).toBeLessThan(source.length);
  });

  it("keeps the shaders of the materials of the room and the chunks that they include, and no other GLSL", () => {
    const out = dietThree(source);
    const chunkStart = out.indexOf("\nconst ShaderChunk = {\n");
    const chunks = out.slice(chunkStart, out.indexOf("\n};\n", chunkStart));
    const kept = new Set([...chunks.matchAll(/^\t(\w+): /gm)].map((match) => match[1]));
    // The shaders of the kept materials, with the chunks that the physical shader includes.
    for (const name of ["meshbasic_vert", "meshphysical_frag", "points_vert", "depth_frag", "distance_vert"]) {
      expect(kept.has(name)).toBe(true);
    }
    for (const name of ["lights_physical_pars_fragment", "shadowmap_pars_fragment", "tonemapping_pars_fragment"]) {
      expect(kept.has(name)).toBe(true);
    }
    // Each include of a kept chunk is a kept chunk too.
    const glsl = new Map<string, string>();
    for (const match of out.matchAll(/^(?:const|var) ([\w$]+) = ("(?:[^"\\\n]|\\.)*");$/gm)) {
      glsl.set(match[1] ?? "", JSON.parse(match[2] ?? '""') as string);
    }
    for (const match of chunks.matchAll(/^\t(\w+): ([\w$]+)/gm)) {
      for (const include of (glsl.get(match[2] ?? "") ?? "").matchAll(/#include +<(\w+)>/g)) {
        expect(kept.has(include[1])).toBe(true);
      }
    }
    // The shaders of the other materials are not there.
    for (const name of [
      "meshlambert_frag",
      "meshphong_frag",
      "meshtoon_frag",
      "sprite_vert",
      "shadow_frag",
      "cube_frag",
    ]) {
      expect(kept.has(name)).toBe(false);
    }
    const libStart = out.indexOf("\nconst ShaderLib = {\n");
    const lib = out.slice(libStart, out.indexOf("\nShaderLib.physical = {", libStart));
    for (const name of SHADER_LIB_KEEP) expect(lib).toContain(`\n\t${name}: {\n`);
    expect(lib).toContain("get lambert() {");
    expect(lib).toContain("The three.js of the 3D room has no lambert shader");
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(out)).not.toThrow();
  });

  it("fails on a source without the declarations (a three.js upgrade)", () => {
    expect(() => dietThree("export const x = 1;\n")).toThrow(/threeDiet/);
    expect(() => dietThreeWebgpu("export const x = 1;\n")).toThrow(/threeDiet/);
  });

  it("replaces the WebXR manager of three.webgpu.js with a stub", () => {
    const webgpu = readFileSync(
      Bun.resolveSync("three/webgpu", `${import.meta.dir}/../../render`).replace(/\.cjs$/, ".js"),
      "utf8",
    );
    const out = dietThreeWebgpu(webgpu);
    expect(out).toContain("The three.js of the 3D room has no WebXR");
    expect(out).not.toContain("new WebXRController()");
    // The node library has only the lights and the tone mapping of the room.
    const start = out.indexOf("\nclass BasicNodeLibrary extends NodeLibrary {");
    const library = out.slice(start, out.indexOf("\nclass ", start + 1));
    expect(library).toContain("The lights and the tone mapping of the 3D room only");
    expect(library).toContain("this.addLight( DirectionalLightNode, DirectionalLight );");
    expect(library).not.toContain("PointLight");
    expect(library).not.toContain("RectAreaLight");
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(out)).not.toThrow();
    expect(out.length).toBeLessThan(webgpu.length);
  });
});
