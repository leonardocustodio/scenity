// SPDX-License-Identifier: Apache-2.0
// The agent panel in the studio. The studio host runs its agent sessions with the script driver
// (`SCENITY_AGENT_SCRIPT`), so a turn calls the real tools against the editor window with no model and no workbench
// page. The spec checks these cases:
// - The panel joins the default layout. ⌘L puts the focus in the composer. ⌘↩ sends a prompt, which makes a session.
// - The turn moves the armchair as a proposal (Review). The mode Auto sets the switch of the window.
// - A prompt during a turn waits. Stop ends the turn. The footer shows the cost and the context share. The ⋯ menu
//   renames the session.
// - A tool call is a card with "Show in the scene" and the raw call.
// - The chips of the composer (the selection, an `@` mention, a region of the view) go with a prompt. A removed chip
//   stays out.
// - A turn of five changes waits as one change set (a moved entity has a ghost at its new place). The person accepts
//   three of them as one step of the history in the Review panel and rejects the rest. The agent gets the result.
// - "Undo the turn" cancels the scene edit and the file of a turn with one action. A later edit of the person stays.
// - After three turns, Preview of the checkpoint of turn two lists the changes. Restore gives the scene and the files
//   of turn one, and undo cancels the restore.
// - A file write of a Review session waits on an approval card (the tab has a dot). The switch to Auto asks for a
//   budget.
// - With "Plan first", a plan of five steps waits for the approval. It runs with ticks and a summary, and the studio
//   saves it. A denied plan changes nothing.
// - During a turn, the person sees what the agent works on (the marks, its camera, its activity, its frame). The view
//   does not change.
// - ⌘I on an inspector field opens the inline prompt with the field as context. The result waits as a change set on
//   that field, with Accept beside it.
// - A question of the agent with three options gets its answer in the panel. The session waits with a dot, a toast
//   and the bell.
// - An instruction in the Instructions panel (AGENTS.md) changes the result of the agent.
// - The recipe "Light for a product shot" runs from the search box, and a recipe runs from / in the composer.
// - A background task has a budget and the rules as its gate.
// - A note on a chair becomes a turn with its change set, and the note is done.
//   bunx --bun playwright test studio-agent --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import type { FileSink } from "bun";
import { LABS_ROOT } from "./builds";

// A turn waits for the editor window: on a busy machine a turn takes more than the default wait of 5 s.
const expect = baseExpect.configure({ timeout: 20_000 });

const REPO = join(LABS_ROOT, "..", "..");
const READY = { timeout: 90_000 };
test.describe.configure({ mode: "serial", timeout: 240_000 });

/** The steps of the script driver: a move as the first turn, a long wait as each later one. */
const SCRIPT = {
  turns: [
    [
      { say: "Moving the armchair for: {prompt}." },
      { say: "{context}" },
      { tool: "scene_command", input: { command: "entity.move", args: { entity: "armchair", x: 0.5 } } },
      { cost: 0.05, context: 0.12 },
    ],
    [{ say: "Thinking." }, { wait: 60_000 }, { say: "Too late." }],
  ],
  // One turn that changes five entities as one batch.
  prompts: {
    // Three turns that each rename the armchair and write the notes.
    ...Object.fromEntries(
      ["one", "two", "three"].map((word) => [
        `step ${word}`,
        [
          {
            tool: "scene_command",
            input: { command: "entity.rename", args: { entity: "armchair", name: `Chair ${word}` } },
          },
          { write: { path: "notes/agent.md", text: `${word}\n` } },
          { say: `Step ${word} done.` },
        ],
      ]),
    ),
    // A plan of five steps that runs with ticks, and a plan that the person denies.
    "plan the room": [
      {
        tool: "plan_propose",
        input: { title: "Rename five things", steps: ["Armchair", "Ottoman", "Shelf", "Lantern", "Coffee table"] },
      },
      ...["armchair", "ottoman", "shelf", "lantern", "coffee-table"].flatMap((entity, index) => [
        { tool: "scene_command", input: { command: "entity.rename", args: { entity, name: `Planned ${entity}` } } },
        { tool: "plan_step", input: { index, state: "done" } },
      ]),
      { tool: "plan_done", input: { summary: "Five names changed." } },
    ],
    "plan and deny": [
      { tool: "plan_propose", input: { title: "Remove the floor", steps: ["Delete the floor"] } },
      { tool: "scene_command", input: { command: "entity.delete", args: { entity: "floor" } } },
      { say: "I made no change." },
    ],
    // A turn that takes a frame and reads an entity, then waits (the presence shows meanwhile).
    "look around": [
      { tool: "scene_frame", input: { camera: "front", width: 320 } },
      { tool: "scene_query", input: { ids: ["lantern"] } },
      { wait: 6000 },
      { say: "Looked around." },
    ],
    // The inline prompt on the colour of the key light.
    "make this warmer": [
      {
        tool: "scene_command",
        input: {
          command: "component.set",
          args: { entity: "sun", component: "light", field: "colour", value: '"#ffd9a8"' },
        },
      },
      { say: "Warmer: {context}" },
    ],
    // A question with three options.
    "ask me": [
      { tool: "ask_person", input: { question: "Which light?", options: ["Warm", "Cool", "Neutral"] } },
      { say: "Going on." },
    ],
    // An agent that follows the project instructions.
    "tidy the floor": [
      {
        when: "never move the floor",
        steps: [{ say: "The instructions keep the floor where it is." }],
        otherwise: [
          { tool: "scene_command", input: { command: "entity.move", args: { entity: "floor", y: 0.5 } } },
          { say: "Moved the floor." },
        ],
      },
    ],
    // The prompt of the recipe "Light for a product shot" with its defaults.
    "Light the selection for a product shot: a warm key light, a soft fill light and a rim light. Keep the other lights as they are.":
      [{ say: "Lit for a product shot." }],
    "Give each entity of the scene a short and clear name; change no other value.": [{ say: "Names are tidy." }],
    // The prompt of a recipe of the person, made in the Hub.
    "Make the lamp warm": [{ say: "The lamp is warm." }],
    // The prompt of a note on a chair.
    'Do the task of the note "Turn it to the window" on Note chair.': [
      {
        tool: "scene_command",
        input: { command: "entity.rename", args: { entity: "armchair", name: "Window chair" } },
      },
      { say: "Turned." },
    ],
    // A background task in a worktree: a scene edit and a file of the task.
    "work on a branch": [
      { tool: "scene_command", input: { command: "entity.rename", args: { entity: "shelf", name: "Branch shelf" } } },
      { write: { path: "notes/branch.md", text: "branch\n" } },
      { cost: 0.1 },
      { say: "Done on the branch." },
    ],
    // A background task that renames the lantern.
    "name the lantern in the background": [
      { tool: "scene_command", input: { command: "entity.rename", args: { entity: "lantern", name: "Task lantern" } } },
      { cost: 0.2 },
      { say: "Named." },
    ],
    // One prompt for three variants; each variant sets the sun to its own intensity.
    ...Object.fromEntries(
      ["0.5", "1.5", "3"].map((value, at) => [
        `give me three lighting moods (variant ${String(at + 1)} of 3)`,
        [
          {
            tool: "scene_command",
            input: { command: "component.set", args: { entity: "sun", component: "light", field: "intensity", value } },
          },
          { cost: 0.1 },
          { say: `Mood ${String(at + 1)}.` },
        ],
      ]),
    ),
    // A question from the search box.
    "how bright is the key light": [{ say: "It is bright enough." }],
    // One turn that writes a file (Review asks for it).
    "write a note": [{ write: { path: "notes/review.md", text: "reviewed\n" } }, { say: "Wrote the note." }],
    // One turn that edits the scene and writes a plugin file.
    "rename and note": [
      { tool: "scene_command", input: { command: "entity.rename", args: { entity: "armchair", name: "Agent chair" } } },
      { write: { path: "plugins/agent/note.ts", text: "export const note = 1;\n" } },
      { say: "Renamed and noted." },
    ],
    "tidy the room": [
      { say: "Tidying." },
      {
        tool: "scene_batch",
        input: {
          title: "Tidy the room",
          steps: [
            { command: "entity.rename", args: { entity: "armchair", name: "Reading chair" } },
            { command: "entity.rename", args: { entity: "ottoman", name: "Footrest" } },
            { command: "entity.rename", args: { entity: "shelf", name: "Bookcase" } },
            { command: "entity.move", args: { entity: "lantern", x: 1 } },
            { command: "entity.rename", args: { entity: "coffee-table", name: "Low table" } },
          ],
        },
      },
    ],
  },
};

