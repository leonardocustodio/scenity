// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the editor window for the person. It has the question of the browser before a close with unsaved
 * changes and the banner of the play mode. In the studio, it also has the banner of the restricted mode with the
 * trust of the project (`confirm.trust`).
 */
import { csrfValue } from "../hub/studioApi";
import type { WindowNotices } from "../studio/shell/dialogs";
import { t } from "../texts";
import { studioAccess, viewerReason } from "../studio/shell/viewerRole";
import { servedByStudio } from "./projects/noProject";

/** Ask before a close of the window (or a reload) while the document has unsaved changes. */
export function guardUnsaved(dirty: () => boolean, target: Window = window): void {
  target.addEventListener("beforeunload", (event) => {
    if (dirty()) event.preventDefault();
  });
}

/** The banner of the play mode while the page plays (`body[data-play="1"]`, play/playBar.ts). */
export function showPlayBanner(notices: WindowNotices, body: HTMLElement = document.body): void {
  let hide: (() => void) | null = null;
  const update = (): void => {
    const playing = body.dataset.play === "1";
    if (playing && hide === null) hide = notices.banner({ id: "play", text: t("notice-playing"), tone: "play" });
    else if (!playing && hide !== null) {
      hide();
      hide = null;
    }
  };
  new MutationObserver(update).observe(body, { attributes: true, attributeFilter: ["data-play"] });
  update();
}

interface OpenProject {
  readonly key: string;
  readonly dir: string;
  readonly restricted: boolean;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * In the studio, a project that opens restricted (no plugin code) shows a banner. Its action asks for the trust
 * (`confirm.trust`), the host keeps it, and the page loads again with the plugins. Only the owner can trust a
 * project, so the banner of an editor or a viewer gives that reason and has no action.
 */
export async function showRestricted(
  notices: WindowNotices,
  project: string,
  fetcher: Fetcher = (input, init) => fetch(input, init),
  reload: () => void = () => location.reload(),
): Promise<boolean> {
  if (!(await servedByStudio(() => fetcher("/health")))) return false;
  const answer = await fetcher("/api/state").catch(() => null);
  if (!answer?.ok) return false;
  const state = (await answer.json()) as { open?: readonly OpenProject[]; role?: string };
  const open = state.open?.find((item) => item.key === project);
  if (open?.restricted !== true) return false;
  if ((state.role ?? "admin") !== "admin") {
    notices.banner({ id: "restricted", text: t("notice-restricted-owner"), tone: "caution" });
    return true;
  }
  const trust = async (): Promise<void> => {
    const choice = await notices.ask({
      spec: "confirm.trust",
      title: t("notice-trust-title"),
      text: t("notice-trust-text", { name: project }),
      testId: "trust-dialog",
      actions: [
        { id: "no", label: t("notice-trust-no"), testId: "trust-no", tone: "plain" },
        { id: "yes", label: t("notice-trust-yes"), testId: "trust-yes", tone: "primary" },
      ],
      safe: "no",
      dismiss: "no",
    });
    if (choice?.action !== "yes") return;
    const done = await fetcher("/api/projects/trust", {
      method: "POST",
      headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
      body: JSON.stringify({ key: project }),
    }).catch(() => null);
    if (done?.ok === true) reload();
  };
  notices.banner({
    id: "restricted",
    text: t("notice-restricted"),
    tone: "caution",
    action: { label: t("notice-trust"), testId: "trust-project", run: () => void trust() },
  });
  return true;
}

/**
 * A window of a viewer of the studio (a link with the role `viewer`) shows a banner and gives `lock` the reason. The
 * viewer can look and add notes, but cannot change the scene. The result is true for a viewer. The role and the
 * remote mode go to `studioAccess` for the reasons of the controls.
 */
export async function showViewer(
  notices: WindowNotices,
  lock: (reason: string) => void,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<boolean> {
  if (!(await servedByStudio(() => fetcher("/health")))) return false;
  const answer = await fetcher("/api/state").catch(() => null);
  if (!answer?.ok) return false;
  const state = (await answer.json()) as { role?: string; remote?: boolean };
  const role = state.role === "viewer" || state.role === "editor" ? state.role : "admin";
  studioAccess.value = { role, remote: state.remote === true };
  if (role !== "viewer") return false;
  notices.banner({ id: "viewer", text: t("notice-viewer"), tone: "info" });
  lock(t("notice-viewer-locked"));
  return true;
}

/** Lock the edits of the scene and disable Save, with the reason. */
export function lockWindow(
  editor: { readonly channel: { lock: string | null } },
  bar: { lock?(reason: string): void },
  reason: string,
): void {
  editor.channel.lock = reason;
  bar.lock?.(reason);
  viewerReason.value = reason;
}

/** The window state of the edit mode: the unsaved guard, the play banner, the restricted and the viewer banners. */
export function startWindowState(
  notices: WindowNotices,
  editor: { readonly dirty: boolean; readonly channel: { lock: string | null } },
  bar: { lock?(reason: string): void },
  project: string,
): void {
  guardUnsaved(() => editor.dirty);
  showPlayBanner(notices);
  void showRestricted(notices, project);
  void showViewer(notices, (reason) => lockWindow(editor, bar, reason));
}
