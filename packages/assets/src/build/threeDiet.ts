// SPDX-License-Identifier: Apache-2.0
/**
 * A Vite plugin that removes dead parts of three.js from the 3D room. The room has no environment map (a Color
 * background, no `envMap`, no `scene.environment`) and starts no WebXR session. But WebGLRenderer refers to both, so
 * the bundler keeps them. The plugin replaces two declarations of `three/build/three.module.js` with small stubs:
 *
 * - `WebGLEnvironments`: `get` returns a plain texture, as three.js does, and throws for an environment map (a PMREM,
 *   an equirectangular or a cube map). Then the bundler removes PMREMGenerator and WebGLCubeRenderTarget.
 * - `WebXRManager`: never presents. Then the bundler removes WebXRController and the depth sensing.
 * - `ShaderLib` and `ShaderChunk`: the WebGL renderer finds the shader of a material by name at run time, so the
 *   bundler keeps the GLSL of all materials. The room draws only the materials of SHADER_LIB_KEEP. Each other entry
 *   of ShaderLib becomes a getter that throws, and ShaderChunk keeps only the chunks that the kept shaders include,
 *   directly or through other chunks. WebGLProgram resolves each `#include` when it compiles a program, so a material
 *   of another kind or a missing chunk throws there, before the first frame of that material.
 *
 * The WebGPU entries load `three/build/three.webgpu.js`. The plugin replaces its `XRManager` with a stub of the same
 * kind: the renderer reads `enabled` and `isPresenting` and never presents. Then the bundler removes the XR layers and
 * WebXRController from the WebGPU chunks. The plugin also replaces `BasicNodeLibrary` with a library of the lights and
 * the tone mapping that the room uses (two directional lights, a hemisphere light, ACES Filmic). A light of another
 * kind does not draw on WebGPU (three.js gives a warning): add its node here. The WebGL entries do not load
 * three.webgpu.js. But the main build has one `three.core.js` for both cores. Thus a class of three.core.js that only
 * the WebGPU renderer uses goes into the chunk that the WebGL core also loads. Without the library stub, the point,
 * spot, rect area, ambient and probe lights go into that chunk.
 *
 * A stub throws when the room calls a removed part, so a new environment map or XR shows an error, not a wrong frame.
 * The plugin fails the build when it does not find a declaration (a three.js upgrade). Then compare the stubs with the
 * new WebGLRenderer.
 */
/** The part of a Vite plugin that this plugin has (@scenity/assets has no Vite dependency). */
interface TransformPlugin {
  readonly name: string;
  readonly enforce: "pre";
  transform(code: string, id: string): { code: string; map: null } | null;
}

const MODULE = /[\\/]three[\\/]build[\\/]three\.module\.js$/;
const WEBGPU_MODULE = /[\\/]three[\\/]build[\\/]three\.webgpu\.js$/;

const ENVIRONMENTS_STUB = `function WebGLEnvironments() {
	// The 3D room has no environment map.
	function get( texture, usePMREM = false ) {
		if ( texture === null || texture === undefined ) return null;
		const mapping = texture.mapping;
		if ( usePMREM || texture.isCubeTexture === true || mapping === EquirectangularReflectionMapping || mapping === EquirectangularRefractionMapping || mapping === CubeReflectionMapping || mapping === CubeRefractionMapping || mapping === CubeUVReflectionMapping ) {
			throw new Error( 'The three.js of the 3D room has no environment maps.' );
		}
		return texture;
	}
	return { get, dispose() {} };
}

`;

const XR_STUB = `class WebXRManager extends EventDispatcher {
	// The 3D room starts no WebXR session.
	constructor() {
		super();
		this.enabled = false;
		this.isPresenting = false;
		this.cameraAutoUpdate = true;
	}
	getEnvironmentBlendMode() { return undefined; }
	hasDepthSensing() { return false; }
	getDepthSensingMesh() { return null; }
	setAnimationLoop() {}
	updateCamera() {}
	getCamera() { throw new Error( 'The three.js of the 3D room has no WebXR.' ); }
	dispose() {}
}

`;