let dir = "";
let origin = "";
let secret = "";
let launchUrl = "";
let state = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** The first stdout line of the studio that starts with `prefix`. */
async function readyLine(process: ReturnType<typeof Bun.spawn>, prefix: string): Promise<string> {
  const reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the studio ended: ${text}`);
    text += new TextDecoder().decode(value);
    const line = text.split("\n").find((l) => l.startsWith(prefix));
    if (line !== undefined) return line.slice(prefix.length + 1);
  }
}

/** The record of the shelf asset of the showroom. */
const SHELF_RECORD = "assets/sources/Shelf_01/Shelf_01_1k.gltf.meta.json";

/** The parts of a task of the host that the spec reads. */
interface AgentTaskRecord {
  readonly prompt: string;
  readonly worktree?: string | null;
}

/** A new launch link of the studio (a launch code works once). */
async function launchLink(): Promise<string> {
  const answer = await fetch(`${origin}/api/launch-code`, { method: "POST", headers: { "x-studio-token": secret } });
  return ((await answer.json()) as { url: string }).url;
}

/**
 * Open the showroom in the editor window and wait until the page is still: the first load of a fresh studio can
 * reload the page once (Vite optimizes the new dependencies).
 */
async function openShowroom(page: Page): Promise<void> {
  const { url } = (await api("/api/projects/open", { dir: join(dir, "showroom") })) as { url: string };
  await page.goto(`${origin}${url}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('canvas[data-ready="1"]', READY);
}

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const answer = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(answer.status).toBe(200);
  return (await answer.json()) as Record<string, unknown>;
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-agent-"));
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"]) {
    cpSync(join(REPO, "samples", "showroom", part), join(dir, "showroom", part), { recursive: true });
  }
  // A turn that rewrites the record of the shelf asset (one more tag), for the mark of the Project window.
  const record = JSON.parse(readFileSync(join(dir, "showroom", SHELF_RECORD), "utf8")) as { tags?: string[] };
  const tagged = `${JSON.stringify({ ...record, tags: [...(record.tags ?? []), "agent"] }, null, 2)}\n`;
  (SCRIPT.prompts as Record<string, unknown>)["tag the shelf asset"] = [
    { write: { path: SHELF_RECORD, text: tagged } },
    { say: "Tagged the shelf." },
  ];
  const script = join(dir, "agent-script.json");
  writeFileSync(script, JSON.stringify(SCRIPT));
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  state = join(dir, "state");
  const main = join(REPO, "packages", "studio-host", "src", "main.ts");
  studio = Bun.spawn(["bun", main, "--port", String(port), "--state", state, "--no-open"], {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, SCENITY_AGENT_SCRIPT: script },
  });
  const ready = JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string };
  secret = (JSON.parse(await Bun.file(join(state, "host.json")).text()) as { secret: string }).secret;
  // The first launch link signs in the browser of the test (a launch code works once).
  launchUrl = ready.url;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("a prompt in the agent panel runs a turn of the host against the editor window", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(launchUrl);
  await openShowroom(page);
  // The panel joins the right area of the default layout, with no focus.
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  const composer = page.getByTestId("agent-composer");
  await expect(composer).toBeFocused();
  await composer.fill("move it a bit");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("agent-tab")).toHaveCount(1);
  const transcript = page.getByTestId("agent-transcript");
  await expect(transcript).toContainText("Moving the armchair for: move it a bit.");
  // The card of the call: the command and its target, the state, the raw call one click away.
  const card = transcript.locator('[data-testid="agent-card"][data-tool="scene_command"]');
  await expect(card.getByTestId("agent-card-title")).toContainText("▸ Armchair");
  await expect(card).toHaveAttribute("data-state", "proposed");
  await card.getByText("The raw call").click();
  await expect(card.getByTestId("agent-card-raw")).toContainText('"command": "entity.move"');
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  await card.getByTestId("agent-card-show").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["armchair"]);
  await expect(page.getByTestId("agent-cost")).toHaveText(/\$0\.05 · 12 % context/);
  // Review (the default mode): the move waits as a proposal of the window.
  const proposals = (): Promise<number> => page.evaluate(() => globalThis.__scenity?.proposals?.().length ?? -1);
  await expect.poll(proposals).toBe(1);
  // Auto sets the switch of the window to "apply".
  await page.getByTestId("agent-mode").click();
  await page.getByRole("option", { name: "Auto" }).click();
  await page.getByTestId("agent-auto-confirm").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.proposalMode?.())).toBe("apply");
  // A turn that waits; a prompt during it waits in the queue; Stop ends the turn and clears the queue.
  await composer.fill("and now?");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(transcript).toContainText("Thinking.");
  await composer.fill("one more");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("agent-queued")).toHaveText(/1 waiting/);
  await page.keyboard.press("ControlOrMeta+.");
  await expect(transcript).toContainText("Stopped.");
  await expect(page.getByTestId("agent-stop")).toHaveCount(0);
  await expect(page.getByTestId("agent-queued")).toHaveCount(0);
  await expect(transcript).not.toContainText("Too late.");
  // The ⋯ menu renames the session.
  await page.getByTestId("agent-session-menu").click();
  await page.locator('[data-command="agent.rename"]').click();
  await page.getByTestId("command-prompt-input").fill("Armchair");
  await page.getByTestId("command-prompt-go").click();
  await expect(page.getByTestId("agent-tab")).toContainText("Armchair");
  const listing = await api("/api/agent/sessions?project=showroom");
  expect(listing).toMatchObject({
    driver: "script",
    sessions: [{ name: "Armchair", mode: "auto", running: false, queued: 0 }],
  });
});

