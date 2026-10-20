// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of the host faces of the plugins as commands of the editor window. Each tool is a command `tool.<name>` of
 * the search box. A run asks for each field of the input schema of the tool (a form from the schema). Then it runs the
 * tool on the studio host (`/api/agent/tools/run`) and shows its text in a toast and the Console.
 */
import { csrfValue } from "../../hub/studioApi";
import type { WindowNotices } from "../../studio/shell/dialogs";
import { t } from "../../texts";
import { pageConsole } from "../console/consoleStore";
import { pageKeys } from "../settings/pageKeys";
import { askParams } from "./recipes";

/** A tool as the host lists it. */
interface ToolListing {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly properties?: Readonly<Record<string, { readonly type?: unknown; readonly description?: unknown }>>;
  };
}

/** The command ID of a tool: `demo_spin_time` → `tool.demoSpinTime`. */
export const toolCommandId = (name: string): string =>
  `tool.${name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())}`;

/** The input of a tool from the texts of the form: a number field takes a number, a boolean field takes "true". */
export function toolInput(tool: ToolListing, values: Readonly<Record<string, string>>): Record<string, unknown> {
  const fields = tool.inputSchema.properties ?? {};
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== "")
      .map(([name, value]) => {
        const type = fields[name]?.type;
        return [
          name,
          type === "number" || type === "integer" ? Number(value) : type === "boolean" ? value === "true" : value,
        ];
      }),
  );
}

/** Register a command for each tool of the plugins of the project. The returned function removes the commands. */
export async function startPluginToolCommands(
  project: string,
  notices: Pick<WindowNotices, "ask" | "toast">,
): Promise<() => void> {
  const headers = { "x-studio-csrf": csrfValue() };
  const answer = await fetch(`/api/agent/tools?project=${encodeURIComponent(project)}`, { headers }).catch(() => null);
  if (answer?.ok !== true) return () => undefined;
  const { tools } = (await answer.json()) as { tools: ToolListing[] };
  const run = async (tool: ToolListing): Promise<void> => {
    const params = Object.entries(tool.inputSchema.properties ?? {}).map(([name, field]) => ({
      name,
      label: typeof field.description === "string" ? field.description : name,
    }));
    const values = await askParams(notices, { id: tool.name, title: tool.name, prompt: "", params, source: "plugin" });
    if (values === null) return;
    const result = await fetch("/api/agent/tools/run", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ project, name: tool.name, input: toolInput(tool, values) }),
    })
      .then(
        (response) => response.json() as Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>,
      )
      .catch((error: unknown) => ({ content: [{ type: "text", text: String(error) }], isError: true }));
    const text = (result.content ?? [])
      .flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
      .join("\n");
    notices.toast(t("plugin-tool-result", { name: tool.name }), text, result.isError === true ? "alert" : "status");
    pageConsole().add({
      level: result.isError === true ? "error" : "info",
      source: "plugin",
      text: t("plugin-tool-result", { name: tool.name }),
      detail: text,
    });
  };
  return pageKeys().register(
    tools.map((tool) => ({
      id: toolCommandId(tool.name),
      title: t("plugin-tool", { name: tool.name }),
      description: tool.description,
      category: "plugin",
      run: () => run(tool),
    })),
  );
}
