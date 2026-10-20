// SPDX-License-Identifier: Apache-2.0
/**
 * The API of the agent sessions:
 *
 * - `GET /api/agent/sessions?project=<key>`: the driver, the models, the efforts and the sessions with their
 *   transcripts;
 * - `POST /api/agent/sessions` with `{ project, name?, mode?, model?, effort? }`: a new session;
 * - `PATCH /api/agent/sessions/<id>` with `{ name?, mode?, model?, effort? }`: a change of a session;
 * - `POST /api/agent/sessions/<id>/prompt` with `{ text, context? }`: a prompt with its chips (context.ts).
 *   `POST …/<id>/stop`: stop the turn. `POST …/<id>/fork`: a new session with a copy of the transcript that continues
 *   the conversation;
 * - `DELETE /api/agent/sessions/<id>`: close a session;
 * - `GET /api/agent/sessions/<id>/turns`: the turn records. `POST …/<id>/turns/<n>/undo`: "Undo the turn".
 *   `POST …/<id>/turns/<n>/restore`: restore the checkpoint of the turn;
 * - `POST /api/agent/sessions/<id>/approvals/<approval>` with `{ decision: "once" | "session" | "deny", steps? }`:
 *   the answer to an approval card (`steps`: the steps of an edit of a plan);
 * - `POST /api/agent/sessions/<id>/questions/<question>` with `{ answer }`: the answer to a question;
 * - `GET /api/agent/pictures/<id>`: a picture of a tool result;
 * - `GET` and `PUT /api/agent/instructions`: the instructions of a project;
 * - `GET /api/agent/recipes?project=<key>`: the recipes of the studio, of the person and of the project;
 * - `GET /api/agent/usage`: the cost and the tokens of the day;
 * - `GET /api/agent/status`: the agent state of the studio (on or off), and the driver;
 * - `GET /api/agent/tasks?project=<key>&state=<state>&q=<words>`: the background tasks, the newest first.
 *   `POST /api/agent/tasks` with `{ project, prompt, name?, budgetUsd?, maxTurns?, maxMinutes?, gate?, worktree?,
 *   context? }`: a new task (`worktree: true`: in a Git worktree of the project). `POST /api/agent/tasks/<id>/stop`:
 *   the owner stops a task;
 * - the connections and the tool calls of the external agents (external.ts `externalApi`).
 *
 * The role of the request limits the modes of a new session and of a change (an editor has no Auto mode).
 */
import { APPROVAL_DECISIONS } from "./approvals";
import { readChips } from "./context";
import { externalApi } from "./external";
import { readInstructions, writeAgentsFile } from "./instructions";
import { readRecipes, writeUserRecipes } from "./recipes";
import { ACTION_KINDS, ROLE_MODES, roleAllows, type AgentRole } from "./permissions";
import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  AGENT_MODES,
  isAgentEffort,
  isAgentMode,
  TASK_GATES,
  TASK_STATES,
} from "./protocol";
import type { AgentSessionPatch, AgentSessions } from "./sessions";