test("the chips of the composer go with the prompt, and a removed chip stays out", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await page.keyboard.press("ControlOrMeta+L");
  // A new session (the host keeps the session of the first test for the project).
  await page.getByTestId("agent-new").click();
  await expect(page.getByTestId("agent-tab")).toHaveCount(2);
  const chip = (kind: string) => page.locator(`[data-testid="agent-chip"][data-kind="${kind}"]`);
  await expect(chip("selection")).toContainText("Armchair");
  await expect(chip("scene")).toHaveCount(1);
  // The camera chip goes for this prompt.
  await chip("camera").getByTestId("agent-chip-remove").click();
  await expect(chip("camera")).toHaveCount(0);
  // `@` mentions an entity.
  const composer = page.getByTestId("agent-composer");
  await composer.fill("");
  await composer.pressSequentially("warm the @lantern");
  await expect(page.getByTestId("agent-mention").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(chip("entity")).toContainText("Lantern");
  await expect(composer).toHaveValue("warm the ");
  // A region of the Scene view.
  await page.getByTestId("agent-add").click();
  await page.getByRole("menuitem", { name: "A region of the Scene view" }).click();
  const layer = page.getByTestId("agent-region");
  const box = await layer.boundingBox();
  if (box === null) throw new Error("no region layer");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 4 });
  await page.mouse.up();
  await expect(chip("picture")).toContainText("A region of the Scene view");
  await page.keyboard.press("ControlOrMeta+Enter");
  const transcript = page.getByTestId("agent-transcript");
  await expect(transcript).toContainText("- selection: armchair (Armchair)");
  await expect(transcript).toContainText('- entity: entity:lantern "Lantern"');
  await expect(transcript).toContainText("- picture: A region of the Scene view (a picture)");
  await expect(transcript).not.toContainText("- camera:");
  const lines = page.getByTestId("agent-context").first().getByTestId("agent-context-line");
  await expect(lines.filter({ hasText: "selection" })).toHaveCount(1);
  // After the prompt, the camera chip returns, and the mention and the picture go.
  await expect(chip("camera")).toHaveCount(1);
  await expect(chip("entity")).toHaveCount(0);
  await expect(chip("picture")).toHaveCount(0);
});

