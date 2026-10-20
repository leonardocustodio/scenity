// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity create`: the files of the two templates, the documents in the canonical form that the readers accept, the
 * package.json with the links of the checkout or a published version, the install steps, and the setup errors.
 * `scenity check` passes on the empty template.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinRegistry, readDocument } from "@scenity/scene";
import { canonicalJson } from "@scenity/scene/canonical";
import { runCheck } from "../src/check/run";
import { createProject, createText, CreateError, type CreateOptions } from "../src/create/command";
import { dependencySpecs, installSteps, PROJECT_PACKAGES, projectPackage } from "../src/create/package";
import { readSources, sha256, SHOWROOM_TEMPLATE_DIR, sourceFiles } from "../src/create/showroom";
import { EMPTY_SCENE } from "../src/create/templates";

const ROOT = join(import.meta.dir, "../../..");
const temp = mkdtempSync(join(tmpdir(), "scenity-cli-create-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const EMPTY: CreateOptions = { name: "demo", template: "empty", version: null, install: false };

/** The error of a promise that must fail. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("the promise did not fail");
}

function read(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

const result = await createProject(EMPTY, temp);

describe("scenity create: the empty template", () => {
  test("the files of the project folder", () => {
    expect(result.dir).toBe(join(temp, "demo"));
    expect(result.id).toBe("demo");
    expect(result.files).toEqual([
      ".gitignore",
      "assets/.gitkeep",
      "package.json",
      "rights/.gitkeep",
      EMPTY_SCENE,
      "scenity.project.json",
    ]);
    expect(read(result.dir, ".gitignore")).toContain(".scenity/");
  });

  test("the project and the scene read, and they are in the canonical form", () => {
    const registry = builtinRegistry();
    const project = readDocument(read(result.dir, "scenity.project.json"), "project", { registry });
    expect(project.ok).toBe(true);
    if (project.ok) expect(project.doc.scenes).toEqual([EMPTY_SCENE]);
    const sceneText = read(result.dir, EMPTY_SCENE);
    const scene = readDocument(sceneText, "scene", { registry });
    expect(scene.ok).toBe(true);
    expect(canonicalJson(JSON.parse(sceneText))).toBe(sceneText);
    if (scene.ok) expect(Object.keys(scene.doc.entities).sort()).toEqual(["box", "fill", "floor", "front", "sun"]);
  });

  test("the package.json links the packages of the checkout", () => {
    const data = JSON.parse(read(result.dir, "package.json")) as Record<string, unknown>;
    expect(data.dependencies).toEqual({
      "@scenity/cli": "link:@scenity/cli",
      "@scenity/scene": "link:@scenity/scene",
      "@scenity/runtime": "link:@scenity/runtime",
      "@scenity/editor": "link:@scenity/editor",
    });
    expect(data.scripts).toMatchObject({ dev: "scenity dev", build: "scenity build", check: "scenity check" });
    expect(data.scenity).toEqual({ project: "." });
    expect(result.linked).toBe(true);
    expect(createText(result, temp)).toContain("  bun install");
  });

  test("scenity check passes on the new project", async () => {
    const report = await runCheck({ dir: result.dir });
    expect(report.passed).toBe(true);
    expect(report.rules).toBe(1);
  });

  test("a folder that is not empty, or a name that is not an ID, stops the create", async () => {
    expect(await rejection(createProject(EMPTY, temp))).toBeInstanceOf(CreateError);
    expect((await rejection(createProject({ ...EMPTY, name: "bad name" }, temp))).message).toMatch(/not a project ID/);
    mkdirSync(join(temp, "empty-folder"));
    expect((await createProject({ ...EMPTY, name: "empty-folder" }, temp)).files).toContain("scenity.project.json");
  });
});

describe("scenity create: the showroom template and a published version", () => {
  const sample = join(ROOT, "samples/showroom");
  const sources = readSources(SHOWROOM_TEMPLATE_DIR);
  /** A download from the files of the sample, by the URL of the source list. */
  const fromSample = (url: string): Promise<Uint8Array> => {
    const source = sources.files.find((file) => file.url === url);
    if (source === undefined) return Promise.reject(new Error(`no source ${url}`));
    return Promise.resolve(new Uint8Array(readFileSync(join(sample, source.path))));
  };

  test("the template has the documents, the records, the rights and the sources with their hashes, no build", async () => {
    const result = await createProject({ ...EMPTY, name: "room", template: "showroom", version: "^0.1.0" }, temp);
    const project = JSON.parse(read(result.dir, "scenity.project.json")) as { id: string; name: string };
    expect(project).toMatchObject({ id: "room", name: "room" });
    expect(existsSync(join(result.dir, "rights/polyhaven.yaml"))).toBe(true);
    expect(existsSync(join(result.dir, "build"))).toBe(false);
    expect(existsSync(join(result.dir, "dist"))).toBe(false);
    expect(existsSync(join(result.dir, "sources.json"))).toBe(false);
    const scene = join(sample, "scenes/main.scene.json");
    expect(read(result.dir, "scenes/main.scene.json")).toBe(readFileSync(scene, "utf8"));
    for (const source of sources.files) {
      expect(sha256(readFileSync(join(result.dir, source.path)))).toBe(source.sha256);
    }
    expect(sources.files.every((file) => file.url.startsWith("https://dl.polyhaven.org/"))).toBe(true);
    const data = JSON.parse(read(result.dir, "package.json")) as { dependencies: Record<string, string> };
    expect(Object.values(data.dependencies)).toEqual(["^0.1.0", "^0.1.0", "^0.1.0", "^0.1.0"]);
    expect(result.linked).toBe(false);
  });

  test("with no checkout the sources come from their URLs; other bytes stop the create", async () => {
    const urls: string[] = [];
    const download = (url: string): Promise<Uint8Array> => {
      urls.push(url);
      return fromSample(url);
    };
    const got = await sourceFiles(sources, null, download);
    expect(got).toMatchObject({ copied: 0, downloaded: sources.files.length });
    expect(urls.sort()).toEqual(sources.files.map((file) => file.url).sort());
    const bad = (): Promise<Uint8Array> => Promise.resolve(new Uint8Array([1, 2, 3]));
    expect((await rejection(sourceFiles(sources, null, bad))).message).toMatch(/other bytes/);
  });
});

