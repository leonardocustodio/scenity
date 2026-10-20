// SPDX-License-Identifier: Apache-2.0
/**
 * The variants of the editor window: the panel `variants` over the override layers of the
 * open scene (pageVariants.ts).
 */
import { VIEW_PREVIEW } from "@scenity/runtime-dev/document/cameraPreview";
import { variantNames } from "@scenity/scene";
import { computed, shallowRef } from "vue";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { StudioShell } from "../../studio/shell/shell";
import type { ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import type { ViewportPort } from "../viewport/viewportTypes";
import { PageVariants } from "./pageVariants";
import VariantsPanel from "./VariantsPanel.vue";

/** What the variants read of the page. */
export interface VariantsStartParts {
  readonly shell: Pick<StudioShell, "setPanel">;
  readonly editor: ScenePageEditor;
  readonly files: SceneFilePort;
  readonly registry: ComponentRegistry;
  readonly viewport?: ViewportPort | undefined;
  patch(ops: readonly SceneOp[]): Promise<unknown>;
}

/** The width of a picture of the compare wipe (pixels). */
const PICTURE_WIDTH = 640;

/** Start the Variants panel. */
export function startVariants(parts: VariantsStartParts): PageVariants {
  const { editor } = parts;
  const variants = new PageVariants(parts);
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  // The names follow each edit of the scene (an edit of `variants`).
  const names = computed(() => variantNames(doc.value));
  parts.shell.setPanel("variants", {
    component: VariantsPanel,
    props: {
      variants,
      names,
      picture: async (name: string) => {
        await variants.show(name);
        await globalThis.__scenity?.frame();
        return parts.viewport?.previewCamera(VIEW_PREVIEW, PICTURE_WIDTH) ?? null;
      },
    },
  });
  return variants;
}