test("a person accepts 3 of 5 changes of a turn as one step, rejects the rest, and the agent hears it", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-composer").fill("tidy the room");
  await page.keyboard.press("ControlOrMeta+Enter");
  // The turn waits as one change set: the status bar, the bar of the agent panel, the marks of the hierarchy.
  await expect(page.getByTestId("status-review")).toHaveText(/5 changes wait/);
  await expect(page.getByTestId("agent-changes")).toContainText("5 changes wait");
  await expect(page.getByTestId("hierarchy-change-armchair")).toHaveAttribute("data-change", "changed");
  await expect(page.locator('#scene-change-pins button[data-change="changed"]')).toHaveCount(4);
  // The moved lantern has a ghost at its new place in the Scene view (the colour of the session).
  const ghosts = () => page.evaluate(async () => (await globalThis.__scenity?.inspect?.())?.ghosts ?? 0);
  await expect.poll(ghosts).toBeGreaterThan(0);
  const names = () =>
    page.evaluate(() => {
      const entities = globalThis.__scenity?.document().entities ?? {};
      return ["armchair", "ottoman", "shelf", "coffee-table"].map((id) => entities[id]?.name);
    });
  expect(await names()).toEqual(["Armchair", "Ottoman", "Shelf", "Coffee table"]);
  const steps = () => page.evaluate(() => globalThis.__scenity?.history?.().steps.length ?? -1);
  const before = await steps();
  // The Review panel: five rows; two are not checked; the three checked ones apply as one step.
  await page.getByTestId("agent-review").click();
  const panel = page.getByTestId("review-panel");
  await expect(panel.getByTestId("review-row")).toHaveCount(5);
  await panel.getByTestId("review-preview").click();
  await expect(panel.getByTestId("review-preview")).toHaveAttribute("data-state", "checked");
  // Check gives the rules line and the Before and After pictures; the diff names the changed entities.
  await panel.getByTestId("review-check-run").click();
  await expect(panel.getByTestId("review-rules")).toHaveAttribute("data-passed", /^[01]$/, READY);
  await expect(panel.getByTestId("review-pictures").locator("img")).toHaveCount(2, READY);
  await panel.getByTestId("review-diff").locator("summary").click();
  await expect(panel.getByTestId("semantic-diff").locator('[data-entity="armchair"]')).toContainText("Reading chair");
  await panel.locator('[data-testid="review-row"][data-entity="shelf"]').getByTestId("review-check").first().uncheck();
  await panel
    .locator('[data-testid="review-row"][data-entity="coffee-table"]')
    .getByTestId("review-check")
    .first()
    .uncheck();
  await panel.getByTestId("review-accept-checked").click();
  await expect.poll(steps).toBe(before + 1);
  expect(await names()).toEqual(["Reading chair", "Footrest", "Shelf", "Coffee table"]);
  await expect(page.getByTestId("status-review")).toHaveText(/2 changes wait/);
  await panel.getByTestId("review-reject-all").click();
  await expect(page.getByTestId("status-review")).toHaveCount(0);
  await expect.poll(ghosts).toBe(0);
  await expect(panel).toContainText("No change waits for review.");
  await expect(page.getByTestId("hierarchy-change-armchair")).toHaveCount(0);
  // The next prompt of the session takes the result of the review.
  const review = page.locator('[data-testid="agent-chip"][data-kind="review"]');
  await expect(review.locator("[title]")).toHaveAttribute(
    "title",
    /accepted 3 of 5 changes\. Rejected: Shelf name, Coffee table name\./,
  );
  // One undo cancels the three changes.
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await names()).toEqual(["Armchair", "Ottoman", "Shelf", "Coffee table"]);
});

test("Undo the turn takes back the scene edit and the file of a turn with one action", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-mode").click();
  await page.getByRole("option", { name: "Auto" }).click();
  await page.getByTestId("agent-auto-confirm").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.proposalMode?.())).toBe("apply");
  await page.getByTestId("agent-composer").fill("rename and note");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("agent-transcript")).toContainText("Renamed and noted.");
  const note = join(dir, "showroom", "plugins", "agent", "note.ts");
  const name = (id: string) => page.evaluate((entity) => globalThis.__scenity?.document().entities[entity]?.name, id);
  expect(await name("armchair")).toBe("Agent chair");
  expect(existsSync(note)).toBe(true);
  // A later edit of the person stays after the undo of the turn.
  await page.evaluate(() => globalThis.__scenity?.command?.("entity.rename", { entity: "ottoman", name: "My stool" }));
  expect(await name("ottoman")).toBe("My stool");
  const steps = () => page.evaluate(() => globalThis.__scenity?.history?.().steps.length ?? -1);
  const before = await steps();
  await page.getByTestId("agent-undo-turn").last().click();
  await expect(page.getByTestId("agent-undone")).toContainText("1 file and 1 step went back");
  expect(await name("armchair")).toBe("Armchair");
  expect(await name("ottoman")).toBe("My stool");
  expect(existsSync(note)).toBe(false);
  expect(await steps()).toBe(before + 1);
  await expect(page.getByTestId("agent-undo-turn")).toHaveCount(0);
});

test("a restore after three turns gives the files and the scene of turn one", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-mode").click();
  await page.getByRole("option", { name: "Auto" }).click();
  await page.getByTestId("agent-auto-confirm").click();
  const composer = page.getByTestId("agent-composer");
  const transcript = page.getByTestId("agent-transcript");
  for (const word of ["one", "two", "three"]) {
    await composer.fill(`step ${word}`);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(transcript).toContainText(`Step ${word} done.`);
  }
  const notes = join(dir, "showroom", "notes", "agent.md");
  const chair = () => page.evaluate(() => globalThis.__scenity?.document().entities.armchair?.name);
  expect(await chair()).toBe("Chair three");
  expect(readFileSync(notes, "utf8")).toBe("three\n");
  // The checkpoint of turn two: the state after turn one.
  const checkpoint = page.locator('[data-testid="agent-checkpoint"][data-turn="2"]');
  await checkpoint.getByTestId("agent-checkpoint-preview").click();
  await expect(checkpoint.getByTestId("agent-checkpoint-entities")).toContainText("Chair three");
  await expect(checkpoint.getByTestId("agent-checkpoint-files")).toContainText("notes/agent.md");
  await checkpoint.getByTestId("agent-checkpoint-view").check();
  await expect(checkpoint.getByTestId("agent-checkpoint-view")).toBeChecked();
  await checkpoint.getByTestId("agent-checkpoint-restore").click();
  await expect(page.getByTestId("agent-undone").last()).toContainText(
    "The checkpoint of turn 2 is back: 1 file and 1 step",
  );
  expect(await chair()).toBe("Chair one");
  expect(readFileSync(notes, "utf8")).toBe("one\n");
  // The conversation stays, and undo cancels the restore of the scene.
  await expect(transcript).toContainText("Step three done.");
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await chair()).toBe("Chair three");
});

