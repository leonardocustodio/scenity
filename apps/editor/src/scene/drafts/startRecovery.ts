// SPDX-License-Identifier: Apache-2.0
/**
 * The recovery and the autosave of the edit mode. The page offers a draft at the load (the recovery dialog of
 * `offerDraft`, with the changes of the draft). When the drafts of the host bring a draft that the browser did not have
 * (a closed tab, another browser), the page offers it after their load. The autosave of the project saves the open
 * scene after a time with no edit (autosave.ts). For a file of an older format, the page offers its upgrade
 * (formatUpgrade.ts).
 */
import {
  documentValue,
  sceneDraftKey,
  SceneDrafts,
  type DraftStorage,
  type EditorSettings,
} from "@scenity/editor-core";
import { hostPreferences } from "../../studio/shell/hostPreferences";
import type { SceneBar } from "../sceneBar";
import type { ScenePageEditor } from "../sceneEditor";
import { pageSettings } from "../settings/pageSettings";
import { t } from "../../texts";
import { startAutosave } from "./autosave";
import { lineDiff, upgradeOffer } from "./formatUpgrade";
import { HostDraftStorage } from "./hostDrafts";

/** The drafts of a scene file of a project: in the browser storage `local` and on the host. */
export function pageDrafts(
  local: DraftStorage | null,
  project: string,
  path: string,
): { storage: HostDraftStorage; drafts: SceneDrafts } {
  const storage = new HostDraftStorage(local, `/projects/${project}/`);
  return { storage, drafts: new SceneDrafts(storage, sceneDraftKey(project, path), path) };
}

/**
 * The settings for the autosave: when the project sets no `autosave.enabled`, the autosave preference of the person on
 * the studio host decides (outside the studio: off).
 */
function autosaveSettings(): EditorSettings {
  const settings = pageSettings().value;
  if (documentValue(pageSettings().info().project, "autosave.enabled") !== undefined) return settings;
  const host = hostPreferences().value.value?.autosave ?? false;
  return { ...settings, autosave: { ...settings.autosave, enabled: host } };
}

/** Offer the upgrade of a file of an older format, with the diff of its text; Upgrade saves it. */
function offerUpgrade(editor: ScenePageEditor, bar: SceneBar, diskText: string | null): void {
  const offer = upgradeOffer(diskText);
  if (offer === null || diskText === null || bar.noticeKind !== null) return;
  bar.notice({
    kind: "scene",
    spec: "confirm.formatUpgrade",
    title: t("scene-upgrade-title"),
    text: t("scene-upgrade-text", { from: offer.from, to: offer.to }),
    details: { label: t("scene-upgrade-changes"), lines: lineDiff(diskText, editor.file.baseText) },
    first: { label: t("scene-upgrade-save"), testId: "upgrade-format", run: () => void editor.save() },
    second: { label: t("scene-upgrade-later"), testId: "upgrade-later", run: () => bar.notice(null) },
  });
}

/** Offer the draft, and start the recovery of the host drafts, the autosave and the format upgrade of the page. */
export function startRecovery(
  editor: ScenePageEditor,
  storage: HostDraftStorage,
  bar: SceneBar,
  diskText: string | null,
): void {
  editor.offerDraft();
  void storage.ready.then((newer) => {
    if (newer && !editor.dirty) editor.offerDraft();
    // The offer of a draft comes first: the upgrade waits for the next open.
    offerUpgrade(editor, bar, diskText);
  });
  startAutosave({
    listen: (listener) => editor.listen(() => listener()),
    get dirty() {
      return editor.dirty;
    },
    playing: () => editor.play.active,
    save: () => editor.save(),
    settings: () => autosaveSettings(),
    listenSettings: (listener) => pageSettings().listen(() => listener()),
  });
}
