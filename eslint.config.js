// SPDX-License-Identifier: Apache-2.0
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import vueA11y from "eslint-plugin-vuejs-accessibility";
import globals from "globals";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import tseslint from "typescript-eslint";
import scenityDesign from "./packages/ui/eslint/no-raw-design-values.js";

// Packages of layers L0-L3 must stay free of a UI framework.
const FRAMEWORK_FREE = ["packages/labs-platform"];

// The package names of the plugin parts of this workspace (plugins/<plugin>/<part>/package.json). The editor, the host
// and the design system import none of them.
function pluginPackages() {
  const root = new URL("./plugins/", import.meta.url);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((plugin) => plugin.isDirectory())
    .flatMap((plugin) =>
      readdirSync(new URL(`./${plugin.name}/`, root), { withFileTypes: true })
        .map((part) => new URL(`./${plugin.name}/${part.name}/package.json`, root))
        .filter((file) => existsSync(file))
        .map((file) => JSON.parse(readFileSync(file, "utf8")).name),
    )
    .sort();
}
const PLUGIN_IMPORTS = ["**/plugins/**", ...pluginPackages().flatMap((name) => [name, `${name}/**`])];

// The groups of the restricted imports. A later block replaces the "no-restricted-imports" of an earlier block for
// the same file, so each block lists all the groups that apply to its files.
const BROWSER_ONLY = { group: ["node:*", "bun", "bun:*"], message: "This code runs in the browser." };
const NO_FRAMEWORK = {
  group: ["vue", "vue/*", "react", "react/*", "pinia", "@pinia/*"],
  message: "Layers L0-L3 use no UI framework.",
};
// The labs of the 3D room: the packages, the app and the relative paths to them.
const NO_LABS = {
  group: [
    // The dev tools of the runtime and the dev parts of the plugins.
    "@scenity/*-dev",
    "@scenity/*-dev/**",
    "@scenity/editor",
    "@scenity/editor/**",
    "**/apps/editor",
    "**/apps/editor/**",
    "**/../editor",
    "**/../editor/**",
  ],
  message: "Only apps/editor uses the labs of the 3D room.",
};
// The entry points that only the labs use: the engine homes of the tune registry.
const NO_LABS_ENTRY = {
  group: ["@scenity/runtime/tuning", "@scenity/scene/tuning"],
  message: "The entry points /sdk and /tuning of the room are for the labs only.",
};
// The labs workbench: the page (apps/workbench) and the host (packages/workbench-host).
const NO_WORKBENCH = {
  group: [
    "@scenity/workbench",
    "@scenity/workbench/**",
    "@scenity/workbench-host",
    "@scenity/workbench-host/**",
    "**/apps/workbench",
    "**/apps/workbench/**",
    "**/../workbench",
    "**/../workbench/**",
    "**/workbench-host",
    "**/workbench-host/**",
  ],
  message: "Only apps/workbench uses the labs workbench.",
};
// The workbench page imports only the protocol of the host: no other entry point and no source file.
const WORKBENCH_PAGE = {
  regex: "^(?!@scenity/workbench-host/protocol$).*workbench-host",
  message: "The workbench page imports only @scenity/workbench-host/protocol from the host.",
};
// The host never imports the workbench page.
const NO_WORKBENCH_PAGE = {
  group: ["@scenity/workbench", "@scenity/workbench/**", "**/apps/workbench", "**/apps/workbench/**"],
  message: "The workbench host does not import the workbench page.",
};
// The engine packages have no barrel import in the runtime, the renderer and the characters. A barrel pulls more code
// into the worker.
const NO_ENGINE_BARREL = {
  regex: "^@scenity/(runtime|scene|render|character)$",
  message: "Import a subpath of the engine package, not its barrel: the worker size.",
};

// The editor app imports a plugin only in its registration module (apps/editor/src/plugins.ts). That module registers
// the generated list of the editor faces of the project. The core gets the parts of the plugin through
// `editorPlugin()`.
const EDITOR_PLUGIN_IMPORT = {
  group: PLUGIN_IMPORTS,
  message:
    "The editor imports no plugin: src/plugins.ts registers the generated list of the editor faces of the project; the core reads it through editorPlugin().",
};