describe("scenity create: the links and the install steps", () => {
  test("the dependency versions", () => {
    expect(Object.keys(dependencySpecs(null))).toEqual([...PROJECT_PACKAGES]);
    expect(dependencySpecs("1.2.3")["@scenity/scene"]).toBe("1.2.3");
    expect(JSON.parse(projectPackage("Demo_1", null)) as { name: string }).toMatchObject({ name: "demo_1" });
  });

  test("the install links each package of the checkout, then installs the project", () => {
    const steps = installSteps(ROOT, "/p", true);
    expect(steps.map((step) => [step.cwd, step.args.join(" ")])).toEqual([
      [join(ROOT, "packages/cli"), "link"],
      [join(ROOT, "packages/scene"), "link"],
      [join(ROOT, "packages/runtime"), "link"],
      [join(ROOT, "apps/editor"), "link"],
      ["/p", "install"],
    ]);
    expect(installSteps(ROOT, "/p", false)).toEqual([{ cwd: "/p", args: ["install"] }]);
  });

  test("the scene of the template is not written over a file", async () => {
    const dir = join(temp, "taken");
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), "mine");
    expect((await rejection(createProject({ ...EMPTY, name: "taken" }, temp))).message).toMatch(/is not empty/);
    expect(read(dir, "notes.txt")).toBe("mine");
  });
});