const WEBGPU_XR_STUB = `class XRManager extends EventDispatcher {
	// The 3D room starts no WebXR session.
	constructor() {
		super();
		this.enabled = false;
		this.isPresenting = false;
		this.cameraAutoUpdate = true;
	}
	getEnvironmentBlendMode() { return undefined; }
	renderLayers() {}
	foveateBoundTexture() {}
	updateCamera() {}
	getCamera() { throw new Error( 'The three.js of the 3D room has no WebXR.' ); }
	dispose() {}
}

`;

/** The declarations to replace: the first line of each, and its stub. */
const STUBS: readonly (readonly [string, string])[] = [
  ["function WebGLEnvironments( renderer ) {", ENVIRONMENTS_STUB],
  ["class WebXRManager extends EventDispatcher {", XR_STUB],
];

const WEBGPU_LIBRARY_STUB = `class BasicNodeLibrary extends NodeLibrary {
	// The lights and the tone mapping of the 3D room only.
	constructor() {
		super();
		this.addLight( DirectionalLightNode, DirectionalLight );
		this.addLight( HemisphereLightNode, HemisphereLight );
		this.addToneMapping( acesFilmicToneMapping, ACESFilmicToneMapping );
	}
}

`;

/** The declarations of three.webgpu.js to replace. */
const WEBGPU_STUBS: readonly (readonly [string, string])[] = [
  ["class XRManager extends EventDispatcher {", WEBGPU_XR_STUB],
  ["class BasicNodeLibrary extends NodeLibrary {", WEBGPU_LIBRARY_STUB],
];

/** The next top-level declaration after `from`: the declarations of the module start at the start of a line. */
const TOP_LEVEL = /^(?:function|class|const|let|var|export) /gm;

/** Replace each declaration of `stubs` in `source`. Throws when a declaration is not in the source. */
function replaceDeclarations(source: string, stubs: readonly (readonly [string, string])[], file: string): string {
  let out = source;
  for (const [head, stub] of stubs) {
    const start = out.indexOf(`\n${head}\n`);
    if (start < 0) throw new Error(`threeDiet: no "${head}" in ${file} (a three.js upgrade?)`);
    TOP_LEVEL.lastIndex = start + head.length + 2;
    const next = TOP_LEVEL.exec(out);
    if (next === null) throw new Error(`threeDiet: no declaration after "${head}" in ${file}`);
    out = `${out.slice(0, start + 1)}${stub}${out.slice(next.index)}`;
  }
  return out;
}

/**
 * The entries of ShaderLib that the room draws: `basic` (MeshBasicMaterial, LineBasicMaterial), `standard` (and
 * `ShaderLib.physical`: MeshStandardMaterial, MeshPhysicalMaterial), `points` (PointsMaterial), and `depth` and
 * `distance` (the materials of the shadow maps). The labs build has the same diet, so its debug layers use these
 * materials too. Add the entry of a new material kind here.
 */
export const SHADER_LIB_KEEP: ReadonlySet<string> = new Set(["basic", "standard", "points", "depth", "distance"]);

