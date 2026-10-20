// SPDX-License-Identifier: Apache-2.0
/**
 * The generic Claude tools on the showroom surface. A second host in test mode runs on a copy of the showroom sample
 * (a temp folder with no Git). The spec never changes the sample files of the repository. The surface of its manifest
 * runs the scene page on the scene server of the project, with the workbench bridge. `scene_query` lists the entities.
 * `scene_command` of Claude moves an entity as a proposal, and the owner accepts it on the proposal card of the frame
 * (one undo step). With the switch "apply", a move applies at once. The global setup holds the GPU lock.
 */
import type { ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { planJobs } from "@scenity/labs-platform/indexSource";
import { projectPlans, type ProjectIndexDocument } from "@scenity/labs-platform/projectIndex";
import { isAnswer, type HostEndpoint } from "@scenity/workbench-host/protocol";
import { e2eSetup } from "./env";
import type { ToolAnswer } from "./harness";
import { CHECKOUT, startTestHost, stopChild } from "./processes";

const SHOWROOM = join(CHECKOUT, "samples", "showroom");

let host: HostEndpoint;
let folder: string;
const children: ChildProcess[] = [];

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "workbench-showroom-"));
  // The scene page does not need the build outputs of the player (dist).
  cpSync(SHOWROOM, join(folder, "showroom"), { recursive: true, filter: (path) => !path.includes("/dist") });
  const state = join(folder, "state");
  host = (await startTestHost({ state, labQuery: "", checkout: join(folder, "showroom") }, children)).endpoint;
});

test.afterAll(async () => {
  await Promise.all(children.map(stopChild));
  rmSync(folder, { recursive: true, force: true });
});

