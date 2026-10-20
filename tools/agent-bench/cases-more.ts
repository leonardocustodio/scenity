// SPDX-License-Identifier: Apache-2.0
/** The time, asset, rule, code and project cases of the agent benchmark. */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BenchCase } from "./case";
import {
  all,
  bunScript,
  component,
  fail,
  floorDistance,
  newEntities,
  pass,
  rgb,
  scenityCheck,
  worldPosition,
} from "./checks";
import { addTag, CHECKOUT, setPosition, type BenchProject, type Json, type Vec3 } from "./project";

type Key = { t: number; value?: unknown; position?: Vec3 };
type Track = { kind: string; entity?: string; path?: string; keys: Key[] };
type Sequence = { scene?: string; duration?: number; markers?: Record<string, number>; tracks?: Track[] };
const ROBOT = join(CHECKOUT, "samples", "characters", "assets", "sources", "RobotExpressive", "RobotExpressive.glb");

/** The asset records (`*.meta.json`) of the project, with their path. */
function records(p: BenchProject): [string, Json][] {
  return p
    .files()
    .filter((file) => file.endsWith(".meta.json"))
    .map((file) => [file, p.read(file)]);
}

/** The rules of the project: inline rules and the rules of its rules files. */
function projectRules(p: BenchProject): Json[] {
  const out: Json[] = [];
  for (const entry of (p.project().rules as (string | Json)[] | undefined) ?? []) {
    if (typeof entry === "string") out.push(...((p.read(entry).rules as Json[] | undefined) ?? []));
    else out.push(entry);
  }
  return out;
}

export const TIME_CASES: readonly BenchCase[] = [
  {
    id: "time-camera-zoom",
    category: "time",
    sample: "spin",
    prompt:
      "In the spin sequence, animate the field of view of the front camera from 45 to 30 degrees over the first 4 seconds.",
    check: (p) => {
      const tracks = p.read<Sequence>("sequences/spin.sequence.json").tracks ?? [];
      const track = tracks.find((t) => t.kind === "property" && t.entity === "front" && t.path === "camera/fov");
      if (track === undefined) return fail("no property track on camera/fov of the front camera");
      const start = track.keys.find((k) => Math.abs(k.t) <= 100 && k.value === 45);
      const end = track.keys.find((k) => Math.abs(k.t - 4000) <= 100 && k.value === 30);
      return start !== undefined && end !== undefined
        ? pass("keys 45 at 0 ms and 30 at 4000 ms")
        : fail("the keys are wrong");
    },
    solve: (p) => {
      const sequence = p.read<Sequence>("sequences/spin.sequence.json");
      sequence.tracks = [
        ...(sequence.tracks ?? []),
        {
          kind: "property",
          entity: "front",
          path: "camera/fov",
          keys: [
            { t: 0, value: 45 },
            { t: 4000, value: 30 },
          ],
        },
      ];
      p.write("sequences/spin.sequence.json", sequence);
    },
  },
  {
    id: "time-marker",
    category: "time",
    sample: "spin",
    prompt: "Add a marker named 'stop' at 6 seconds to the spin sequence.",
    check: (p) => {
      const at = p.read<Sequence>("sequences/spin.sequence.json").markers?.stop;
      return at === 6000 ? pass("stop at 6000 ms") : fail(`stop is ${String(at)}`);
    },
    solve: (p) => {
      const sequence = p.read<Sequence>("sequences/spin.sequence.json");
      sequence.markers = { ...sequence.markers, stop: 6000 };
      p.write("sequences/spin.sequence.json", sequence);
    },
  },
  {
    id: "time-longer",
    category: "time",
    sample: "walkthrough",
    prompt: "Make the meet sequence two seconds longer, and move its 'end' marker to half a second before the new end.",
    check: (p) => {
      const s = p.read<Sequence>("sequences/meet.sequence.json");
      return s.duration === 15000 && s.markers?.end === 14500
        ? pass("15000 ms, end at 14500")
        : fail(`${String(s.duration)}, end ${String(s.markers?.end)}`);
    },
    solve: (p) => {
      const s = p.read<Sequence>("sequences/meet.sequence.json");
      p.write("sequences/meet.sequence.json", { ...s, duration: 15000, markers: { ...s.markers, end: 14500 } });
    },
  },
  {
    id: "time-tour",
    category: "time",
    sample: "showroom",
    prompt:
      "Make a new 6-second sequence 'tour' for the main scene in which the front camera moves one metre closer to the dining table.",
    check: (p) => {
      const files = (p.project().sequences as string[] | undefined) ?? [];
      const file = files.find((f) => p.exists(f) && p.read<{ id?: string }>(f).id === "tour");
      if (file === undefined) return fail("the project lists no sequence 'tour'");
      const s = p.read<Sequence>(file);
      const track = s.tracks?.find((t) => t.kind === "transform" && t.entity === "front" && t.keys.length >= 2);
      if (s.duration !== 6000 || track === undefined)
        return fail("no 6000 ms sequence with a transform track on front");
      const table = worldPosition(p.scene(), "table");
      const first = track.keys[0]?.position ?? [0, 0, 0];
      const last = track.keys.at(-1)?.position ?? [0, 0, 0];
      const closer = floorDistance(first, table) - floorDistance(last, table);
      return closer >= 0.7 ? pass(`${closer.toFixed(2)} m closer`) : fail(`${closer.toFixed(2)} m closer`);
    },
    solve: (p) => {
      mkdirSync(p.path("sequences"), { recursive: true });
      p.write("sequences/tour.sequence.json", {
        format: "scenity.sequence/1",
        id: "tour",
        scene: "main",
        duration: 6000,
        tracks: [
          {
            kind: "transform",
            entity: "front",
            keys: [
              { t: 0, position: [0.4, 1.7, 4.6] },
              { t: 6000, position: [0.8, 1.7, 3.7] },
            ],
          },
        ],
      });
      p.write("scenity.project.json", { ...p.project(), sequences: ["sequences/tour.sequence.json"] });
    },
  },
];