test("a file write of a Review session waits for an approval; Auto asks for a budget", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-composer").fill("write a note");
  await page.keyboard.press("ControlOrMeta+Enter");
  const approval = page.getByTestId("agent-approval");
  await expect(approval).toHaveAttribute("data-decision", "waiting");
  await expect(approval).toHaveAttribute("data-action", "files");
  await expect(approval).toContainText("notes/review.md");
  await expect(
    page.locator('[data-testid="agent-tab"][aria-selected="true"] [data-testid="agent-tab-waits"]'),
  ).toHaveCount(1);
  const note = join(dir, "showroom", "notes", "review.md");
  expect(existsSync(note)).toBe(false);
  await approval.getByTestId("agent-approval-once").click();
  await expect(page.getByTestId("agent-transcript")).toContainText("Wrote the note.");
  await expect(approval).toHaveAttribute("data-decision", "once");
  expect(readFileSync(note, "utf8")).toBe("reviewed\n");
  await expect(page.getByTestId("agent-tab-waits")).toHaveCount(0);
  // The switch to Auto asks first, with the budget of the session.
  await page.getByTestId("agent-mode").click();
  await page.getByRole("option", { name: "Auto" }).click();
  await expect(page.getByTestId("agent-auto-ask")).toBeVisible();
  await page.getByTestId("agent-auto-budget").fill("3");
  await page.getByTestId("agent-auto-confirm").click();
  await expect(page.getByTestId("agent-cost")).toContainText("$0.00 / $3.00");
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.proposalMode?.())).toBe("apply");
});

test("an asset whose file a turn wrote has the mark of the session in the Project window", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-composer").fill("tag the shelf asset");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.getByTestId("agent-approval").getByTestId("agent-approval-once").click();
  await expect(page.getByTestId("agent-transcript")).toContainText("Tagged the shelf.");
  const { id } = JSON.parse(readFileSync(join(dir, "showroom", SHELF_RECORD), "utf8")) as { id: string };
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.project"));
  const mark = page.getByTestId(`asset-tile-${id}`).getByTestId("asset-agent-mark");
  await expect(mark).toBeVisible(READY);
  await expect(mark).toHaveAttribute("aria-label", /changed this asset in turn 1$/);
});

test("a plan of five steps runs with ticks after its approval; a denied plan changes nothing", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-plan-first").check();
  const composer = page.getByTestId("agent-composer");
  await composer.fill("plan the room");
  await page.keyboard.press("ControlOrMeta+Enter");
  const plan = page.getByTestId("agent-plan").first();
  await expect(plan).toHaveAttribute("data-decision", "waiting");
  await expect(plan.getByTestId("agent-plan-step")).toHaveCount(5);
  await plan.getByTestId("agent-plan-approve").click();
  // The turn runs ten tool calls after the approval: it can take more than the default wait.
  await expect(plan.getByTestId("agent-plan-summary")).toHaveText("Five names changed.", READY);
  await expect(plan.getByTestId("agent-plan-count")).toHaveText("5/5 ✓");
  await expect(plan.locator('[data-testid="agent-plan-step"][data-state="done"]')).toHaveCount(5);
  await expect(page.getByTestId("status-review")).toHaveText(/5 changes wait/);
  await expect(plan).toContainText(".scenity/plans/");
  const plans = join(dir, "showroom", ".scenity", "plans");
  expect(existsSync(plans)).toBe(true);
  // A denied plan: the edit after it is refused, so nothing more waits.
  await composer.fill("plan and deny");
  await page.keyboard.press("ControlOrMeta+Enter");
  const denied = page.getByTestId("agent-plan").nth(1);
  await denied.getByTestId("agent-plan-deny").click();
  await expect(page.getByTestId("agent-transcript")).toContainText("I made no change.");
  await expect(denied).toHaveAttribute("data-decision", "denied");
  await expect(page.getByTestId("status-review")).toHaveText(/5 changes wait/);
});

test("during a turn the person sees what the agent works on, and the view does not change", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  // The person looks through the top camera, so the front camera of the agent is in the view.
  await page.evaluate(() => globalThis.__scenity?.setViewport?.({ camera: "top" }));
  const view = () => page.evaluate(() => JSON.stringify(globalThis.__scenity?.viewport?.()));
  const before = await view();
  await page.getByTestId("agent-composer").fill("look around");
  await page.keyboard.press("ControlOrMeta+Enter");
  // The marks of the entity that the turn reads, its camera, its activity and its frame.
  await expect(page.getByTestId("hierarchy-working-lantern")).toBeVisible();
  await expect(page.locator('#scene-change-pins button[data-change="working"]')).toHaveCount(1);
  await expect(page.locator('#scene-change-pins polygon[data-testid^="scene-agent-camera-"]')).toHaveCount(1);
  await expect(page.getByTestId("status-agent")).toContainText("scene_query");
  await page.evaluate(() => globalThis.__scenity?.command?.("agent.follow"));
  const follow = page.getByTestId("agent-follow");
  await expect(follow).toBeVisible();
  await expect
    .poll(() => follow.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  // The view, the selection and the focus of the person stay.
  expect(await view()).toBe(before);
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual([]);
  await expect(page.getByTestId("agent-composer")).toBeFocused();
  // At the end of the turn the marks and the activity go.
  await expect(page.getByTestId("agent-transcript")).toContainText("Looked around.", { timeout: 15_000 });
  await expect(page.getByTestId("hierarchy-working-lantern")).toHaveCount(0);
  await expect(page.getByTestId("status-agent")).toHaveCount(0);
});