/** Call a tool of the showroom host. */
async function tool(name: string, input: Record<string, unknown> = {}): Promise<ToolAnswer> {
  const response = await fetch(`${host.origin}/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-workbench-token": host.token },
    body: JSON.stringify(input),
  });
  expect(response.status, `POST /tools/${name}`).toBe(200);
  return (await response.json()) as ToolAnswer;
}

function text(answer: ToolAnswer): string {
  return answer.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

/** Send one request over a new WebSocket of the showroom host and give its result. */
async function request(type: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const socket = new WebSocket(`${host.origin.replace(/^http/, "ws")}/ws?token=${host.token}`);
  try {
    return await new Promise((done, fail) => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, type, ...params }));
      });
      socket.addEventListener("error", () => {
        fail(new Error("The WebSocket of the host failed."));
      });
      socket.addEventListener("message", (message) => {
        const value: unknown = JSON.parse(String(message.data));
        if (!isAnswer(value) || value.id !== 1) return;
        if (value.ok) done(value.result as Record<string, unknown>);
        else fail(new Error(value.error));
      });
    });
  } finally {
    socket.close();
  }
}

/** The keys of the 160 px frames of the plans of the showroom copy under a content hash. */
function showroomKeys(contentHash: string): string[] {
  const dir = join(folder, "showroom");
  const read = (path: string): unknown => JSON.parse(readFileSync(join(dir, path), "utf8"));
  const project = read("scenity.project.json") as ProjectIndexDocument;
  const files = Object.fromEntries([...(project.scenes ?? []), ...(project.sequences ?? [])].map((p) => [p, read(p)]));
  return projectPlans(project, files).flatMap((plan) => planJobs(plan, contentHash, [160]).map((job) => job.key));
}

/** The state of the scene page: "ready", "failed" or "loading". */
async function sceneState(frame: Frame): Promise<string> {
  return frame
    .evaluate(() => {
      if (document.querySelector<HTMLElement>("#scene")?.dataset.ready === "1") return "ready";
      return (document.querySelector("#status")?.textContent ?? "").startsWith("Scene error") ? "failed" : "loading";
    })
    .catch(() => "loading");
}

/**
 * Open the workbench page on the showroom host and give the frame of its surface `editor`. A cold scene server can
 * refuse the first load while Vite optimizes the dependencies ("Outdated Optimize Dep"). Then the spec loads the frame
 * again.
 */
async function openShowroom(page: Page): Promise<Frame> {
  const { page: origin } = e2eSetup();
  await page.goto(`${origin}/?host=${encodeURIComponent(host.origin)}#token=${host.token}`);
  await expect(page.getByTestId("workspace")).toBeVisible({ timeout: 30_000 });
  const locator = page.locator('[data-surface-tab="editor"] [data-testid="surface-frame-visible"]');
  await expect(locator).toHaveAttribute("src", /\/scene\.html/, { timeout: 120_000 });
  const frame = await (await locator.elementHandle()).contentFrame();
  if (frame === null) throw new Error("The page has no frame of the surface editor.");
  await expect.poll(() => sceneState(frame), { timeout: 120_000, intervals: [1000] }).not.toBe("loading");
  if ((await sceneState(frame)) === "failed") {
    await frame.goto(frame.url());
    await expect.poll(() => sceneState(frame), { timeout: 120_000, intervals: [1000] }).toBe("ready");
  }
  const query = async (): Promise<string> => text(await tool("scene_query", { limit: 1 }));
  await expect.poll(query, { timeout: 60_000, intervals: [1000] }).toContain("entities match");
  return frame;
}

/** The world x of the ottoman in the document of the scene page. */
async function ottomanX(frame: Frame): Promise<number> {
  return frame.evaluate(() => {
    const api = (globalThis as unknown as { __scenity: { document(): { entities: Record<string, unknown> } } })
      .__scenity;
    const entity = api.document().entities.ottoman as { components: { transform: { position: number[] } } };
    return entity.components.transform.position[0] ?? Number.NaN;
  });
}

test("scene_query lists the showroom entities; scene_command moves an entity", async ({ page }) => {
  test.setTimeout(300_000);
  const frame = await openShowroom(page);
  expect(new URL(frame.url()).pathname).toBe("/scene.html");

  const all = text(await tool("scene_query", {}));
  expect(all).toContain("14 of 14 entities match.");
  expect(all).toContain('ottoman "Ottoman" (root)');
  expect(all).toContain("world position [-1.1, 0, 1.75]");
  const lights = text(await tool("scene_query", { component: "light", values: ["light"] }));
  expect(lights).toContain("lantern-light");
  expect(lights).toContain("values {");

  const listed = text(await tool("scene_commands", { filter: "entity.move" }));
  expect(listed).toContain("entity.move (edit)");
  expect(listed).toContain("Proposal switch of the session: propose");

  // A move of Claude waits as a proposal. The document does not change until the owner accepts it.
  const proposed = text(await tool("scene_command", { command: "entity.move", args: { entity: "ottoman", x: 0.5 } }));
  expect(proposed).toContain("Proposal p1 (entity.move: Move Ottoman to x 0.5): not applied.");
  expect(await ottomanX(frame)).toBe(-1.1);
  await expect(frame.getByTestId("scene-proposals")).toBeVisible();
  await frame.getByTestId("scene-proposal-accept").click();
  await expect.poll(() => ottomanX(frame)).toBe(0.5);
  await expect(frame.getByTestId("scene-proposals")).toBeHidden();
  expect(text(await tool("scene_query", { ids: ["ottoman"] }))).toContain("world position [0.5, 0, 1.75]");
  // The accept is one step of the undo history.
  await frame.evaluate(() => (globalThis as unknown as { __scenity: { undo(): Promise<boolean> } }).__scenity.undo());
  expect(await ottomanX(frame)).toBe(-1.1);

  // The switch of the owner lets a move of Claude apply at once, as one undo step.
  await frame.evaluate(() => {
    (globalThis as unknown as { __scenity: { setProposalMode(mode: string): void } }).__scenity.setProposalMode(
      "apply",
    );
  });
  const applied = text(await tool("scene_command", { command: "entity.move", args: { entity: "ottoman", z: 1 } }));
  expect(applied).toContain("Applied entity.move (Move Ottoman to z 1) as one step of the undo history.");
  expect(text(await tool("scene_query", { ids: ["ottoman"] }))).toContain("world position [-1.1, 0, 1]");
  const measured = text(await tool("scene_measure", { from: "ottoman", to: "-1.1,0,0" }));
  expect(measured).toContain("ottoman to -1.1,0,0: 1 m");
  const picture = await tool("scene_frame", { camera: "front", width: 640 });
  expect(picture.content.some((block) => block.type === "image")).toBe(true);
  const sheet = await tool("scene_sheet", { cameras: ["front", "top"] });
  expect(text(sheet)).toContain("2 cells · now · cameras front, top");
  expect(sheet.content.some((block) => block.type === "image")).toBe(true);
  // A point low in the middle of the canvas is on the floor or on a model of the room.
  const box = await frame.getByTestId("scene-view").boundingBox();
  if (box === null) throw new Error("The scene page has no canvas.");
  const picked = text(await tool("scene_pick", { x: box.width / 2, y: box.height * 0.8, sub: true }));
  expect(picked).toMatch(/^Hit entity:\S+ .* m from the camera\./);
  expect(text(await tool("asset_search", { q: "lantern" }))).toContain("Lantern_01_1k.gltf");
});

test("the showroom surface fills the frame index from its plans", async ({ page }) => {
  test.setTimeout(300_000);
  await openShowroom(page);
  // The shadow frame of the scene page draws the jobs of the plans of the project at idle time of the page.
  const status = async (): Promise<Record<string, unknown>> => request("index.status");
  await expect
    .poll(
      async () => {
        const now = await status();
        return Number(now.total) > 0 && now.done === now.total;
      },
      { timeout: 240_000, intervals: [2000] },
    )
    .toBe(true);
  const { contentHash, total } = await status();
  expect(Number(total)).toBeGreaterThanOrEqual(4);
  const keys = showroomKeys(String(contentHash));
  expect(keys.length).toBeGreaterThanOrEqual(2);
  for (const key of keys) {
    const response = await fetch(`${host.origin}/index/${key}?size=160`, {
      headers: { "x-workbench-token": host.token },
    });
    expect(response.status, `the index picture ${key}`).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\//);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(500);
  }
});
