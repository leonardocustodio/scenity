// SPDX-License-Identifier: Apache-2.0
/**
 * The saved turns of Claude with their pictures. The host writes each turn into its state folder, so a new turn, a
 * page reload or a host restart keeps the before and after of a turn:
 *
 * `<state>/turns/<checkout hash>/pictures/<session>/<turn>/turn.json` (the facts) and `<name>.json` per picture
 * (`before`, `after`, `beforeSheet`, `afterSheet`: the time, the size, the type and the ID of the picture). The bytes
 * go to the picture store of the host (pictures.ts, `<state>/pictures/<id>.<ext>`), so the page reads them by ID. A
 * turn of an older host with `<name>.webp` in its folder moves its picture to the store at the first read. The store
 * keeps the newest `maxTurns` turns of a checkout.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PictureStore } from "./pictures";
import {
  isCaptureMime,
  isPictureId,
  PICTURE_EXTENSIONS,
  TURN_PICTURE_NAMES,
  type Capture,
  type PictureRef,
  type SavedTurn,
  type TurnPictureName,
  type TurnPictures,
} from "./protocol";
import { checkoutHash, readJsonObject, writeJsonAtomic } from "./state";

/** The facts of a turn without the list of its pictures (the store finds them in the folder). */
export type TurnFacts = Omit<SavedTurn, "pictures">;

const MAX_TURNS = 100;

/** The folder name of a session: its ID when it is a plain ID, else a hash of it. */
export function sessionFolder(session: string): string {
  if (session === "") return "none";
  return /^[\w-]{1,128}$/.test(session)
    ? session
    : `s-${createHash("sha256").update(session).digest("hex").slice(0, 16)}`;
}

function isFacts(value: Record<string, unknown>): boolean {
  return typeof value.session === "string" && typeof value.turn === "number" && typeof value.started === "string";
}

/** The saved turns and their pictures, per checkout. */
export class TurnPictureStore {
  readonly #root: string;
  readonly #maxTurns: number;
  readonly #store: PictureStore;

  constructor(stateDir: string, store: PictureStore, options: { readonly maxTurns?: number } = {}) {
    this.#root = join(stateDir, "turns");
    this.#store = store;
    this.#maxTurns = options.maxTurns ?? MAX_TURNS;
  }

  #base(checkout: string): string {
    return join(this.#root, checkoutHash(checkout), "pictures");
  }

  #folder(checkout: string, session: string, turn: number): string {
    return join(this.#base(checkout), sessionFolder(session), String(turn));
  }

  /** The names of the pictures in the folder of a turn. */
  #names(folder: string): TurnPictureName[] {
    return TURN_PICTURE_NAMES.filter((name) => existsSync(join(folder, `${name}.json`)));
  }

  #view(folder: string): SavedTurn | null {
    const facts = readJsonObject(join(folder, "turn.json"));
    if (!isFacts(facts)) return null;
    return { ...(facts as unknown as TurnFacts), pictures: this.#names(folder) };
  }

  /** Write the facts of a turn (a new turn, or new facts after the after capture). Give the saved turn. */
  saveFacts(checkout: string, facts: TurnFacts): SavedTurn {
    const folder = this.#folder(checkout, facts.session, facts.turn);
    const fresh = !existsSync(folder);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeJsonAtomic(join(folder, "turn.json"), facts);
    if (fresh) this.#prune(checkout);
    return { ...facts, pictures: this.#names(folder) };
  }

  /**
   * Write one picture of a saved turn: the bytes to the picture store, the facts and the ID to the turn folder. Give
   * the saved turn, or null when the turn has no facts yet.
   */
  savePicture(
    checkout: string,
    session: string,
    turn: number,
    name: TurnPictureName,
    picture: Capture,
  ): SavedTurn | null {
    const folder = this.#folder(checkout, session, turn);
    if (!existsSync(join(folder, "turn.json"))) return null;
    writeJsonAtomic(join(folder, `${name}.json`), this.#store.ref(picture));
    return this.#view(folder);
  }

  /** The saved turns of a checkout, the newest first. */
  list(checkout: string): SavedTurn[] {
    const base = this.#base(checkout);
    if (!existsSync(base)) return [];
    const turns: SavedTurn[] = [];
    for (const session of readdirSync(base)) {
      for (const turn of readdirSync(join(base, session))) {
        const view = this.#view(join(base, session, turn));
        if (view !== null) turns.push(view);
      }
    }
    return turns.sort((a, b) => b.started.localeCompare(a.started) || b.turn - a.turn);
  }

  /** The facts and the pictures of one turn. Throw an error for a turn that the store does not have. */
  pictures(checkout: string, session: string, turn: number): TurnPictures {
    const folder = this.#folder(checkout, session, turn);
    const view = this.#view(folder);
    if (view === null) throw new Error(`No saved turn ${String(turn)} of the session ${session}.`);
    const read = (name: TurnPictureName): PictureRef | null => readPicture(folder, name, this.#store);
    return {
      turn: view,
      before: read("before"),
      after: read("after"),
      beforeSheet: read("beforeSheet"),
      afterSheet: read("afterSheet"),
    };
  }

  /** Delete the oldest turns above `maxTurns`. */
  #prune(checkout: string): void {
    const extra = this.list(checkout).slice(this.#maxTurns);
    for (const turn of extra) {
      rmSync(this.#folder(checkout, turn.session, turn.turn), { recursive: true, force: true });
    }
  }
}

/**
 * Read one picture of the folder of a turn as a reference of the picture store, or null. A picture of an older host
 * (a file in the turn folder) moves to the store first.
 */
function readPicture(folder: string, name: TurnPictureName, store: PictureStore): PictureRef | null {
  const path = join(folder, `${name}.json`);
  const meta = readJsonObject(path);
  const mime = isCaptureMime(meta.mime) ? meta.mime : null;
  if (mime === null || typeof meta.width !== "number" || typeof meta.height !== "number") return null;
  const simMs = typeof meta.simMs === "number" ? meta.simMs : null;
  const base = { simMs, width: meta.width, height: meta.height, mime };
  if (isPictureId(meta.id)) return store.has(meta.id) ? { ...base, id: meta.id } : null;
  const file = join(folder, `${name}.${PICTURE_EXTENSIONS[mime]}`);
  if (!existsSync(file)) return null;
  const ref = store.ref({ ...base, bytes: readFileSync(file) });
  writeJsonAtomic(path, ref);
  rmSync(file, { force: true });
  return ref;
}
