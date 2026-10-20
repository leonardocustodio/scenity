// SPDX-License-Identifier: Apache-2.0
/** The placement and look cases of the agent benchmark. */
import type { BenchCase } from "./case";
import {
  all,
  component,
  fail,
  floorAngle,
  floorDistance,
  largestGap,
  luminance,
  newEntities,
  pass,
  scenityCheck,
  warmth,
  worldPosition,
} from "./checks";
import { setPosition, type Json, type Vec3 } from "./project";

const SHOWROOM = "scenes/main.scene.json";
type Light = { type?: string; colour?: string; intensity?: number };
type Shape = { kind?: string; size?: Vec3; colour?: string; roughness?: number };

function add(scene: { entities: Record<string, unknown> }, id: string, name: string, components: Json): void {
  scene.entities[id] = { name, parent: null, index: Object.keys(scene.entities).length, components };
}

export const PLACEMENT_CASES: readonly BenchCase[] = [
  {
    id: "place-reading-lamp",
    category: "placement",
    sample: "showroom",
    prompt: "Add a point light named 'Reading lamp' about one metre above the coffee table.",
    check: (p, { before }) => {
      const scene = p.scene();
      const lamp = newEntities(before, scene).find((id) => /reading lamp/i.test(scene.entities[id]?.name ?? ""));
      if (lamp === undefined) return fail("no new entity named Reading lamp");
      if (component<Light>(scene.entities[lamp], "light")?.type !== "point")
        return fail("the lamp is not a point light");
      const at = worldPosition(scene, lamp);
      const table = worldPosition(scene, "coffee-table");
      if (floorDistance(at, table) > 0.5)
        return fail(`the lamp is ${floorDistance(at, table).toFixed(2)} m from the table`);
      return at[1] >= 0.8 && at[1] <= 1.8
        ? pass(`the lamp is at y=${at[1].toFixed(2)}`)
        : fail(`y=${at[1].toFixed(2)}`);
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) =>
        add(s, "reading-lamp", "Reading lamp", { light: { type: "point" }, transform: { position: [-1.2, 1.4, 0.3] } }),
      ),
  },
  {
    id: "place-four-stools",
    category: "placement",
    sample: "showroom",
    prompt: "Add four box-shaped stools around the dining table, one on each side, about 0.9 m from its centre.",
    check: (p, { before }) => {
      const scene = p.scene();
      const table = worldPosition(scene, "table");
      const stools = newEntities(before, scene).filter((id) => {
        const box = component<Shape>(scene.entities[id], "shape")?.kind === "box";
        const d = floorDistance(worldPosition(scene, id), table);
        return box && d >= 0.6 && d <= 1.3;
      });
      if (stools.length < 4) return fail(`${String(stools.length)} box stools around the table`);
      const gap = largestGap(stools.map((id) => floorAngle(table, worldPosition(scene, id))));
      return gap < 150
        ? pass(`${String(stools.length)} stools, largest gap ${gap.toFixed(0)}°`)
        : fail(`gap ${gap.toFixed(0)}°`);
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) => {
        const offsets: Vec3[] = [
          [0.9, 0.22, 0],
          [-0.9, 0.22, 0],
          [0, 0.22, 0.9],
          [0, 0.22, -0.9],
        ];
        offsets.forEach((o, i) =>
          add(s, `stool-${String(i)}`, `Stool ${String(i)}`, {
            shape: { kind: "box", size: [0.4, 0.44, 0.4] },
            transform: { position: [1.6 + o[0], o[1], -0.9 + o[2]] },
          }),
        );
      }),
  },
  {
    id: "place-ottoman",
    category: "placement",
    sample: "showroom",
    prompt: "Move the ottoman so that it sits within 0.7 m of the armchair, without overlapping it.",
    check: (p) => {
      const scene = p.scene();
      const d = floorDistance(worldPosition(scene, "ottoman"), worldPosition(scene, "armchair"));
      const near = d <= 0.7 && d >= 0.3 ? pass(`${d.toFixed(2)} m from the armchair`) : fail(`${d.toFixed(2)} m`);
      return all(near, scenityCheck(p));
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) => {
        setPosition(s, "ottoman", [-1.95, 0, 0.3]);
      }),
  },
  {
    id: "place-fast-spinner",
    category: "placement",
    sample: "spin",
    prompt: "Add a third spinner like 'Spinner' but twice as fast, placed one metre to the right of it.",
    check: (p, { before }) => {
      const scene = p.scene();
      const spinner = worldPosition(scene, "spinner");
      const fast = newEntities(before, scene).find((id) => {
        const speed = component<{ speed?: number }>(scene.entities[id], "demo.spin")?.speed ?? 90;
        return Math.abs(Math.abs(speed) - 180) <= 5;
      });
      if (fast === undefined) return fail("no new spinner with a speed of 180");
      const d = floorDistance(worldPosition(scene, fast), spinner);
      return d >= 0.8 && d <= 1.2 ? pass(`the new spinner is ${d.toFixed(2)} m away`) : fail(`${d.toFixed(2)} m away`);
    },
    solve: (p) =>
      p.editScene("scenes/spin.scene.json", (s) =>
        add(s, "fast-spinner", "Fast spinner", {
          "demo.spin": { speed: 180 },
          shape: { kind: "box", size: [0.6, 0.6, 0.6] },
          transform: { position: [0.1, 0.9, 0] },
        }),
      ),
  },
  {
    id: "place-second-bench",
    category: "placement",
    sample: "walkthrough",
    prompt: "Put a second bench next to the existing bench, about 1.5 m to its right, with the same size.",
    check: (p, { before }) => {
      const scene = p.scene();
      const bench = worldPosition(scene, "bench");
      const size = component<Shape>(scene.entities.bench, "shape")?.size ?? [0, 0, 0];
      const twin = newEntities(before, scene).find((id) => {
        const s = component<Shape>(scene.entities[id], "shape");
        return s?.kind === "box" && JSON.stringify(s.size) === JSON.stringify(size);
      });
      if (twin === undefined) return fail("no new box with the size of the bench");
      const at = worldPosition(scene, twin);
      const d = floorDistance(at, bench);
      const near = d >= 1.2 && d <= 2.2 ? pass(`${d.toFixed(2)} m from the bench`) : fail(`${d.toFixed(2)} m away`);
      return all(near, Math.abs(at[1] - bench[1]) <= 0.05 ? pass("same height") : fail("not at the bench height"));
    },
    solve: (p) =>
      p.editScene("scenes/plaza.scene.json", (s) =>
        add(s, "bench-2", "Bench 2", {
          obstacle: {},
          shape: { kind: "box", size: [1.8, 0.46, 0.5], colour: "#6a7480" },
          transform: { position: [1.3, 0.23, -2.1] },
        }),
      ),
  },
  {
    id: "place-stack-crate",
    category: "placement",
    sample: "physics",
    prompt: "Stack a fifth crate on top of Crate 1. It must be a physics body like the other crates.",
    check: (p, { before }) => {
      const scene = p.scene();
      const base = worldPosition(scene, "crate-1");
      const crate = newEntities(before, scene).find(
        (id) =>
          component(scene.entities[id], "physics.rigidBody") !== undefined &&
          component(scene.entities[id], "physics.collider") !== undefined,
      );
      if (crate === undefined) return fail("no new physics body");
      const at = worldPosition(scene, crate);
      if (floorDistance(at, base) > 0.15) return fail("the crate is not above Crate 1");
      const rise = at[1] - base[1];
      // A physics scene drops a crate that starts higher onto Crate 1, so any place above it is right.
      return rise >= 0.3 && rise <= 5 ? pass(`${rise.toFixed(2)} m above Crate 1`) : fail(`${rise.toFixed(2)} m above`);
    },
    solve: (p) =>
      p.editScene("scenes/physics.scene.json", (s) =>
        add(s, "crate-5", "Crate 5", {
          "physics.collider": { friction: 0.6 },
          "physics.rigidBody": { mass: 2 },
          shape: { kind: "box", size: [0.4, 0.4, 0.4] },
          transform: { position: [-1.6, 1.0, -0.4] },
        }),
      ),
  },
];

