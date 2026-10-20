# @scenity/i18n

The UI text of Scenity: the Fluent runtime (`createI18n`, `useI18n`), the locales and
their negotiation, the pseudo-locale `en-XA`, the collection of `.ftl` resources and the Intl formatters. It imports no
contract: the registry of the contract enums is in the plugin.

## Fluent resources

Each package keeps one file per locale next to its code: `i18n/<locale>.ftl`, or `i18n/<locale>/<namespace>.ftl`.
The app collects the files with `import.meta.glob` and `collectResources()`; the path gives the locale and the
namespace (`resourcePath()`). `addResources()` ignores a resource with the locale and the namespace of a resource that
the runtime has already. `useIsolating: false` removes the Unicode isolation marks around the placeables. The editor
sets it because its texts hold file paths and IDs.

## File map

| To change                             | Edit               |
| ------------------------------------- | ------------------ |
| The locales and the negotiation       | `src/locales.ts`   |
| The resources and their namespaces    | `src/resources.ts` |
| The runtime and the fallback chain    | `src/runtime.ts`   |
| The pseudo-locale                     | `src/pseudo.ts`    |
| The number, date and duration formats | `src/format.ts`    |

## Tests

`bun test ./packages/i18n` from the repo root. The pseudo-locale test reads the engine texts (`packages/ui` and each
en-US file of the editor); a plugin tests its own texts.
