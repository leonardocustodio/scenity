// SPDX-License-Identifier: Apache-2.0
/**
 * The camera bookmarks of the lab. A bookmark list is a quick list of named views in the URL parameter `views`
 * (`views=bay:x,y,z,tx,ty,tz,fov;top2:…`). The owner can then save one view into the source with `camera.save`. A
 * bookmark is a view option of the lab. The frame key and the frame index read the camera of a frame (`camera`,
 * `view`), never the bookmarks.
 *
 * No Vue import: the tests read it.
 */
import { parseView, viewText, type NamedView } from "../cameras";
import { cameraNameProblem } from "../cameraNames";

/** The URL parameter of the bookmarks. */
export const BOOKMARKS_PARAM = "views";
/** The maximum number of bookmarks in the URL. When the list is full, the oldest bookmark goes first. */
export const BOOKMARKS_MAX = 12;

export interface CameraBookmark {
  readonly name: string;
  readonly view: NamedView;
}

/** The bookmarks of the URL text. The function ignores a part that is not `name:view`. */
export function parseBookmarks(text: string | null): CameraBookmark[] {
  const out: CameraBookmark[] = [];
  for (const part of (text ?? "").split(";")) {
    const colon = part.indexOf(":");
    const name = part.slice(0, colon);
    const view = colon > 0 ? parseView(part.slice(colon + 1)) : null;
    if (view !== null && cameraNameProblem(name) === null && !out.some((item) => item.name === name)) {
      out.push({ name, view });
    }
  }
  return out.slice(-BOOKMARKS_MAX);
}

/** The URL text of the bookmarks (an empty text for none). */
export function bookmarksText(list: readonly CameraBookmark[]): string {
  return list.map((item) => `${item.name}:${viewText(item.view)}`).join(";");
}

/**
 * The list with a new bookmark at the end. A bookmark of the same name goes out. The list keeps at most BOOKMARKS_MAX
 * bookmarks.
 */
export function withBookmark(list: readonly CameraBookmark[], name: string, view: NamedView): CameraBookmark[] {
  // The view as the URL keeps it (two decimals), so a reload gives the same view.
  const kept = parseView(viewText(view)) ?? view;
  return [...list.filter((item) => item.name !== name), { name, view: kept }].slice(-BOOKMARKS_MAX);
}