/** A block of the source: its start, its end and its body (the text between the braces). */
interface Block {
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

/** The block that starts with `head` (a line of the source) and ends at the next line "};". */
function blockOf(source: string, head: string, from = 0): Block {
  const start = source.indexOf(`\n${head}\n`, from);
  if (start < 0) throw new Error(`threeDiet: no "${head}" in three.module.js (a three.js upgrade?)`);
  const end = source.indexOf("\n};\n", start);
  if (end < 0) throw new Error(`threeDiet: no end of "${head}" in three.module.js`);
  return { start: start + 1, end: end + 4, body: source.slice(start + head.length + 2, end) };
}

/** The GLSL of each string declaration of the module (`const name = "…";` or `var name = "…";`). */
function glslStrings(source: string): Map<string, string> {
  const strings = new Map<string, string>();
  for (const match of source.matchAll(/^(?:const|var) ([\w$]+) = ("(?:[^"\\\n]|\\.)*");$/gm)) {
    strings.set(match[1] ?? "", JSON.parse(match[2] ?? '""') as string);
  }
  return strings;
}

/** The chunk names of each `ShaderChunk.name` and `ShaderChunk[ 'name' ]` in a text. */
function chunkRefs(text: string): string[] {
  return [...text.matchAll(/ShaderChunk(?:\.(\w+)|\[ '(\w+)' \])/g)].map((match) => match[1] ?? match[2] ?? "");
}

/** The source with only the shaders of SHADER_LIB_KEEP and the chunks that they include. */
function dietShaders(source: string): string {
  const chunks = blockOf(source, "const ShaderChunk = {");
  const lib = blockOf(source, "const ShaderLib = {", chunks.end);
  const physical = blockOf(source, "ShaderLib.physical = {", lib.end);
  const table = new Map<string, string>();
  for (const line of chunks.body.split("\n")) {
    const match = /^\t(\w+): ([\w$]+),?$/.exec(line);
    if (match !== null) table.set(match[1] ?? "", match[2] ?? "");
    else if (line.trim() !== "") throw new Error(`threeDiet: an unknown line in ShaderChunk: "${line}"`);
  }
  const heads = [...lib.body.matchAll(/^\t(\w+): \{$/gm)];
  const entries = heads.map((head, index) => {
    const end = heads[index + 1]?.index ?? lib.body.length;
    return { name: head[1] ?? "", text: lib.body.slice(head.index, end).replace(/,?\s*$/, "") };
  });
  if (entries.length === 0) throw new Error("threeDiet: no entries in ShaderLib");
  for (const name of SHADER_LIB_KEEP) {
    if (!entries.some((entry) => entry.name === name)) throw new Error(`threeDiet: no "${name}" in ShaderLib`);
  }
  const kept = entries.filter((entry) => SHADER_LIB_KEEP.has(entry.name));
  // The chunks of the kept shaders, the chunks that WebGLProgram reads by name, and the chunks that they include.
  const outside = source.slice(0, chunks.start) + source.slice(physical.end);
  const strings = glslStrings(source);
  const needed = new Set([...kept.map((entry) => entry.text), physical.body].flatMap(chunkRefs));
  for (const name of chunkRefs(outside)) needed.add(name);
  const open = [...needed];
  for (let name = open.pop(); name !== undefined; name = open.pop()) {
    const glsl = strings.get(table.get(name) ?? "");
    if (glsl === undefined) throw new Error(`threeDiet: no GLSL of the chunk "${name}"`);
    for (const include of glsl.matchAll(/#include +<(\w+)>/g)) {
      const child = include[1] ?? "";
      if (table.has(child) && !needed.has(child)) {
        needed.add(child);
        open.push(child);
      }
    }
  }
  const chunkLines = [...table].filter(([name]) => needed.has(name)).map(([name, value]) => `\t${name}: ${value}`);
  const libItems = entries.map((entry) =>
    SHADER_LIB_KEEP.has(entry.name)
      ? entry.text
      : `\tget ${entry.name}() {\n\t\tthrow new Error( 'The three.js of the 3D room has no ${entry.name} shader (@scenity/assets threeDiet.ts).' );\n\t}`,
  );
  return [
    source.slice(0, chunks.start),
    `const ShaderChunk = {\n${chunkLines.join(",\n")}\n};\n`,
    source.slice(chunks.end, lib.start),
    `const ShaderLib = {\n\n${libItems.join(",\n\n")}\n\n};\n`,
    source.slice(lib.end),
  ].join("");
}

/** The source of three.module.js with the stubs. Throws when a declaration is not in the source. */
export function dietThree(source: string): string {
  return dietShaders(replaceDeclarations(source, STUBS, "three.module.js"));
}

/** The source of three.webgpu.js with the stubs. Throws when a declaration is not in the source. */
export function dietThreeWebgpu(source: string): string {
  return replaceDeclarations(source, WEBGPU_STUBS, "three.webgpu.js");
}

export function threeDiet(): TransformPlugin {
  return {
    name: "scenity-three-diet",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0] ?? id;
      if (MODULE.test(path)) return { code: dietThree(code), map: null };
      if (WEBGPU_MODULE.test(path)) return { code: dietThreeWebgpu(code), map: null };
      return null;
    },
  };
}