function answer(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** The reason why a role cannot choose the mode of a patch, or null. */
export function modeRefusal(role: AgentRole, patch: AgentSessionPatch): string | null {
  if (patch.mode === undefined || roleAllows(role, patch.mode)) return null;
  const modes = ROLE_MODES[role];
  return `the role ${role} chooses ${modes.length === 0 ? "no mode" : `only the modes ${modes.join(" and ")}`}: the ${patch.mode} mode needs the owner of the studio`;
}

/** The patch of a request body: only the known fields with good values. */
function patchOf(body: Record<string, unknown>): AgentSessionPatch {
  return {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(isAgentMode(body.mode) ? { mode: body.mode } : {}),
    ...(typeof body.model === "string" && body.model !== "" ? { model: body.model } : {}),
    ...(isAgentEffort(body.effort) ? { effort: body.effort } : {}),
    ...(typeof body.budgetUsd === "number" ? { budgetUsd: body.budgetUsd } : {}),
    ...(typeof body.maxTurns === "number" ? { maxTurns: body.maxTurns } : {}),
    ...(typeof body.maxMinutes === "number" ? { maxMinutes: body.maxMinutes } : {}),
    ...(typeof body.planFirst === "boolean" ? { planFirst: body.planFirst } : {}),
  };
}

/**
 * `GET /api/agent/instructions?project=<key>` (AGENTS.md, CLAUDE.md, the skills) and `PUT` with `{ project,
 * agents }` (a new AGENTS.md).
 */
async function instructionsApi(
  request: Request,
  url: URL,
  dirOf: (project: string) => string | null,
): Promise<Response> {
  const body = request.method === "PUT" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const project = url.searchParams.get("project") ?? (typeof body.project === "string" ? body.project : "");
  const dir = dirOf(project);
  if (dir === null) return answer({ error: `no project ${project}` }, 404);
  if (request.method === "PUT") {
    if (typeof body.agents !== "string") return answer({ error: "give the text of AGENTS.md" }, 400);
    writeAgentsFile(dir, body.agents);
  }
  return answer(readInstructions(dir));
}

/** The API of the background tasks. */
async function taskApi(sessions: AgentSessions, request: Request, url: URL): Promise<Response> {
  const [, id, action] = /^\/api\/agent\/tasks(?:\/([\w-]+))?(?:\/(stop))?$/.exec(url.pathname) ?? [];
  const query = url.searchParams;
  const state = TASK_STATES.find((item) => item === query.get("state"));
  const number = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
  if (id === undefined && request.method === "GET") {
    const tasks = sessions.tasks.list({
      ...(query.has("project") ? { project: query.get("project") ?? "" } : {}),
      ...(state === undefined ? {} : { state }),
      ...(query.has("q") ? { text: query.get("q") ?? "" } : {}),
      ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
    });
    return answer({ tasks });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (id === undefined && request.method === "POST") {
    if (typeof body.project !== "string" || typeof body.prompt !== "string")
      return answer({ error: "give the project and the prompt" }, 400);
    const gate = TASK_GATES.find((item) => item === body.gate);
    const task = {
      prompt: body.prompt,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...Object.fromEntries(
        (["budgetUsd", "maxTurns", "maxMinutes"] as const).flatMap((key) =>
          number(body[key]) === undefined ? [] : [[key, number(body[key])]],
        ),
      ),
      ...(gate === undefined ? {} : { gate }),
      ...(body.worktree === true ? { worktree: true } : {}),
      context: readChips(body.context),
    };
    // A count of variants or a list of parts starts a group of parallel tasks.
    const parts = Array.isArray(body.parts) ? body.parts.filter((part) => typeof part === "string") : undefined;
    const count = number(body.variants);
    if (parts !== undefined)
      return answer({ tasks: sessions.tasks.startGroup(body.project, { ...task, kind: "split", parts }) });
    if (count !== undefined)
      return answer({ tasks: sessions.tasks.startGroup(body.project, { ...task, kind: "variants", count }) });
    return answer(sessions.tasks.start(body.project, task));
  }
  if (id !== undefined && action === "stop" && request.method === "POST") return answer(sessions.tasks.stop(id));
  return answer({ error: "no such path" }, 404);
}

/** The answer of a request of `/api/agent/…`. */
export async function agentApi(
  sessions: AgentSessions,
  request: Request,
  url: URL,
  dirOf: (project: string) => string | null = () => null,
  stateDir: string | null = null,
  options: { readonly role?: AgentRole } = {},
): Promise<Response> {
  const role = options.role ?? "admin";
  if (url.pathname === "/api/agent/instructions") return instructionsApi(request, url, dirOf);
  // The connections and the tool calls of the external agents.
  const external = await externalApi(sessions, request, url).catch((error: unknown) =>
    answer({ error: error instanceof Error ? error.message : String(error) }, 422),
  );
  if (external !== null) return external;
  // The agents are on.
  if (url.pathname === "/api/agent/status") return answer({ available: true, driver: sessions.driver });
  if (url.pathname.startsWith("/api/agent/tasks")) {
    return taskApi(sessions, request, url).catch((error: unknown) =>
      answer({ error: error instanceof Error ? error.message : String(error) }, 422),
    );
  }
  // The cost and the tokens of the day.
  if (url.pathname === "/api/agent/usage" && request.method === "GET") return answer({ today: sessions.today() });
  // The recipes of the studio, of the person and of the project.
  if (url.pathname === "/api/agent/recipes" && request.method === "GET") {
    return answer({ recipes: readRecipes(stateDir, dirOf(url.searchParams.get("project") ?? "")) });
  }
  // The recipes of the person: the Hub writes the whole list.
  if (url.pathname === "/api/agent/recipes" && request.method === "PUT") {
    if (stateDir === null) return answer({ error: "the studio has no state folder" }, 422);
    const body = (await request.json().catch(() => null)) as { recipes?: unknown } | null;
    const refused = writeUserRecipes(stateDir, body?.recipes);
    return refused === null ? answer({ recipes: readRecipes(stateDir, null) }) : answer({ error: refused }, 422);
  }
  const rest = url.pathname.slice("/api/agent/sessions".length).split("/").filter(Boolean);
  const body =
    request.method === "GET" || request.method === "DELETE"
      ? {}
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
  const picture = /^\/api\/agent\/pictures\/([a-z0-9]+)$/.exec(url.pathname)?.[1];
  if (picture !== undefined) {
    const found = sessions.pictures.get(picture);
    return found === null
      ? answer({ error: "no such picture" }, 404)
      : new Response(found.bytes, {
          headers: { "content-type": found.mime, "cache-control": "private, max-age=3600" },
        });
  }
  try {
    if (!url.pathname.startsWith("/api/agent/sessions")) return answer({ error: "no such path" }, 404);
    const [id, action] = rest;
    if (id === undefined && request.method === "GET") {
      const project = url.searchParams.get("project") ?? undefined;
      return answer({
        driver: sessions.driver,
        kinds: ACTION_KINDS,
        modes: AGENT_MODES,
        models: AGENT_MODELS,
        efforts: AGENT_EFFORTS,
        sessions: sessions.list(project),
      });
    }
    const refused = request.method === "GET" ? null : modeRefusal(role, patchOf(body));
    if (refused !== null && action === undefined) return answer({ error: refused }, 403);
    if (id === undefined && request.method === "POST") {
      if (typeof body.project !== "string") return answer({ error: "give the project" }, 400);
      return answer(sessions.create(body.project, patchOf(body)));
    }
    if (id === undefined) return answer({ error: "GET or POST /api/agent/sessions" }, 405);
    if (action === undefined && request.method === "PATCH") return answer(sessions.update(id, patchOf(body)));
    if (action === undefined && request.method === "DELETE") {
      sessions.close(id);
      return answer({ ok: true });
    }
    if (action === "prompt" && request.method === "POST")
      return answer(sessions.prompt(id, typeof body.text === "string" ? body.text : "", readChips(body.context)));
    if (action === "fork" && request.method === "POST") return answer(sessions.fork(id));
    if (action === "questions" && request.method === "POST") {
      if (typeof body.answer !== "string" || body.answer.trim() === "")
        return answer({ error: "give the answer" }, 400);
      sessions.answerQuestion(id, rest[2] ?? "", body.answer);
      return answer({ ok: true });
    }
    if (action === "approvals" && request.method === "POST") {
      const decision = APPROVAL_DECISIONS.find((item) => item === body.decision);
      if (decision === undefined) return answer({ error: "the decision is once, session or deny" }, 400);
      const steps = Array.isArray(body.steps) ? body.steps.filter((step) => typeof step === "string") : undefined;
      sessions.answer(id, rest[2] ?? "", decision, steps);
      return answer({ ok: true });
    }
    if (action === "turns" && request.method === "GET") return answer({ turns: sessions.turnRecords(id) });
    const [, , turn, undo] = rest;
    if (action === "turns" && (undo === "undo" || undo === "restore") && request.method === "POST") {
      return answer(await sessions.undoTurn(id, Number(turn), undo === "restore"));
    }
    if (action === "stop" && request.method === "POST") {
      sessions.stop(id);
      return answer({ ok: true });
    }
    return answer({ error: "no such action" }, 404);
  } catch (error) {
    return answer({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
}