test("Make this warmer on the colour of a light gives a change set on that field", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["sun"]));
  // The studio keeps the layout of the last test (the agent panel in front): the inspector moves to the front.
  await page.keyboard.press("ControlOrMeta+3");
  const row = page.locator('[data-component="light"][data-field="colour"]').first();
  await row.locator("input").first().focus();
  await page.keyboard.press("ControlOrMeta+I");
  const inline = page.getByTestId("agent-inline");
  await expect(inline.getByTestId("agent-inline-context")).toHaveText("Key light ▸ light.colour");
  await inline.getByTestId("agent-inline-field").fill("make this warmer");
  await page.keyboard.press("Enter");
  await expect(inline).toHaveCount(0);
  // The change waits on the field itself, with Accept and Reject beside it.
  await expect(row).toHaveAttribute("data-review", "1");
  await expect(page.getByTestId("status-review")).toHaveText(/1 change waits/);
  const colour = () =>
    page.evaluate(
      () => (globalThis.__scenity?.document().entities.sun?.components.light as { colour?: string }).colour,
    );
  expect(await colour()).toBe("#fff4e5");
  await row.locator('[data-testid$="-accept"]').click();
  await expect.poll(colour).toBe("#ffd9a8");
  await expect(row).not.toHaveAttribute("data-review", "1");
  // The prompt took the field as its context.
  await page.keyboard.press("ControlOrMeta+L");
  await expect(page.getByTestId("agent-transcript")).toContainText('component light field colour = "#fff4e5"');
});

test("an agent question with 3 options gets its answer in the panel", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-composer").fill("ask me");
  await page.keyboard.press("ControlOrMeta+Enter");
  const question = page.getByTestId("agent-question");
  await expect(question).toContainText("Which light?");
  await expect(question.getByTestId("agent-question-option")).toHaveText(["Warm", "Cool", "Neutral"]);
  // The session waits: a dot on its tab and a fact of the bell.
  await expect(
    page.locator('[data-testid="agent-tab"][aria-selected="true"] [data-testid="agent-tab-waits"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("status-bell")).toBeVisible();
  await question.getByTestId("agent-question-option").nth(1).click();
  await expect(question.getByTestId("agent-question-answer")).toHaveText("You answered: Cool");
  await expect(page.getByTestId("agent-transcript")).toContainText("Going on.");
  await expect(page.getByTestId("agent-transcript")).toContainText("The person answered: Cool");
  await expect(page.getByTestId("agent-tab-waits")).toHaveCount(0);
});

test("an instruction in AGENTS.md changes the result of the agent", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  const composer = page.getByTestId("agent-composer");
  const transcript = page.getByTestId("agent-transcript");
  await composer.fill("tidy the floor");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(transcript).toContainText("Moved the floor.");
  await expect(transcript.locator('[data-testid="agent-card"]')).toHaveCount(1);
  // The person writes an instruction in the Instructions panel.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.instructions"));
  const panel = page.getByTestId("instructions-panel");
  await panel.getByTestId("instructions-agents").fill("# Rules\n\n- Never move the floor.\n");
  await panel.getByTestId("instructions-save").click();
  await expect(panel.getByTestId("instructions-saved")).toBeVisible();
  expect(readFileSync(join(dir, "showroom", "AGENTS.md"), "utf8")).toContain("Never move the floor.");
  await page.keyboard.press("ControlOrMeta+L");
  await composer.fill("tidy the floor");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(transcript).toContainText("The instructions keep the floor where it is.");
  await expect(transcript.locator('[data-testid="agent-card"]')).toHaveCount(1);
});

test("Light for a product shot runs from the search box; a recipe runs from / in the composer", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+K");
  // `>` narrows the box to the commands (a recipe is a command).
  await page.keyboard.type(">light for a product");
  await expect(page.getByTestId("search-row").first()).toContainText("Light for a product shot");
  await page.keyboard.press("Enter");
  // The two parameters, each with its default.
  for (const value of ["the selection", "warm"]) {
    await expect(page.getByTestId("command-prompt-input")).toHaveValue(value);
    await page.getByTestId("command-prompt-go").click();
  }
  const transcript = page.getByTestId("agent-transcript");
  await expect(transcript).toContainText("Lit for a product shot.");
  // `/` in the composer lists the recipes.
  const composer = page.getByTestId("agent-composer");
  await composer.fill("");
  await composer.pressSequentially("/tidy");
  await expect(page.getByTestId("agent-mention")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(transcript).toContainText("Names are tidy.");
  await expect(composer).toHaveValue("");
});

test("a recipe of the person: made in the Hub, run in a project from the Hub", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await page.goto(`${origin}/`);
  await expect(page.getByTestId("hub")).toBeVisible();
  if (await page.getByTestId("first-run").isVisible()) await page.getByTestId("first-skip").click();
  await page.getByTestId("hub-nav-agents").click();
  await page.getByTestId("agents-recipe-new").click();
  await page.getByTestId("agents-recipe-title").fill("Warm lamp");
  await page.getByTestId("agents-recipe-prompt").fill("Make {what} warm");
  await page.getByTestId("agents-recipe-save").click();
  await expect(page.getByTestId("agents-recipe-edit-warm-lamp")).toBeVisible();
  // Run in the project: the editor of the showroom opens, asks for the field and sends the prompt.
  await page.getByTestId("agents-recipe-run-warm-lamp").click();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("command-prompt-input")).toBeVisible(READY);
  await page.getByTestId("command-prompt-input").fill("the lamp");
  await page.getByTestId("command-prompt-go").click();
  await expect(page.getByTestId("agent-transcript")).toContainText("The lamp is warm.", READY);
  expect(new URL(page.url()).searchParams.get("recipe")).toBeNull();
});

test("Ask the agent of the search box sends the text to the agent panel", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type("how bright is the key light");
  await expect(page.getByTestId("search-row").first()).toHaveAttribute("data-kind", "agent");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("agent-transcript")).toContainText("It is bright enough.");
});