export const ASSET_CASES: readonly BenchCase[] = [
  {
    id: "assets-import-robot",
    category: "assets",
    sample: "showroom",
    prompt:
      "Import the model .bench/inbox/RobotExpressive.glb into this project and place it on the floor near the shelf.",
    setup: (p) => {
      mkdirSync(p.path(".bench/inbox"), { recursive: true });
      cpSync(ROBOT, p.path(".bench/inbox/RobotExpressive.glb"));
    },
    check: (p, { before }) => {
      const record = records(p).find(
        ([, r]) => typeof r.source === "string" && r.source.endsWith("RobotExpressive.glb"),
      );
      if (record === undefined) return fail("no asset record of the robot");
      const scene = p.scene();
      const robot = newEntities(before, scene).find(
        (id) => component<{ asset?: string }>(scene.entities[id], "model")?.asset === `asset:${String(record[1].id)}`,
      );
      if (robot === undefined) return fail("no entity with the robot model");
      const d = floorDistance(worldPosition(scene, robot), worldPosition(scene, "shelf"));
      return d <= 1.5 ? pass(`${d.toFixed(2)} m from the shelf`) : fail(`${d.toFixed(2)} m from the shelf`);
    },
  },
  {
    id: "assets-red-material",
    category: "assets",
    sample: "showroom",
    prompt:
      "Make a new material asset 'Lacquer red': a red physical material with a low roughness, in assets/materials.",
    check: (p) => {
      const file = p.files("assets").find((f) => f.endsWith(".material.json") && /lacquer/i.test(p.text(f)));
      if (file === undefined) return fail("no material file with the name Lacquer red");
      const m = p.read<{ format?: string; type?: string; colour?: string; roughness?: number }>(file);
      const [r, g, b] = rgb(m.colour ?? "#000000");
      const red = r > g + 0.3 && r > b + 0.3;
      const ok = m.format === "scenity.material/1" && m.type === "physical" && red && (m.roughness ?? 1) < 0.4;
      const record = p.exists(`${file}.meta.json`)
        ? pass("it has an asset record")
        : fail("no asset record beside the file");
      return all(
        ok ? pass(file) : fail(`format ${String(m.format)}, type ${String(m.type)}, colour ${String(m.colour)}`),
        record,
      );
    },
    solve: (p) => {
      mkdirSync(p.path("assets/materials"), { recursive: true });
      p.write("assets/materials/lacquer-red.material.json", {
        format: "scenity.material/1",
        name: "Lacquer red",
        type: "physical",
        colour: "#c0161d",
        roughness: 0.2,
      });
      p.write("assets/materials/lacquer-red.material.json.meta.json", {
        format: "scenity.asset/1",
        id: "01M9BENCHLACQUERRED0000001",
        kind: "material",
        source: "lacquer-red.material.json",
        importer: "material",
        settings: {},
      });
    },
  },
  {
    id: "assets-light-tags",
    category: "assets",
    sample: "showroom",
    prompt: "Give the tag 'light-source' to each entity that gives light, and to nothing else.",
    check: (p) => {
      const tagged = Object.entries(p.scene().entities)
        .filter(([, e]) => e.tags?.includes("light-source"))
        .map(([id]) => id);
      const lights = ["fill", "lantern-light", "sun"];
      // The lantern model holds the lantern light, so its tag is right too.
      const ok = lights.every((id) => tagged.includes(id)) && tagged.every((id) => [...lights, "lantern"].includes(id));
      return ok ? pass(`tagged: ${tagged.join(", ")}`) : fail(`tagged: ${tagged.join(", ")}`);
    },
    solve: (p) =>
      p.editScene("scenes/main.scene.json", (s) => {
        for (const id of ["fill", "lantern-light", "sun"]) {
          addTag(s, id, "light-source");
        }
      }),
  },
];

