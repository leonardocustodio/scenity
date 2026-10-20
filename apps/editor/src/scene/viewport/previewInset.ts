// SPDX-License-Identifier: Apache-2.0
/**
 * The camera preview of the scene page: a small inset in the bottom right corner of the free canvas area. It shows
 * the view of the selected document camera. The dev core draws that view and takes a picture during a frame
 * (`previewCamera`), so the canvas never shows it. The inset asks for a new picture after each change of the selection
 * or of the document. It also asks each second while it shows, because a sequence can move the camera. The inset is
 * HTML, so it is not in a capture or a frame key. The caption is a Fluent message of `src/i18n/en-US/viewport.ftl`.
 */
import { t } from "../../texts";
import { placePart } from "../pageParts";

/** The width of a preview picture (pixels). */
export const PREVIEW_WIDTH = 320;
/** The longest time between two pictures while the inset shows (ms), and the shortest time (ms). */
const REFRESH_MS = 1000;
const MIN_GAP_MS = 150;

export class PreviewInset {
  readonly root = document.createElement("figure");
  readonly #canvas = document.createElement("canvas");
  readonly #caption = document.createElement("figcaption");
  #camera: string | null = null;
  #pictures = 0;
  #busy = false;
  #again = false;
  #last = 0;

  constructor(private readonly take: (camera: string, width: number) => Promise<ImageBitmap | null>) {
    this.root.id = "scene-camera-preview";
    this.root.dataset.testid = "scene-camera-preview";
    this.root.hidden = true;
    this.#canvas.dataset.testid = "scene-camera-preview-canvas";
    this.root.append(this.#canvas, this.#caption);
    placePart(this.root, "view");
    setInterval(() => {
      if (this.#camera !== null && performance.now() - this.#last >= REFRESH_MS) this.refresh();
    }, REFRESH_MS / 2);
  }

  /** The document camera of the preview, or null when it does not show. */
  get camera(): string | null {
    return this.#camera;
  }

  /** The count of the pictures that the inset showed. */
  get pictures(): number {
    return this.#pictures;
  }

  /**
   * Show the view of a document camera with its label, or hide the inset (null). The label is the name of the camera
   * entity, else its ID. A new label of the same camera (a rename) changes only the caption.
   */
  show(camera: string | null, label: string): void {
    const caption = camera === null ? "" : t("viewport-preview", { label });
    if (caption !== this.#caption.textContent) this.#caption.textContent = caption;
    if (camera === this.#camera) return;
    this.#camera = camera;
    this.root.hidden = camera === null;
    if (camera !== null) this.refresh();
  }

  /** Ask for a new picture, one at a time. A request during a picture asks again after that picture. */
  refresh(): void {
    if (this.#camera === null) return;
    if (this.#busy) {
      this.#again = true;
      return;
    }
    this.#busy = true;
    const camera = this.#camera;
    const wait = Math.max(0, MIN_GAP_MS - (performance.now() - this.#last));
    setTimeout(() => {
      void this.take(camera, PREVIEW_WIDTH)
        .then((picture) => {
          this.#draw(camera, picture);
        })
        .finally(() => {
          this.#busy = false;
          this.#last = performance.now();
          if (this.#again) {
            this.#again = false;
            this.refresh();
          }
        });
    }, wait);
  }

  #draw(camera: string, picture: ImageBitmap | null): void {
    if (picture === null) return;
    if (camera === this.#camera) {
      this.#canvas.width = picture.width;
      this.#canvas.height = picture.height;
      this.#canvas.getContext("2d")?.drawImage(picture, 0, 0);
      this.#pictures += 1;
      this.root.dataset.pictures = String(this.#pictures);
    }
    picture.close();
  }
}