test("a note on a chair becomes a turn with its change set, and the note is done", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  const note = await page.evaluate(async () => {
    const scenity = globalThis.__scenity;
    const named = (name: string): string =>
      Object.entries(scenity?.document().entities ?? {}).find(([, entity]) => entity.name === name)?.[0] ?? "";
    await scenity?.command?.("entity.create.empty", { name: "Note chair" });
    await scenity?.command?.("entity.create.note", { name: "Chair note", parent: named("Note chair") });
    const id = named("Chair note");
    const text = JSON.stringify("Turn it to the window");
    await scenity?.command?.("component.set", { entity: id, component: "annotation", field: "text", value: text });
    await scenity?.select?.([id]);
    return id;
  });
  expect(note).not.toBe("");
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">send the note");
  await expect(page.getByTestId("search-row").first()).toContainText("Send the note to the agent");
  await page.keyboard.press("Enter");
  // The turn of the note: its change set waits, and the note links to it.
  await expect(page.getByTestId("agent-transcript")).toContainText("Turned.");
  await expect(page.getByTestId("status-review")).toHaveText(/1 change waits/);
  const annotation = () =>
    page.evaluate(
      (id) => globalThis.__scenity?.document().entities[id]?.components.annotation as Record<string, unknown>,
      note,
    );
  await expect.poll(async () => (await annotation()).status).toBe("done");
  expect((await annotation()).task).toMatch(/^.+#\d+$/);
});

test("a background task with a budget and the rules as its gate ends with a notice; its turn waits in Review", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">new background task");
  await expect(page.getByTestId("search-row").first()).toContainText("New background task");
  await page.keyboard.press("Enter");
  const prompt = page.getByTestId("tasks-prompt");
  await expect(prompt).toBeFocused();
  await prompt.fill("name the lantern in the background");
  await page.getByTestId("tasks-budget").fill("2");
  await page.getByTestId("tasks-start").click();
  // The person continues to work while the task runs.
  await page.evaluate(() => globalThis.__scenity?.select?.(["floor"]));
  const row = page.getByTestId("tasks-row").first();
  await expect(row).toHaveAttribute("data-state", "done", READY);
  await expect(page.getByText(/The task "name the lantern in the background" ended: Done/)).toBeVisible();
  await expect(row.getByTestId("tasks-gate")).toHaveText("The rules pass.");
  await expect(row.getByTestId("tasks-facts")).toContainText("$0.20 / $2.00");
  await expect(row.getByTestId("tasks-facts")).toContainText("1 change waits");
  const pack = (await row.getByTestId("tasks-pack").textContent())?.match(/\.scenity\/tasks\/\S+\/REVIEW\.md/)?.[0];
  expect(readFileSync(join(dir, "showroom", pack ?? "none"), "utf8")).toContain("- Gate: rules: passed.");
  // Its turn waits in Review; the person accepts it.
  await row.getByTestId("tasks-review").click();
  const name = () => page.evaluate(() => globalThis.__scenity?.document().entities.lantern?.name);
  expect(await name()).not.toBe("Task lantern");
  await page.getByTestId("review-accept-checked").first().click();
  await expect.poll(name).toBe("Task lantern");
});

test("a background task in a Git worktree with scenity check as its gate keeps the folder of the person", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  // The project folder is a Git repository: the worktree of the task starts at its last commit.
  const project = join(dir, "showroom");
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "First"],
  ]) {
    const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: project,
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
  }
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.tasks"));
  await page.getByTestId("tasks-prompt").fill("work on a branch");
  await page.getByTestId("tasks-gate-select").click();
  await page.getByRole("option", { name: "The rules and scenity check" }).click();
  await page.getByTestId("tasks-worktree").check();
  await page.getByTestId("tasks-start").click();
  const row = page.getByTestId("tasks-row").filter({ hasText: "work on a branch" });
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await expect(row.getByTestId("tasks-gate")).toHaveText("The rules and scenity check pass.");
  await expect(row.getByTestId("tasks-facts")).toContainText("scenity/task-");
  const tasks = (await api("/api/agent/tasks?project=showroom")) as { tasks: AgentTaskRecord[] };
  const task = tasks.tasks.find((item) => item.prompt === "work on a branch");
  const tree = task?.worktree ?? "";
  // The file of the task and the scene after its change set are in the worktree. The folder of the person keeps its
  // own files.
  expect(readFileSync(join(tree, "notes/branch.md"), "utf8")).toBe("branch\n");
  expect(existsSync(join(project, "notes/branch.md"))).toBe(false);
  expect(readFileSync(join(tree, "scenes/main.scene.json"), "utf8")).toContain("Branch shelf");
  expect(readFileSync(join(project, "scenes/main.scene.json"), "utf8")).not.toContain("Branch shelf");
});

test("three lighting moods as three variants in a grid of frames; keep one", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  const intensity = () =>
    page.evaluate(
      () => (globalThis.__scenity?.document().entities.sun?.components.light as { intensity?: number }).intensity,
    );
  const before = await intensity();
  // One prompt for three agents: each variant is a background task with its own session.
  await page.evaluate(() => globalThis.__scenity?.command?.("agent.task.new"));
  await page.getByTestId("tasks-prompt").fill("give me three lighting moods");
  await page.getByTestId("tasks-variants").fill("3");
  await page.getByTestId("tasks-start").click();
  const done = page.locator('[data-testid="tasks-row"][data-group][data-state="done"]');
  await expect(done).toHaveCount(3, READY);
  // The grid shows the view after the changes of each variant; the document stays as it was.
  await page.getByTestId("tasks-compare").first().click();
  const grid = page.getByTestId("task-grid");
  await expect(grid).toHaveAttribute("data-loading", "0", READY);
  await expect(grid.getByTestId("task-grid-cell")).toHaveCount(3);
  const pictures = await grid
    .getByTestId("task-grid-frame")
    .evaluateAll((items) => items.map((item) => (item as HTMLCanvasElement).toDataURL()));
  expect(new Set(pictures).size).toBe(3);
  expect(await intensity()).toBe(before);
  // Keep the second mood: its change goes in, the other two go.
  await grid.getByTestId("task-grid-keep").nth(1).click();
  await expect.poll(intensity).toBe(1.5);
  await expect(done.getByTestId("tasks-facts").filter({ hasText: "1 change waits" })).toHaveCount(0);
});

