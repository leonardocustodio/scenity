// SPDX-License-Identifier: Apache-2.0
/**
 * "Follow the agent": a second view at the corner of the Scene view shows the last frame of the agent that works (its
 * picture from the studio host). The view of the person never moves. The status bar shows the activity of the agent.
 * A press on it opens the agent panel. The Agent overlay of the Scene view holds the activity, the switch and the
 * follow view.
 */
import { watchEffect } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import { whenOverlays } from "../viewport/viewOverlays";
import { newestRunning, pagePresences } from "./presence";

/** The newest presence with a picture, or null. */
function newestPicture() {
  let found = null;
  for (const presence of pagePresences().values()) {
    if (presence.picture !== null && (found === null || presence.at > found.at)) found = presence;
  }
  return found;
}

/** Start the follow view and the status item of the agents. The returned function toggles the follow view. */
export function startFollowView(shell: Pick<StudioShell, "status" | "showPanel">): () => boolean {
  const figure = document.createElement("figure");
  figure.id = "scene-agent-follow";
  figure.dataset.testid = "agent-follow";
  figure.hidden = true;
  const image = document.createElement("img");
  image.alt = "";
  const caption = document.createElement("figcaption");
  figure.append(image, caption);
  placePart(figure, "view");
  let following = false;
  // The Agent overlay of the Scene view: the activity, "Follow the agent" and the follow view.
  const activity = document.createElement("p");
  activity.dataset.testid = "overlay-agent-status";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = t("command-agent-follow");
  toggle.dataset.testid = "overlay-agent-follow";
  toggle.addEventListener("click", () => {
    flip();
  });
  whenOverlays((dock) => {
    const box = document.createElement("div");
    box.className = "scene-overlay-column";
    box.append(activity, toggle, figure);
    dock.add({ id: "agent", title: () => t("overlay-agent"), edge: "bottom", order: 1, content: box });
  });
  watchEffect(() => {
    const running = newestRunning();
    activity.textContent =
      running === null ? t("overlay-agent-idle") : `${running.session.name}: ${running.activity ?? ""}`;
    shell.status.set("agent", running === null ? null : `${running.session.name}: ${running.activity ?? ""}`);
    const shown = newestPicture();
    figure.hidden = !following;
    caption.textContent =
      shown === null ? t("agent-follow-none") : t("agent-follow-caption", { name: shown.session.name });
    if (shown !== null) {
      const src = `/api/agent/pictures/${encodeURIComponent(shown.picture ?? "")}`;
      if (image.getAttribute("src") !== src) image.setAttribute("src", src);
      image.alt = t("agent-follow-alt", { name: shown.session.name });
    }
    figure.dataset.following = following ? "1" : "0";
  });
  shell.status.onPress("agent", () => shell.showPanel("agent"), "agent.focus");
  const flip = (): boolean => {
    following = !following;
    figure.hidden = !following;
    figure.dataset.following = following ? "1" : "0";
    toggle.setAttribute("aria-pressed", String(following));
    return following;
  };
  return flip;
}
