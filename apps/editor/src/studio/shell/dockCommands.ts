// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the dock and the workspaces. The Window menu, the Layout menu, the workspace tabs and the rails run
 * them by ID from one list. The page also puts the list into its key map and its command registry. Thus a menu item,
 * a key and a run of an agent run the same function.
 */
import type { ArgSpec } from "@scenity/editor-core";
import type { WindowNotices } from "./dialogs";
import type { Dock } from "./dock";
import type { PanelArea, PanelRegistry } from "./panels";

/** A command of the shell (the page key map takes it as it is: settings/pageKeys.ts `PageKeyCommandSpec`). */
export interface ShellCommandSpec {
  readonly id: string;
  readonly title: string;
  readonly keys?: readonly string[];
  readonly description?: string;
  readonly icon?: string;
  readonly menu?: string;
  readonly args?: Readonly<Record<string, ArgSpec>>;
  /** True when a script or an agent can also run the command. */
  readonly agents?: boolean;
  /** Null when the command can run, else the reason. */
  when?(): string | null;
  run(args: Readonly<Record<string, unknown>>): unknown;
}

type Translate = (id: string, args?: Record<string, string | number>) => string;

export interface ShellCommandParts {
  readonly dock: Dock;
  readonly registry: PanelRegistry;
  readonly notices: WindowNotices;
  readonly t: Translate;
}

const AREAS: readonly Exclude<PanelArea, "floating">[] = ["left", "centre", "right", "bottom"];

/** The commands of the panels: open each panel, and act on the active panel. */
function panelCommands({ dock, registry, t }: ShellCommandParts): ShellCommandSpec[] {
  const active = (): string | null => dock.api.activePanel?.id ?? null;
  const open = registry.list().map((spec) => ({
    id: `panel.open.${spec.id}`,
    title: t("panel-open", { title: t(spec.title) }),
    ...(spec.keys === undefined ? {} : { keys: spec.keys }),
    ...(spec.menu === undefined ? {} : { menu: spec.menu }),
    agents: true,
    when: () => (registry.available(spec.id) ? null : t("panel-unknown")),
    run: () => dock.open(spec.id),
  }));
  const moves = AREAS.map((area) => ({
    id: `panel.move.${area}`,
    title: t(`window-move-${area}`),
    when: () => (active() === null ? t("panel-none") : null),
    run: () => {
      const id = active();
      if (id !== null) dock.moveTo(id, area);
    },
  }));
  return [
    ...open,
    { id: "panel.maximize", title: t("window-maximize"), keys: ["Shift+Space"], run: () => dock.toggleMaximize() },
    { id: "panel.next", title: t("window-next"), keys: ["Mod+Tab", "F6"], run: () => dock.next() },
    {
      id: "panel.previous",
      title: t("window-previous"),
      keys: ["Mod+Shift+Tab", "Shift+F6"],
      run: () => dock.next(-1),
    },
    { id: "panel.float", title: t("window-float"), run: () => dock.toggleFloat() },
    {
      id: "panel.copy",
      title: t("window-copy"),
      when: () => {
        const id = active();
        return id !== null && registry.get(id)?.many === true ? null : t("panel-no-copy");
      },
      run: () => {
        const id = active();
        if (id !== null) dock.openCopy(id);
      },
    },
    ...moves,
    { id: "panel.close", title: t("window-close"), run: () => dock.close() },
  ];
}

/** Ask for the name of a workspace. The result is null when the person cancels. */
async function askName(notices: WindowNotices, t: Translate, title: string, value: string): Promise<string | null> {
  const answer = await notices.ask({
    spec: "prompt.workspaceName",
    title,
    text: "",
    input: { label: t("layout-name"), testId: "layout-name", value },
    actions: [
      { id: "save", label: t("layout-name-save"), testId: "layout-name-save", tone: "primary", needsText: true },
      { id: "cancel", label: t("layout-cancel") },
    ],
    dismiss: "cancel",
  });
  const name = answer?.action === "save" ? answer.text.trim() : "";
  return name === "" ? null : name;
}

/** The commands of the workspaces: show one, save the layout as one, rename, delete, reset. */
function workspaceCommands({ dock, notices, t }: ShellCommandParts): ShellCommandSpec[] {
  const workspaces = dock.workspaces;
  const custom = (): string | null =>
    workspaces.list().some((entry) => entry.id === workspaces.active() && entry.custom) ? null : t("layout-not-custom");
  const name = (args: Readonly<Record<string, unknown>>): string | null =>
    typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : null;
  const NAME: ArgSpec = {
    type: "string",
    description: t("workspace-arg-name"),
    optional: true,
  };
  return [
    {
      id: "workspace.switch",
      title: t("workspace-switch"),
      agents: true,
      args: { workspace: { type: "string", description: t("workspace-arg-id") } },
      run: (args) => dock.switchTo(String(args.workspace)),
    },
    {
      id: "layout.saveAs",
      title: t("layout-save-as"),
      args: { name: NAME },
      run: async (args) => {
        const given = name(args) ?? (await askName(notices, t, t("layout-save-title"), ""));
        if (given !== null) dock.saveAs(given);
      },
    },
    {
      id: "layout.rename",
      title: t("layout-rename"),
      args: { name: NAME },
      when: custom,
      run: async (args) => {
        const id = workspaces.active();
        const label = workspaces.list().find((entry) => entry.id === id)?.name ?? "";
        const given = name(args) ?? (await askName(notices, t, t("layout-rename-title"), label));
        if (given !== null) workspaces.rename(id, given);
      },
    },
    {
      id: "layout.delete",
      title: t("layout-delete"),
      when: custom,
      run: () => dock.removeWorkspace(workspaces.active()),
    },
    { id: "layout.reset", title: t("window-reset"), agents: true, run: () => dock.reset() },
  ];
}

/** The commands of the shell. */
export function shellCommands(parts: ShellCommandParts): ShellCommandSpec[] {
  return [...panelCommands(parts), ...workspaceCommands(parts)];
}

/** Run a command of a list by its ID (a menu item, a tab). Do nothing when it cannot run. */
export function runShellCommand(
  specs: readonly ShellCommandSpec[],
  id: string,
  args: Readonly<Record<string, unknown>> = {},
): void {
  const spec = specs.find((item) => item.id === id);
  if (spec === undefined || (spec.when?.() ?? null) !== null) return;
  void spec.run(args);
}
