// SPDX-License-Identifier: Apache-2.0
/**
 * The turns of Claude over time: the saved turns of the open checkout from the state folder of the host
 * (`agent.turnList`), and the pictures of the turn in the panel (`agent.turnPictures`). The pictures are the before and
 * after and the one-row sheets of the turn window. The list comes back after a page reload or a host restart. The owner
 * picks a turn, or follows the newest one.
 */
import type { EventPayload, SavedTurn, TurnPictures } from "@scenity/workbench-host/protocol";
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { HostClient } from "../host/hostClient";

/** The client parts of the history. */
export type HistoryClient = Pick<HostClient, "request" | "on">;

/** The key of a turn: the session and the number. */
export interface TurnKey {
  readonly session: string;
  readonly turn: number;
}

/** What the panel shows of one turn: the live `agent.turn` event, or a saved turn with its sheets. */
export interface TurnDisplay extends TurnKey {
  readonly prompt: string;
  readonly files: readonly string[];
  readonly url: string | null;
  readonly reloaded: boolean;
  readonly before: TurnPictures["before"];
  readonly after: TurnPictures["after"];
  readonly beforeSheet: TurnPictures["beforeSheet"];
  readonly afterSheet: TurnPictures["afterSheet"];
  readonly window: SavedTurn["window"];
}

export interface TurnHistory {
  /** The saved turns, the newest first. */
  readonly turns: Readonly<ShallowRef<readonly SavedTurn[]>>;
  /** The turn that the owner picked, or null: the newest turn. */
  readonly selected: Readonly<Ref<TurnKey | null>>;
  /** The turn in the panel, or null. */
  readonly display: ComputedRef<TurnDisplay | null>;
  /** Pick a turn (null: follow the newest turn). */
  select(key: TurnKey | null): void;
  /** Read the list again (a new connection). */
  load(client: HistoryClient): Promise<void>;
  /** The listeners of the history on a client; give the stop functions. */
  listen(client: HistoryClient): (() => void)[];
}

/** True when two keys name the same turn. */
export function sameTurn(a: TurnKey | null | undefined, b: TurnKey | null | undefined): boolean {
  if (!a || !b) return false;
  return a.session === b.session && a.turn === b.turn;
}

/** The list with a saved turn added or replaced, the newest first. */
export function upsertTurn(list: readonly SavedTurn[], turn: SavedTurn): SavedTurn[] {
  const rest = list.filter((item) => !sameTurn(item, turn));
  return [turn, ...rest].sort((a, b) => b.started.localeCompare(a.started) || b.turn - a.turn);
}

function fromLive(live: EventPayload<"agent.turn">): TurnDisplay {
  const { session, turn, files, url, reloaded, before, after } = live;
  return {
    session,
    turn,
    prompt: "",
    files,
    url,
    reloaded,
    before,
    after,
    beforeSheet: null,
    afterSheet: null,
    window: null,
  };
}

function fromSaved(pictures: TurnPictures): TurnDisplay {
  const { turn: saved, before, after, beforeSheet, afterSheet } = pictures;
  const { session, turn, prompt, files, url, reloaded, window } = saved;
  return { session, turn, prompt, files, url, reloaded, before, after, beforeSheet, afterSheet, window };
}

/** A saved turn with the pictures and the facts of a newer live event of the same turn. */
function merge(saved: TurnDisplay, live: TurnDisplay): TurnDisplay {
  return {
    ...saved,
    files: live.files,
    reloaded: live.reloaded,
    before: live.before ?? saved.before,
    after: live.after ?? saved.after,
  };
}

/** Make the history of the turns. `live` is the last `agent.turn` event of the page. */
export function useTurnHistory(live: Readonly<ShallowRef<EventPayload<"agent.turn"> | null>>): TurnHistory {
  const turns = shallowRef<readonly SavedTurn[]>([]);
  const selected = ref<TurnKey | null>(null);
  const pictures = shallowRef<TurnPictures | null>(null);
  let client: HistoryClient | null = null;
  let asked = 0;

  /** The key of the turn in the panel: the pick of the owner, else the newest saved turn. */
  const target = (): TurnKey | null => selected.value ?? turns.value[0] ?? null;

  async function fetchPictures(): Promise<void> {
    const key = target();
    const current = client;
    const ask = ++asked;
    if (key === null || current === null) return;
    try {
      const result = await current.request("agent.turnPictures", { session: key.session, turn: key.turn });
      if (ask === asked) pictures.value = result;
    } catch {
      // The host has no pictures of the turn (an old host, or the turn is gone): the live event stays.
    }
  }

  const display = computed<TurnDisplay | null>(() => {
    const event = live.value;
    const key = target();
    const saved = pictures.value !== null && sameTurn(pictures.value.turn, key) ? fromSaved(pictures.value) : null;
    const liveShown = event === null ? null : fromLive(event);
    if (selected.value !== null) return saved ?? (sameTurn(liveShown, key) ? liveShown : null);
    // Follow the newest turn: a live event of a turn that the list does not have yet is the newest.
    if (liveShown !== null && !turns.value.some((item) => sameTurn(item, liveShown))) return liveShown;
    // The live event of the same turn can be newer than its saved pictures (the sheets come later).
    if (saved !== null && liveShown !== null && sameTurn(saved, liveShown)) return merge(saved, liveShown);
    return saved ?? liveShown;
  });

  return {
    turns,
    selected,
    display,
    select(key) {
      selected.value = key;
      void fetchPictures();
    },
    async load(next) {
      client = next;
      try {
        const result = await next.request("agent.turnList", {});
        turns.value = Array.isArray(result.turns) ? result.turns : [];
      } catch {
        turns.value = [];
      }
      await fetchPictures();
    },
    listen(next) {
      return [
        next.on("agent.turnSaved", ({ turn }) => {
          turns.value = upsertTurn(turns.value, turn);
          if (sameTurn(turn, target())) void fetchPictures();
        }),
      ];
    },
  };
}
