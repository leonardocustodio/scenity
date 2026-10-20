// SPDX-License-Identifier: Apache-2.0
/** The icon of a contribution of a plugin: an SVG file of the plugin as an image. */
import { defineComponent, h, markRaw, type Component } from "vue";

/** An icon component for the URL of an SVG file. */
export function pluginIcon(url: string): Component {
  return markRaw(
    defineComponent({
      name: "PluginIcon",
      props: { size: { type: [Number, String], default: 16 } },
      setup(props) {
        // The icon has no text of its own: the title of the panel names it.
        return () => h("img", { src: url, alt: "", width: props.size, height: props.size, "aria-hidden": "true" });
      },
    }),
  );
}
