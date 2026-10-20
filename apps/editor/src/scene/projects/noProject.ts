// SPDX-License-Identifier: Apache-2.0
/**
 * The scene page with no project in its address. The page never picks a project by itself. On the studio host, it
 * goes to the Hub. On a plain dev server (`scenity dev`), it tells how to open a project.
 */
import { t } from "../../texts";

/** The answer of the page for `/health` (the parts of the page ask once). */
let served: Promise<boolean> | null = null;

/** True when the page comes from the studio host (its `/health` answer says so). */
export function servedByStudio(fetchHealth?: () => Promise<Response>): Promise<boolean> {
  if (fetchHealth !== undefined) return askHealth(fetchHealth);
  served ??= askHealth(() => fetch("/health"));
  return served;
}

async function askHealth(fetchHealth: () => Promise<Response>): Promise<boolean> {
  try {
    const answer = await fetchHealth();
    if (!answer.ok) return false;
    return ((await answer.json()) as { studio?: unknown }).studio === true;
  } catch {
    return false;
  }
}

/** Go to the Hub of the studio, or show the text that names the commands in the status line. */
export async function showNoProject(
  status: HTMLElement | null,
  go: (path: string) => void = (path) => location.replace(path),
): Promise<void> {
  if (await servedByStudio(() => fetch("/health"))) {
    go("/");
    return;
  }
  if (status !== null) {
    status.textContent = t("scene-no-project");
    status.dataset.state = "no-project";
  }
}