export const RULE_CASES: readonly BenchCase[] = [
  {
    id: "rules-lantern",
    category: "rules",
    sample: "showroom",
    prompt:
      "Add a project rule (level block) that the lantern stays within 0.4 m of the top socket of the dining table.",
    check: (p) => {
      const rule = projectRules(p).find(
        (r) =>
          r.metric === "distance" &&
          JSON.stringify(r.args).includes("lantern") &&
          JSON.stringify(r.args).includes("table"),
      );
      if (rule === undefined) return fail("no distance rule between the lantern and the table");
      const ok = rule.level === "block" && typeof rule.max === "number" && rule.max <= 0.4 + 1e-9;
      return all(
        ok ? pass("a block rule with max 0.4") : fail(`level ${String(rule.level)}, max ${String(rule.max)}`),
        scenityCheck(p),
      );
    },
    solve: (p) => {
      const project = p.project();
      const rule = {
        id: "lanternOnTable",
        metric: "distance",
        args: { from: "entity:lantern", to: "entity:table#top" },
        max: 0.4,
        unit: "m",
        level: "block",
      };
      p.write("scenity.project.json", { ...project, rules: [...((project.rules as Json[] | undefined) ?? []), rule] });
    },
  },
  {
    id: "rules-fix-check",
    category: "rules",
    sample: "walkthrough",
    prompt: "`scenity check` fails for this project. Fix the scene so that the check passes. Do not delete any entity.",
    setup: (p) =>
      p.editScene("scenes/plaza.scene.json", (s) => {
        setPosition(s, "bench", [-0.2, -0.5, -2.1]);
      }),
    check: (p, { before }) => {
      const scene = p.scene();
      const same = Object.keys(before.entities).every((id) => scene.entities[id] !== undefined);
      const bench = worldPosition(scene, "bench");
      const kept =
        floorDistance(bench, [-0.2, 0, -2.1]) <= 0.05
          ? pass("the bench keeps its place on the floor")
          : fail("the bench moved on the floor");
      return all(same ? pass("no entity deleted") : fail("an entity was deleted"), kept, scenityCheck(p));
    },
    solve: (p) =>
      p.editScene("scenes/plaza.scene.json", (s) => {
        setPosition(s, "bench", [-0.2, 0.23, -2.1]);
      }),
  },
  {
    id: "rules-find-under-floor",
    category: "rules",
    sample: "showroom",
    prompt: "One of the models is partly under the floor. Find it and fix it.",
    setup: (p) =>
      p.editScene("scenes/main.scene.json", (s) => {
        setPosition(s, "ottoman", [-1.1, -0.3, 1.75]);
      }),
    check: (p) => {
      const at = worldPosition(p.scene(), "ottoman");
      const place =
        floorDistance(at, [-1.1, 0, 1.75]) <= 0.05 && at[1] >= -0.001
          ? pass("the ottoman is back on the floor")
          : fail(`the ottoman is at ${at.map((n) => n.toFixed(2)).join(", ")}`);
      return all(place, scenityCheck(p));
    },
    solve: (p) =>
      p.editScene("scenes/main.scene.json", (s) => {
        setPosition(s, "ottoman", [-1.1, 0, 1.75]);
      }),
  },
];

