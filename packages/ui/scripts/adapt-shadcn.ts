// SPDX-License-Identifier: Apache-2.0
/**
 * Adapt the shadcn-vue components that the CLI copies into src/components/ui to the rules of the ui package (see the
 * README of the package). Run `bunx shadcn-vue@latest add` in packages/ui. Then run this script from the repository
 * root:
 *
 *     bun packages/ui/scripts/adapt-shadcn.ts <name> [<name> …]
 *
 * The script changes the files of each named component folder. It is idempotent: a second run changes
 * nothing. It does these changes:
 *
 * - The imports of the aliases become relative imports, and the icons come from lucide-vue-next.
 * - The script removes the "dark:" classes, because the theme tokens give the colors of each theme.
 * - The script removes the focus ring classes of shadcn-vue, so the focus ring of the base styles shows. Menu and
 *   list items keep "outline-hidden": their highlight shows the focus.
 * - No line clamp: text with larger spacing (WCAG 1.4.12) wraps and is never cut.
 * - The colors that are not tokens (white, black) become tokens.
 * - A v-bind of forwarded props uses `forwardable` (exactOptionalPropertyTypes).
 * - A portal without a target gets the portal target of the package.
 *
 * The script does not translate fixed English labels and does not remove raw pixel sizes. ESLint
 * (scenity/no-raw-design-values) and the type check find them; change them by hand.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const UI = resolve(import.meta.dir, "..", "src", "components", "ui");

/** The focus ring classes of shadcn-vue. The base styles of the package draw the focus ring. */
const FOCUS_CLASS =
  /(?<=[\s'"`])(?:outline-none|outline-hidden|ring-sidebar-ring|ring-offset-background|focus-visible:ring-[^\s'"`]+|focus-visible:border-ring|focus-visible:outline-[^\s'"`]+|focus:ring-[^\s'"`]+|focus:outline-hidden|focus-visible:ring-offset-[^\s'"`]+)(?=[\s'"`])\s?/g;

/** A menu or list item shows the focus with its highlight, not with an outline. */
function isHighlightItem(source: string): boolean {
  return source.includes("focus:bg-accent") || source.includes("data-[highlighted]");
}

function withImport(source: string, name: string, from: string): string {
  // The CLI writes no semicolons, but Prettier writes them. An import can have more than one line.
  const existing = new RegExp(`import \\{([^}]*)\\} from "${from.replaceAll(".", "\\.")}";?`, "g");
  const matches = [...source.matchAll(existing)];
  for (const match of matches) {
    if ((match[1] ?? "").split(",").some((part) => part.trim() === name)) return source;
  }
  const first = matches[0];
  if (first !== undefined) {
    const names = new Set(
      (first[1] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    );
    names.add(name);
    return source.replace(first[0], `import { ${[...names].sort().join(", ")} } from "${from}";`);
  }
  const lines = source.split("\n");
  let last = -1;
  lines.forEach((line, index) => {
    if (line.startsWith("import ")) last = index;
  });
  lines.splice(last + 1, 0, `import { ${name} } from "${from}";`);
  return lines.join("\n");
}

/** Add a line at the end of the <script setup> block. */
function withSetupLine(source: string, line: string): string {
  if (source.includes(line)) return source;
  const start = source.indexOf("<script setup");
  const end = source.indexOf("</script>", start);
  if (start < 0 || end < 0) return source;
  return `${source.slice(0, end)}${line}\n${source.slice(end)}`;
}

export function adapt(file: string, source: string): string {
  let out = source;
  out = out.replace(/['"]@scenity\/ui\/lib\/utils['"]/g, '"../../../lib/utils"');
  out = out.replace(/['"]@scenity\/ui\/components\/ui\/([a-z-]+)\/(\w+\.vue)['"]/g, '"../$1/$2"');
  out = out.replace(/['"]@scenity\/ui\/components\/ui\/([a-z-]+)['"]/g, '"../$1"');
  out = out.replace(/['"]@scenity\/ui\/composables\/([\w-]+)['"]/g, '"../../../composables/$1"');
  out = out.replaceAll('"@lucide/vue"', '"lucide-vue-next"');
  out = out.replace(/(?<=[\s'"`])dark:[^\s'"`]+\s?/g, "");
  if (!isHighlightItem(out)) out = out.replace(FOCUS_CLASS, "");
  out = out.replace(/(?<=[\s'"`])line-clamp-\d+\s?/g, "");
  out = out.replaceAll("text-white", "text-text-on-accent").replace(/bg-black\/\d+/g, "bg-surface-scrim");
  out = out.replaceAll("hover:bg-primary/90", "hover:bg-accent-brand-hover");

  if (file.endsWith(".vue")) {
    // v-bind of forwarded props, not of slot props.
    out = out.replace(/v-bind="(forwarded|delegatedProps|forwardedProps|props)"/g, (_, name: string) => {
      return `v-bind="forwardable(${name})"`;
    });
    // Slot props stay as they are.
    out = out.replace(/<slot v-bind="forwardable\((\w+)\)"/g, '<slot v-bind="$1"');
    out = out.replace(
      /v-bind="\{ \.\.\.(forwarded|delegatedProps|forwardedProps|props), \.\.\.\$attrs \}"/g,
      (_, name: string) => {
        return `v-bind="{ ...forwardable(${name}), ...$attrs }"`;
      },
    );
    out = out.replace(
      /v-bind="\{ \.\.\.\$attrs, \.\.\.(forwarded|delegatedProps|forwardedProps|props) \}"/g,
      (_, name: string) => {
        return `v-bind="{ ...$attrs, ...forwardable(${name}) }"`;
      },
    );
    if (out.includes("forwardable(")) out = withImport(out, "forwardable", "../../../lib/utils");

    // A portal of Reka UI without a target goes to the portal target of the package.
    if (/<(\w+Portal)>/.test(out)) {
      out = out.replace(/<(\w+Portal)>/g, '<$1 :to="portal">');
      out = withImport(out, "usePortalTarget", "../../../lib/portal");
      out = withSetupLine(out, "const portal = usePortalTarget();");
    }
  }
  return out;
}

function main(names: readonly string[]): void {
  if (names.length === 0) {
    console.error("usage: bun packages/ui/scripts/adapt-shadcn.ts <component> [<component> …]");
    process.exit(2);
  }
  for (const name of names) {
    const folder = join(UI, name);
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      console.error(`adapt-shadcn: no folder ${folder}`);
      process.exit(1);
    }
    for (const entry of readdirSync(folder)) {
      if (!entry.endsWith(".vue") && !entry.endsWith(".ts")) continue;
      const path = join(folder, entry);
      const before = readFileSync(path, "utf8");
      const after = adapt(path, before);
      if (after !== before) {
        writeFileSync(path, after);
        console.log(`adapted ${name}/${entry}`);
      }
    }
  }
}

if (import.meta.main) main(process.argv.slice(2));