export const LOOK_CASES: readonly BenchCase[] = [
  {
    id: "look-warm-key",
    category: "look",
    sample: "showroom",
    prompt: "Make the key light warmer (more orange) and a bit dimmer.",
    check: (p, { before }) => {
      const now = component<Light>(p.scene().entities.sun, "light") ?? {};
      const old = component<Light>(before.entities.sun, "light") ?? {};
      const warmer = warmth(now.colour ?? "#ffffff") > warmth(old.colour ?? "#ffffff") + 0.05;
      const dimmer = (now.intensity ?? 1) < (old.intensity ?? 1);
      return warmer && dimmer
        ? pass(`colour ${String(now.colour)}, intensity ${String(now.intensity)}`)
        : fail(`warmer ${String(warmer)}, dimmer ${String(dimmer)}`);
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) => {
        Object.assign(s.entities.sun?.components.light ?? {}, { colour: "#ffc98a", intensity: 1.8 });
      }),
  },
  {
    id: "look-night",
    category: "look",
    sample: "showroom",
    prompt:
      "Turn this into a night scene: a dark background, a weaker environment light, and the lantern light brighter.",
    check: (p, { before }) => {
      const scene = p.scene();
      const env = (scene.environment ?? {}) as { background?: string; mapIntensity?: number };
      const old = (before.environment ?? {}) as { background?: string; mapIntensity?: number };
      const lantern = component<Light>(scene.entities["lantern-light"], "light")?.intensity ?? 0;
      const oldLantern = component<Light>(before.entities["lantern-light"], "light")?.intensity ?? 0;
      return all(
        luminance(env.background ?? "#ffffff") < luminance(old.background ?? "#ffffff")
          ? pass("darker")
          : fail("the background is not darker"),
        (env.mapIntensity ?? 1) < (old.mapIntensity ?? 1)
          ? pass("weaker")
          : fail("the environment light is not weaker"),
        lantern > oldLantern ? pass(`lantern ${String(lantern)}`) : fail("the lantern is not brighter"),
      );
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) => {
        Object.assign(s.environment ?? {}, { background: "#05070b", mapIntensity: 0.1 });
        Object.assign(s.entities["lantern-light"]?.components.light ?? {}, { intensity: 3 });
      }),
  },
  {
    id: "look-fog",
    category: "look",
    sample: "characters",
    prompt: "Add fog to the main scene so that far objects fade out.",
    check: (p) => {
      const fog = p.scene().environment?.fog as { type?: string } | undefined;
      return fog?.type === "linear" || fog?.type === "exp2"
        ? all(pass(`fog ${fog.type}`), scenityCheck(p))
        : fail("no fog");
    },
    solve: (p) =>
      p.editScene("scenes/main.scene.json", (s) => {
        (s as { environment: Json }).environment.fog = { type: "exp2", colour: "#202833", density: 0.08 };
      }),
  },
  {
    id: "look-dark-floor",
    category: "look",
    sample: "showroom",
    prompt: "Make the floor a dark grey, a bit like dark wood, and less rough.",
    check: (p, { before }) => {
      const now = component<Shape>(p.scene().entities.floor, "shape") ?? {};
      const old = component<Shape>(before.entities.floor, "shape") ?? {};
      const darker = luminance(now.colour ?? "#ffffff") < Math.min(0.2, luminance(old.colour ?? "#ffffff"));
      const smoother = (now.roughness ?? 1) < (old.roughness ?? 1);
      return darker && smoother
        ? pass(`colour ${String(now.colour)}, roughness ${String(now.roughness)}`)
        : fail(`darker ${String(darker)}, smoother ${String(smoother)}`);
    },
    solve: (p) =>
      p.editScene(SHOWROOM, (s) => {
        Object.assign(s.entities.floor?.components.shape ?? {}, { colour: "#3a342f", roughness: 0.6 });
      }),
  },
];