/** A small MCP client over the stdio of a process (newline JSON-RPC), as an external agent uses `scenity mcp`. */
function stdioClient(child: ReturnType<typeof Bun.spawn>) {
  const waiting = new Map<number, (value: Record<string, unknown>) => void>();
  let next = 1;
  void (async () => {
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += new TextDecoder().decode(value);
      let at = text.indexOf("\n");
      while (at >= 0) {
        const line = text.slice(0, at);
        text = text.slice(at + 1);
        const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
        if (message.id !== undefined) waiting.get(message.id)?.(message.result ?? {});
        at = text.indexOf("\n");
      }
    }
  })();
  const send = (message: object): void => {
    void (child.stdin as FileSink).write(`${JSON.stringify(message)}\n`);
  };
  return {
    request: (method: string, params: object = {}): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        const id = next++;
        waiting.set(id, resolve);
        send({ jsonrpc: "2.0", id, method, params });
      }),
    notify: (method: string): void => send({ jsonrpc: "2.0", method }),
  };
}

test("an external agent over scenity mcp edits the open scene, and the change set waits", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  const mcp = Bun.spawn(
    ["bun", join(REPO, "packages", "studio-host", "src", "mcp.ts"), "--state", state, "--name", "Claude Code"],
    { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
  );
  try {
    // The owner allows the connection in the agent panel.
    const request = page.getByTestId("agent-connection");
    await expect(request).toContainText("Claude Code asks to work in this project");
    await request.getByTestId("agent-connection-allow").click();
    const client = stdioClient(mcp);
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "1" },
    });
    client.notify("notifications/initialized");
    const listed = (await client.request("tools/list")) as { tools?: { name: string }[] };
    expect((listed.tools ?? []).map((tool) => tool.name)).toContain("scene_command");
    const called = (await client.request("tools/call", {
      name: "scene_command",
      arguments: { command: "entity.rename", args: { entity: "armchair", name: "Terminal chair" } },
    })) as { content?: { text?: string }[] };
    expect(called.content?.[0]?.text ?? "").toContain("Proposal");
    // The change set of the external agent waits in the studio, in its session.
    await expect(page.getByTestId("status-review")).toHaveText(/1 change waits/);
    await expect(page.locator('[data-testid="agent-tab"]').filter({ hasText: "Claude Code" })).toHaveCount(1);
    await page.getByTestId("status-review").click();
    await expect(page.getByTestId("review-set")).toContainText("Claude Code");
    expect(await page.evaluate(() => globalThis.__scenity?.document().entities.armchair?.name)).toBe("Armchair");
  } finally {
    mcp.kill();
  }
});

test("the Hub allows a request with no project; a client over HTTP edits the scene until a revoke", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  // The state of this studio is fresh: the first run of the Hub is done, so its dialog does not cover the Hub.
  const preferences = await api("/api/user/preferences");
  await fetch(`${origin}/api/user/preferences`, {
    method: "PUT",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ ...preferences, firstRunDone: true }),
  });
  const hub = await page.context().newPage();
  await hub.goto(`${origin}/`);
  await hub.getByTestId("hub-nav-agents").click();
  // A stdio client with no project: the owner picks the project in the Hub and allows it.
  const { id } = (await api("/api/agent/connect", { name: "Zed" })) as { id: string };
  const request = hub.locator(`[data-connection="${id}"]`);
  await expect(request).toHaveAttribute("data-state", "pending");
  await request.getByTestId("agents-client-project").selectOption("showroom");
  await request.getByTestId("agents-client-allow").click();
  await expect(request).toHaveAttribute("data-state", "allowed");
  // A client over HTTP: the Hub makes the connection and shows its token once.
  await hub.getByTestId("agents-http-name").fill("Codex");
  await hub.getByTestId("agents-http-project").selectOption("showroom");
  await hub.getByTestId("agents-http-connect").click();
  const setup = (await hub.getByTestId("agents-http-setup").textContent()) ?? "";
  const token = /Bearer (\w+)/.exec(setup)?.[1] ?? "";
  const call = (): Promise<Response> =>
    fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "scene_command",
          arguments: { command: "entity.rename", args: { entity: "ottoman", name: "HTTP ottoman" } },
        },
      }),
    });
  const answer = (await (await call()).json()) as { result?: { content?: { text?: string }[] } };
  expect(answer.result?.content?.[0]?.text ?? "").toContain("Proposal");
  // The change set of the HTTP client waits in the editor window, in its own session.
  await page.bringToFront();
  await page.keyboard.press("ControlOrMeta+L");
  await expect(page.locator('[data-testid="agent-tab"]').filter({ hasText: "Codex" })).toHaveCount(1);
  await page.getByTestId("status-review").click();
  await expect(page.getByTestId("review-set").filter({ hasText: "Codex" })).toHaveCount(1);
  // Revoke cancels the token.
  const client = hub.getByTestId("agents-client").filter({ hasText: "Codex" });
  await client.getByTestId("agents-client-revoke").click();
  await expect(client).toHaveAttribute("data-state", "denied");
  expect((await call()).status).toBe(401);
  await hub.close();
});

test("the Terminal panel runs a shell in the project folder", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(await launchLink());
  await openShowroom(page);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.terminal"));
  const panel = page.getByTestId("terminal-panel");
  await panel.getByTestId("terminal-new-shell").click();
  await expect(panel.getByTestId("terminal-tab")).toHaveCount(1);
  const screen = panel.locator(".xterm-rows");
  await page.keyboard.type("echo scenity-$((40+2)) && pwd\n");
  await expect(screen).toContainText("scenity-42", { timeout: 15_000 });
  await expect(screen).toContainText("showroom");
  await panel.getByTestId("terminal-close").click();
  await expect(panel.getByTestId("terminal-tab")).toHaveCount(0);
});