// The workbench host imports no plugin. src/plugins.ts loads the host faces of the plugins of the project.
const NO_WORKBENCH_HOST = {
  group: ["@scenity/workbench-host", "@scenity/workbench-host/**", "**/workbench-host/**"],
  message: "The studio host does not import the workbench host; the workbench host imports the studio host.",
};
const HOST_PLUGIN_IMPORT = {
  group: PLUGIN_IMPORTS,
  message: "The host imports no plugin; src/plugins.ts loads the host faces of the plugins of the project.",
};

/** Make the rule "no-restricted-imports" from the given groups. */
const restrictImports = (...patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

// The runtime parts of the 3D room and its runtime users do not import the labs. The runtime, its users and the labs
// do not import the workbench. The workbench page imports only the protocol of the host.
// Each part gets two blocks: one for all its files and one for its browser code, which also keeps the earlier groups.
const LABS_BOUNDARIES = [
  { path: "packages/labs-platform", groups: [NO_LABS, NO_LABS_ENTRY, NO_WORKBENCH] },
  { path: "apps/editor", groups: [NO_WORKBENCH] },
  { path: "apps/workbench", groups: [WORKBENCH_PAGE] },
];

function labsBoundaryBlocks({ path, groups }) {
  const app = path.startsWith("apps/");
  const browser = [BROWSER_ONLY, ...(FRAMEWORK_FREE.includes(path) ? [NO_FRAMEWORK] : [])];
  return [
    { files: [`${path}/**/*.{ts,vue,js,mjs}`], rules: restrictImports(...groups) },
    {
      files: [app ? `${path}/src/**/*.{ts,vue}` : `${path}/src/**/*.ts`],
      rules: restrictImports(...browser, ...groups),
    },
  ];
}

// The layer rules of the engine packages (docs/architecture.md). `can` lists the workspace packages that a package can
// import. All other `@scenity/` packages and all plugins and samples are out of bounds. No engine package imports a
// plugin, and no player package imports dev code. `noBarrel`: the source imports no engine barrel.
const ENGINE_LAYERS = [
  { name: "scene", can: [], browser: true, frameworkFree: true },
  { name: "render", can: [], browser: true, frameworkFree: true, noBarrel: true },
  { name: "character", can: ["scene"], browser: true, frameworkFree: true, noBarrel: true },
  { name: "runtime", can: ["scene", "render", "character"], browser: true, frameworkFree: true, noBarrel: true },
  {
    name: "runtime-dev",
    can: ["scene", "render", "character", "runtime", "rules"],
    browser: true,
    frameworkFree: true,
  },
  // The metric library is pure. The dev tools make its context from a scene, and the CLI runs its rules.
  { name: "rules", can: ["scene", "character"], browser: true, frameworkFree: true },
  { name: "view-vue", can: ["scene", "runtime"], browser: true, frameworkFree: false },
  { name: "player", can: ["scene", "runtime", "view-vue"], browser: true, frameworkFree: false },
  { name: "editor-core", can: ["scene", "labs-platform"], browser: true, frameworkFree: true },
  { name: "bridge", can: [], browser: true, frameworkFree: true },
  { name: "assets", can: ["scene", "labs-platform"], browser: false, frameworkFree: true },
  { name: "cli", can: ["scene", "labs-platform", "assets", "bridge", "rules"], browser: false, frameworkFree: true },
];

// The entry `@scenity/cli/check` (packages/cli/src/check) measures the rules with the runtime and its dev
// tools. The other entries of the CLI (the command, the Vite plugin, the scene files) do not import them.
const CLI_CHECK = {
  name: "cli",
  can: ["scene", "labs-platform", "assets", "bridge", "rules", "runtime", "runtime-dev"],
};

/** The import group of a layer: every `@scenity/` package but the package itself and its `can` list. */
function layerGroup({ name, can }) {
  const allowed = [name, ...can].flatMap((item) => [`!@scenity/${item}`, `!@scenity/${item}/**`]);
  const list = can.map((item) => `@scenity/${item}`).join(", ");
  return {
    group: ["@scenity/*", "@scenity/*/**", ...allowed],
    message: `@scenity/${name} imports ${can.length === 0 ? "no workspace package" : `only ${list}`}.`,
  };
}

// No engine package reaches a plugin or a sample by a relative path out of its folder. A path out of a package folder
// has two or more "../" parts. `../plugins/` of `packages/runtime/src/core` is the plugin host of the runtime.
const NO_PLUGIN_PATH = {
  regex: "^(\\.\\./){2,}(plugins|samples)/",
  message: "No engine package imports a plugin or a sample.",
};

function engineLayerBlocks(layer) {
  const path = `packages/${layer.name}`;
  const group = layerGroup(layer);
  const source = [
    ...(layer.browser ? [BROWSER_ONLY] : []),
    ...(layer.frameworkFree ? [NO_FRAMEWORK] : []),
    // The code of the render workers imports subpaths only, because a barrel pulls more code into the worker.
    ...(layer.noBarrel === true ? [NO_ENGINE_BARREL] : []),
  ];
  return [
    { files: [`${path}/**/*.{ts,vue}`], rules: restrictImports(group, NO_PLUGIN_PATH) },
    { files: [`${path}/src/**/*.{ts,vue}`], rules: restrictImports(...source, group, NO_PLUGIN_PATH) },
    ...(layer.browser ? [] : [{ files: [`${path}/**/*.ts`], languageOptions: { globals: { ...globals.node } } }]),
  ];
}

// The design system: ui, tokens and i18n import no plugin and no domain module. The domain components and tokens of a
// plugin are parts of that plugin.
const DESIGN_SYSTEM = ["packages/ui", "packages/tokens", "packages/i18n"];
const NO_DOMAIN = {
  group: [...PLUGIN_IMPORTS, "**/domain/**"],
  message: "The design system imports no plugin, no contract and no domain module.",
};

function designSystemBlocks(path) {
  return [
    { files: [`${path}/**/*.{ts,vue,js}`], rules: restrictImports(NO_DOMAIN, NO_PLUGIN_PATH) },
    { files: [`${path}/src/**/*.ts`], rules: restrictImports(BROWSER_ONLY, NO_DOMAIN, NO_PLUGIN_PATH) },
  ];
}

// The code shape of the engine, the editor and the plugins: the line limits of a file and of a function, with the
// larger files as exceptions. `bun tools/shape.ts` shows them and finds stale entries. Each plugin adds its files and
// exceptions in plugins/<plugin>/shape-exceptions.json (paths from its folder).
function readShape() {
  const engine = JSON.parse(readFileSync(new URL("./tools/shape-exceptions.json", import.meta.url), "utf8"));
  const plugins = new URL("./plugins/", import.meta.url);
  const shape = { limits: engine.limits, files: [...engine.files], exceptions: [...engine.exceptions] };
  if (!existsSync(plugins)) return shape;
  for (const entry of readdirSync(plugins, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = new URL(`./${entry.name}/shape-exceptions.json`, plugins);
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const own = JSON.parse(readFileSync(file, "utf8"));
    const prefix = `plugins/${entry.name}/`;
    shape.files.push(...(own.files ?? []).map((path) => prefix + path));
    shape.exceptions.push(...(own.exceptions ?? []).map((item) => ({ ...item, path: prefix + item.path })));
  }
  return shape;
}
const ROOM3D_SHAPE = readShape();
const SHAPE_RULES = Object.fromEntries(
  Object.entries(ROOM3D_SHAPE.limits).map(([rule, max]) => [rule, ["error", max]]),
);
// The code shape of the labs workbench: the same limits for the source of the host, the page and the lab bridge, with
// no exceptions. This block comes after the exceptions of the 3D room.
const WORKBENCH_SHAPE_FILES = [
  "packages/workbench-host/src/**/*.ts",
  "packages/labs-platform/src/**/*.ts",
  "apps/workbench/src/**/*.{ts,vue}",
  "apps/editor/src/core/bridge/*.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/dist-*",
      "**/coverage",
      "**/node_modules",
      "**/test-results",
      "**/playwright-report",
      "**/generated",
      // The local state of the tools and the agents (imports, drafts, temp files). Git ignores it too.
      "**/.scenity",
    ],
  },
  {
    files: ["**/*.{ts,vue}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...vue.configs["flat/recommended"],
      ...vueA11y.configs["flat/recommended"],
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: false }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },
  {
    // Browser code must not use Node or Bun modules. Tests, tools and the mock engine run in Bun.
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.{ts,vue}"],
    rules: restrictImports(BROWSER_ONLY),
  },
  {
    files: FRAMEWORK_FREE.map((path) => `${path}/src/**/*.ts`),
    rules: restrictImports(BROWSER_ONLY, NO_FRAMEWORK),
  },
  // These blocks come after the two blocks above, so they replace them for the files of the runtime parts.
  ...LABS_BOUNDARIES.flatMap(labsBoundaryBlocks),
  {
    files: ["apps/editor/src/**/*.{ts,vue}"],
    rules: restrictImports(BROWSER_ONLY, NO_WORKBENCH, EDITOR_PLUGIN_IMPORT),
  },
  ...ENGINE_LAYERS.flatMap(engineLayerBlocks),
  {
    files: ["packages/cli/src/check/**/*.ts"],
    rules: restrictImports(NO_FRAMEWORK, layerGroup(CLI_CHECK), NO_PLUGIN_PATH),
  },
  ...DESIGN_SYSTEM.flatMap(designSystemBlocks),
  // The workbench host is a Bun program. It can import node: and bun:, so this block replaces the browser rule above.
  // Its protocol module is shared with the page and stays browser code.
  {
    files: ["packages/workbench-host/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: restrictImports(NO_FRAMEWORK, NO_WORKBENCH_PAGE),
  },
  {
    files: ["packages/workbench-host/src/**/*.ts"],
    rules: restrictImports(NO_FRAMEWORK, NO_WORKBENCH_PAGE, HOST_PLUGIN_IMPORT),
  },
  {
    files: ["packages/workbench-host/src/protocol.ts"],
    rules: restrictImports(BROWSER_ONLY, NO_FRAMEWORK, NO_WORKBENCH_PAGE, HOST_PLUGIN_IMPORT),
  },
  // The studio host is a Bun program too. It runs the editor app as a child process and imports none of it.
  {
    files: ["packages/studio-host/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: restrictImports(NO_FRAMEWORK, NO_WORKBENCH_PAGE, NO_WORKBENCH_HOST, NO_LABS, HOST_PLUGIN_IMPORT),
  },
  // The host face of a plugin runs in the workbench host (Bun).
  {
    files: ["plugins/*/host/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: restrictImports(NO_FRAMEWORK, NO_WORKBENCH_PAGE),
  },
  // The workbench end-to-end specs of a plugin use the test harness of the workbench page.
  { files: ["plugins/*/host/tests/e2e/**/*.ts"], rules: restrictImports(NO_FRAMEWORK) },
  {
    files: ["**/tests/**/*.ts", "tools/**/*.ts", "**/*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The shadcn-vue components (components.json) keep the names and the optional props of shadcn-vue, so a
    // new version of a component from the CLI stays easy to compare. A field and its label are separate
    // components: the page that uses them connects them (for, id, aria-labelledby).
    files: ["packages/ui/src/components/ui/**/*.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/require-default-prop": "off",
      "vuejs-accessibility/form-control-has-label": "off",
      "vuejs-accessibility/label-has-for": "off",
    },
  },
  {
    // Components use design tokens only: no raw colors and no raw pixel sizes.
    files: ["packages/ui/src/**/*.{ts,vue}", "plugins/*/editor/src/**/*.vue", "apps/*/src/**/*.vue"],
    plugins: { scenity: scenityDesign },
    rules: { "scenity/no-raw-design-values": "error" },
  },
  {
    files: ROOM3D_SHAPE.files,
    rules: SHAPE_RULES,
  },
  ...ROOM3D_SHAPE.exceptions.map((item) => ({ files: [item.path], rules: { [item.rule]: "off" } })),
  { files: WORKBENCH_SHAPE_FILES, rules: SHAPE_RULES },
  // The engine packages keep the limits of the code shape with no exceptions.
  { files: ENGINE_LAYERS.map((layer) => `packages/${layer.name}/src/**/*.{ts,vue}`), rules: SHAPE_RULES },
  prettier,
);