const SPIN_PLUGIN = "./plugins/demo/src/runtime.ts";

export const CODE_CASES: readonly BenchCase[] = [
  {
    id: "code-reverse-field",
    category: "code",
    sample: "spin",
    prompt:
      "Add a boolean field 'reverse' to the demo.spin component: when it is true, the entity turns the other way. Set it on the slow spinner.",
    check: (p) =>
      bunScript(
        p,
        `const plugin = (await import(${JSON.stringify(SPIN_PLUGIN)})).default;
const spin = plugin.components.find((c) => c.id === "demo.spin");
const scene = JSON.parse(await Bun.file("scenes/spin.scene.json").text());
const value = scene.entities["slow-spinner"].components["demo.spin"];
if (!spin.schema.safeParse(value).success || value.reverse !== true) throw new Error("the slow spinner has no valid reverse");
if (spin.schema.safeParse({ reverse: "yes" }).success) throw new Error("reverse is not a boolean");
console.log("reverse is a boolean field and the slow spinner has it");`,
      ),
  },
  {
    id: "code-bob-component",
    category: "code",
    sample: "spin",
    prompt:
      "Add a component 'demo.bob' to the demo plugin with a system that moves its entity up and down, and give it to the pedestal.",
    check: (p) =>
      bunScript(
        p,
        `const plugin = (await import(${JSON.stringify(SPIN_PLUGIN)})).default;
const bob = plugin.components.find((c) => c.id === "demo.bob");
if (bob === undefined) throw new Error("no component demo.bob");
const systems = plugin.systems.map((s) => (typeof s === "function" ? s() : s));
if (!systems.some((s) => (s.reads ?? []).includes("demo.bob"))) throw new Error("no system reads demo.bob");
const scene = JSON.parse(await Bun.file("scenes/spin.scene.json").text());
const value = scene.entities.pedestal.components["demo.bob"];
if (value === undefined || !bob.schema.safeParse(value).success) throw new Error("the pedestal has no valid demo.bob");
console.log("demo.bob with a system, on the pedestal");`,
      ),
  },
];

export const PROJECT_CASES: readonly BenchCase[] = [
  {
    id: "project-budget",
    category: "project",
    sample: "spin",
    prompt: "Add a quality budget for the medium tier: at most 50 draw calls and 200000 triangles per scene.",
    check: (p) => {
      const medium = ((p.project().quality as Json | undefined)?.budgets as Json | undefined)?.scene as
        Record<string, Json> | undefined;
      const tier = medium?.medium;
      return tier?.drawCalls === 50 && tier.triangles === 200000
        ? pass("medium: 50 draw calls, 200000 triangles")
        : fail(`medium: ${JSON.stringify(tier)}`);
    },
    solve: (p) =>
      p.write("scenity.project.json", {
        ...p.project(),
        quality: { budgets: { scene: { medium: { drawCalls: 50, triangles: 200000 } } } },
      }),
  },
  {
    id: "project-build-size",
    category: "project",
    sample: "showroom",
    prompt: "Build this project for the web and tell me the gzip size of the player entry in KB.",
    check: (p, { answer }) => {
      if (!existsSync(p.path("dist/build-report.json"))) return fail("no build report in dist/");
      const entries = (p.read("dist/build-report.json").entries ?? []) as { id?: string; gzip?: number }[];
      const gzip = entries.find((e) => e.id === "player")?.gzip ?? 0;
      // The CLI gives KB as 1024 bytes. An answer with 1000 bytes is right too.
      const sizes = [gzip / 1024, gzip / 1000];
      const said = [...answer.matchAll(/(\d+(?:\.\d+)?)\s*KB/gi)].map((m) => Number(m[1]));
      const right = said.some((n) => sizes.some((kb) => Math.abs(n - kb) <= 0.5));
      const kb = (gzip / 1024).toFixed(1);
      return right ? pass(`${kb} KB, named in the answer`) : fail(`the answer does not name ${kb} KB`);
    },
  },
];
