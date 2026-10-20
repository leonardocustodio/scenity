# @scenity/ui

The design system of Scenity: the Reka UI primitives, the shadcn-vue
components, the accessibility parts and the styles. It imports only `@scenity/tokens` and `@scenity/i18n`: no
contract and no domain module (ESLint `NO_DOMAIN`). The domain components are in the plugins.

## File map

| To change                                                      | Edit                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A primitive (Button, Dialog, Select, Tabs, …)                  | `src/primitives/*.vue`; the cva variants in `src/primitives/variants.ts` |
| A shadcn-vue component (`@scenity/ui/components/<name>`)       | `src/components/ui/<name>/`; `scripts/adapt-shadcn.ts` adapts new ones   |
| The announcer, the live regions, focus, reduced motion         | `src/a11y/`                                                              |
| The helpers `cn`, `initials`, the portal target                | `src/lib/`                                                               |
| The texts of the components (namespace `ui`)                   | `src/i18n/en-US.ftl`, `src/i18n/pt-BR.ftl`                               |
| The base styles, the focus ring, forced colors, reduced motion | `src/styles/index.css` (classes `.sc-*`), `src/styles/shadcn.css`        |
| The rule against raw colors and pixel sizes                    | `eslint/no-raw-design-values.js`                                         |

## Use

```css
@import "tailwindcss";
@import "@scenity/ui/styles.css";
```

The app gives `UI_RESOURCES` to `createI18n()` of `@scenity/i18n` with its own resources.

## Tests

`(cd packages/ui && bunx --bun vitest run)` for the component tests and `bun test ./packages/ui` for the Bun tests.
