// SPDX-License-Identifier: Apache-2.0
/**
 * Review links: the owner shares a turn of an agent with a person who reviews it. The link is a launch link of the
 * role `viewer` (it works for 7 days) to this editor window with `review=<session>:<turn>`. The window of the viewer
 * shows the session with the turn (its pictures and the changes of its tools) and the Notes panel. The viewer can look
 * and add notes, but cannot change the project.
 */
import { csrfValue } from "../../hub/studioApi";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import type { AgentStore } from "./agentStore";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The path of this window with the turn to review (no prompt of "Start from a prompt"). */
export function reviewPath(href: string, session: string, turn: number): string {
  const url = new URL(href);
  url.searchParams.delete("prompt");
  url.searchParams.set("review", `${session}:${String(turn)}`);
  return `${url.pathname}${url.search}`;
}

/** The turn of the URL of a review link, or null. */
export function reviewOf(href: string): { readonly session: string; readonly turn: number } | null {
  const value = new URL(href).searchParams.get("review") ?? "";
  const match = /^([A-Za-z0-9-]+):(\d+)$/.exec(value);
  return match === null ? null : { session: match[1] ?? "", turn: Number(match[2]) };
}

/** A review link of a turn. A refusal throws its reason (only the owner makes links). */
export async function shareTurn(
  session: string,
  turn: number,
  href: string = location.href,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<string> {
  const answer = await fetcher("/api/launch-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
    body: JSON.stringify({ role: "viewer", review: true, next: reviewPath(href, session, turn) }),
  });
  const data = (await answer.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!answer.ok || data.url === undefined) throw new Error(data.error ?? answer.statusText);
  return data.url;
}

/** The review link of a turn of the active session, in a dialog that copies it. */
export async function shareDialog(
  shell: Pick<StudioShell, "notices">,
  store: Pick<AgentStore, "current">,
  turn: number,
): Promise<void> {
  const id = store.current()?.id;
  if (id === undefined) return;
  try {
    const link = await shareTurn(id, turn);
    const answer = await shell.notices.ask({
      spec: "notice.reviewLink",
      title: t("agent-share-title"),
      text: t("agent-share-text"),
      input: { label: t("agent-share-link"), testId: "agent-share-link", value: link },
      actions: [
        { id: "copy", label: t("agent-share-copy"), testId: "agent-share-copy", tone: "primary" },
        { id: "close", label: t("agent-share-close") },
      ],
      dismiss: "close",
    });
    if (answer?.action === "copy") await navigator.clipboard.writeText(link).catch(() => undefined);
  } catch (error) {
    shell.notices.toast(t("agent-share-failed", { reason: error instanceof Error ? error.message : String(error) }));
  }
}

/** The window of a review link shows the session of the turn and the Notes panel. */
export function openReview(
  store: Pick<AgentStore, "select" | "sessions">,
  shell: Pick<StudioShell, "showPanel">,
  href: string = location.href,
): boolean {
  const review = reviewOf(href);
  if (review === null) return false;
  shell.showPanel("notes");
  shell.showPanel("agent");
  // The sessions of the host come a moment after the start of the panel.
  const pick = (): boolean => {
    if (!store.sessions.value.some((session) => session.id === review.session)) return false;
    store.select(review.session);
    return true;
  };
  if (!pick()) {
    const timer = setInterval(() => {
      if (pick()) clearInterval(timer);
    }, 250);
    setTimeout(() => clearInterval(timer), 15_000);
  }
  return true;
}
