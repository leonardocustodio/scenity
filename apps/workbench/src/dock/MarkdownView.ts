// SPDX-License-Identifier: Apache-2.0
/**
 * The view of a Markdown tree: Vue nodes from `parseMarkdown`, never HTML text. An image of the folder loads through
 * the run file route (`image` gives its object URL). A web link opens in a new tab. Any other link shows as its path.
 */
import { defineComponent, h, type PropType, type VNode } from "vue";
import type { Block, Inline } from "./markdown";

function inline(nodes: readonly Inline[], image: (src: string) => string | null): (VNode | string)[] {
  return nodes.map((node) => {
    switch (node.t) {
      case "text":
        return node.v;
      case "code":
        return h("code", { class: "font-mono rounded-control bg-surface-sunken px-1" }, node.v);
      case "strong":
        return h("strong", inline(node.c, image));
      case "em":
        return h("em", inline(node.c, image));
      case "link":
        return /^https?:\/\//.test(node.href)
          ? h(
              "a",
              { href: node.href, target: "_blank", rel: "noopener noreferrer", class: "text-text-link underline" },
              inline(node.c, image),
            )
          : h("span", { title: node.href, class: "text-text-link" }, inline(node.c, image));
      case "image": {
        const url = /^https?:\/\//.test(node.src) ? null : image(node.src);
        return url === null
          ? h("span", { class: "text-text-secondary" }, `[${node.alt || node.src}]`)
          : h("img", { src: url, alt: node.alt, class: "my-1 max-h-72 max-w-full rounded-control object-contain" });
      }
    }
  });
}

const HEADINGS = ["text-title", "text-subtitle", "text-label", "text-label", "text-label", "text-label"];

function block(node: Block, image: (src: string) => string | null): VNode {
  switch (node.t) {
    case "heading":
      return h(
        `h${String(node.level)}`,
        { class: `${HEADINGS[node.level - 1] ?? "text-label"} mt-2` },
        inline(node.c, image),
      );
    case "paragraph":
      return h("p", inline(node.c, image));
    case "list":
      return h(
        node.ordered ? "ol" : "ul",
        { class: node.ordered ? "list-decimal pl-5" : "list-disc pl-5" },
        node.items.map((item) => h("li", inline(item, image))),
      );
    case "table":
      return h("div", { class: "overflow-x-auto" }, [
        h("table", { class: "border-collapse text-caption" }, [
          h(
            "thead",
            h(
              "tr",
              node.head.map((cell) =>
                h("th", { class: "border border-border-subtle px-2 py-1 text-left" }, inline(cell, image)),
              ),
            ),
          ),
          h(
            "tbody",
            node.rows.map((row) =>
              h(
                "tr",
                row.map((cell) =>
                  h("td", { class: "border border-border-subtle px-2 py-1 align-top" }, inline(cell, image)),
                ),
              ),
            ),
          ),
        ]),
      ]);
    case "code":
      return h(
        "pre",
        { class: "overflow-x-auto rounded-control bg-surface-sunken p-2 font-mono text-caption" },
        node.v,
      );
    case "rule":
      return h("hr", { class: "border-border-subtle" });
  }
}

export default defineComponent({
  name: "MarkdownView",
  props: {
    blocks: { type: Array as PropType<readonly Block[]>, required: true },
    /** The object URL of an image of the folder, or null while it loads. */
    image: { type: Function as PropType<(src: string) => string | null>, required: true },
  },
  setup(props) {
    return () =>
      h(
        "div",
        { class: "flex flex-col gap-2 text-body", "data-testid": "markdown" },
        props.blocks.map((node) => block(node, props.image)),
      );
  },
});