describe("scenity create: the sample templates", () => {
  test("a sample template copies the sample with no outputs, with its own ID and name", async () => {
    const made = await createProject(
      { name: "crates", template: "sample:physics", version: null, install: false },
      temp,
    );
    expect(made.template).toBe("sample:physics");
    expect(made.files).toContain("scenes/physics.scene.json");
    expect(made.files).toContain("plugins/probe/src/runtime.ts");
    expect(made.files.some((file) => /(^|\/)(dist|\.scenity|node_modules)\//.test(file))).toBe(false);
    const project = JSON.parse(read(made.dir, "scenity.project.json")) as {
      id: string;
      name: string;
      plugins: string[];
    };
    expect(project).toMatchObject({
      id: "crates",
      name: "crates",
      plugins: ["@scenity/physics-runtime", "./plugins/probe"],
    });
  });

  test("the package.json links the plugin packages and takes the dependencies of the folder plugins", async () => {
    const made = await createProject(
      { name: "spinning", template: "sample:spin", version: null, install: false },
      temp,
    );
    const deps = (JSON.parse(read(made.dir, "package.json")) as { dependencies: Record<string, string> }).dependencies;
    expect(deps).toMatchObject({
      "@scenity/runtime": "link:@scenity/runtime",
      zod: "4.6.5",
      "@scenity/cli": "link:@scenity/cli",
    });
    expect(deps.three).toMatch(/^\d+\.\d+\.\d+$/);
    const crates = JSON.parse(read(join(temp, "crates"), "package.json")) as { dependencies: Record<string, string> };
    expect(crates.dependencies["@scenity/physics-runtime"]).toBe("link:@scenity/physics-runtime");
  });

  test("the install also links the plugin packages of the sample", () => {
    const steps = installSteps(ROOT, "/p", true, [join(ROOT, "plugins/physics/runtime")]);
    expect(steps.at(-2)).toEqual({ cwd: join(ROOT, "plugins/physics/runtime"), args: ["link"] });
    expect(steps.at(-1)).toEqual({ cwd: "/p", args: ["install"] });
  });

  test("an unknown sample is a usage error", async () => {
    const { parseCreateArgs } = await import("../src/create/command");
    expect(parseCreateArgs(["x", "--template", "sample:nope"])).toBeNull();
    expect(parseCreateArgs(["x", "--template", "sample:walkthrough"])?.options.template).toBe("sample:walkthrough");
  });
});

describe("scenity create: a folder template", () => {
  test("--from copies a project folder with no outputs and no local state, with its own ID", async () => {
    const source = join(temp, "source");
    const made = await createProject({ ...EMPTY, name: "source" }, temp);
    expect(made.dir).toBe(source);
    for (const [path, text] of [
      ["notes.md", "Notes.\n"],
      [".gitignore", "custom/\n"],
      [".scenity/recipes/light.json", "{}\n"],
      [".scenity/cache/frame.bin", "x"],
      ["dist/index.html", "<p></p>"],
      ["node_modules/x/index.js", ""],
    ] as const) {
      mkdirSync(join(source, path, ".."), { recursive: true });
      writeFileSync(join(source, path), text);
    }
    const copy = await createProject({ ...EMPTY, name: "copy", from: source }, temp);
    expect(copy.template).toBe("folder");
    expect(copy.files).toContain("notes.md");
    expect(copy.files).toContain(".scenity/recipes/light.json");
    expect(copy.files.filter((path) => /^(dist|node_modules|\.scenity\/cache)\//.test(path))).toEqual([]);
    expect(read(copy.dir, ".gitignore")).toBe("custom/\n");
    expect(JSON.parse(read(copy.dir, "scenity.project.json"))).toMatchObject({ id: "copy", name: "copy" });
    expect((JSON.parse(read(copy.dir, "package.json")) as { name: string }).name).toBe("copy");
    expect(
      await rejection(createProject({ ...EMPTY, name: "none", from: join(temp, "missing") }, temp)),
    ).toBeInstanceOf(CreateError);
  });

  test("--from and --template together are a usage error", async () => {
    const { parseCreateArgs } = await import("../src/create/command");
    expect(parseCreateArgs(["x", "--from", "a", "--template", "empty"])).toBeNull();
    expect(parseCreateArgs(["x", "--from", "a"])?.options.from).toBe("a");
  });
});
