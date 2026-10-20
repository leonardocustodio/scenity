// SPDX-License-Identifier: Apache-2.0
/**
 * ESLint rule "scenity/no-raw-design-values": components use design tokens only. The rule refuses raw colors (hex text
 * and color functions) and raw pixel sizes in string literals, template literals, Vue template attributes and
 * expressions, and the <style> blocks of a Vue file. Use a token utility (bg-surface-raised, p-4, text-body) or a
 * token variable (var(--sc-...)).
 */

const PATTERNS = [
  { re: /(^|[^\w&/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i, what: "a raw color" },
  { re: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i, what: "a raw color function" },
  { re: /(?<![\w.-])\d*\.?\d+px\b/, what: "a raw pixel size" },
];

function find(text) {
  for (const pattern of PATTERNS) if (pattern.re.test(text)) return pattern.what;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Refuse raw colors and raw pixel sizes in component code; use design tokens." },
    schema: [],
    messages: {
      raw: "{{what}} in component code. Use a design token (a token utility or var(--sc-…)).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const check = (node, text) => {
      if (typeof text !== "string") return;
      const what = find(text);
      if (what !== null) context.report({ node, messageId: "raw", data: { what } });
    };
    // A quasi that starts with "px" after an expression makes a pixel size, for example `${n}px`.
    const checkQuasi = (node) => {
      const text = node.value.cooked ?? node.value.raw;
      const parent = node.parent;
      const first = parent?.type === "TemplateLiteral" && parent.quasis[0] === node;
      if (!first && /^px\b/.test(text)) {
        context.report({ node, messageId: "raw", data: { what: "a raw pixel size" } });
        return;
      }
      check(node, text);
    };
    const scriptVisitor = {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        checkQuasi(node);
      },
      Program() {
        if (!context.filename.endsWith(".vue")) return;
        const text = sourceCode.text;
        for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
          const body = match[1] ?? "";
          for (const pattern of PATTERNS) {
            const hit = new RegExp(
              pattern.re.source,
              pattern.re.flags.includes("g") ? pattern.re.flags : `${pattern.re.flags}g`,
            ).exec(body);
            if (hit !== null) {
              const start = (match.index ?? 0) + match[0].indexOf(body) + hit.index;
              context.report({
                loc: {
                  start: sourceCode.getLocFromIndex(start),
                  end: sourceCode.getLocFromIndex(start + hit[0].length),
                },
                messageId: "raw",
                data: { what: pattern.what },
              });
              break;
            }
          }
        }
      },
    };
    const services = sourceCode.parserServices;
    if (services?.defineTemplateBodyVisitor === undefined) return scriptVisitor;
    return services.defineTemplateBodyVisitor(
      {
        VLiteral(node) {
          check(node, node.value);
        },
        Literal(node) {
          check(node, node.value);
        },
        TemplateElement(node) {
          checkQuasi(node);
        },
      },
      scriptVisitor,
    );
  },
};

export default { rules: { "no-raw-design-values": rule } };
