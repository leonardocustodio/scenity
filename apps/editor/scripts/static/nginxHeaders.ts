// SPDX-License-Identifier: Apache-2.0
/**
 * Read the security headers of the web app from the nginx snippet. The snippet is the single source of the header
 * list: nginx includes it, and the Bun test server applies the same lines.
 * The snippet file is web-security-headers.conf in this folder.
 *
 * A line has the form `add_header Name "value" always;` or `add_header Name $variable always;`.
 * Variables (`$name`) take their value from the map; an unknown variable is empty. As in nginx, the
 * reader sends no header with an empty value, and it does not change the text in other ways. An empty variable
 * keeps its separators ("connect-src 'self' ;"), and the policy stays valid. As nginx does, the
 * reader removes the backslash of `\"`, `\'` and `\\` in a quoted value (the quoted URL of
 * Reporting-Endpoints).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A path, not `new URL(…, import.meta.url)`: Vite (and so Vitest) rewrites that form into an asset URL.
export const NGINX_HEADERS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "web-security-headers.conf");

const LINE = /^\s*add_header\s+([A-Za-z0-9-]+)\s+(?:"((?:[^"\\]|\\.)*)"|(\$[A-Za-z0-9_]+))(?:\s+always)?\s*;\s*$/;

/** Return the headers of the snippet text, in file order. */
export function parseNginxHeaders(
  text: string,
  variables: Readonly<Record<string, string>> = {},
): [name: string, value: string][] {
  const headers: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    if (line.trim() === "") {
      continue;
    }
    const match = LINE.exec(line);
    if (match === null) {
      throw new Error(`nginx headers: cannot read the line "${raw.trim()}"`);
    }
    const [, name = "", quoted, variable] = match;
    // nginx reads the escapes of a quoted value when it loads the file, before it adds the values of the variables.
    const template = quoted !== undefined ? quoted.replace(/\\(["'\\])/g, "$1") : (variable ?? "");
    // The same text as nginx sends: the values of the variables in it, and no outer spaces (HTTP removes them).
    const value = template.replace(/\$([A-Za-z0-9_]+)/g, (_, key: string) => variables[key] ?? "").trim();
    if (value !== "") {
      headers.push([name, value]);
    }
  }
  return headers;
}

/** Read the snippet file and return its headers. */
export function readNginxHeaders(variables: Readonly<Record<string, string>> = {}): [string, string][] {
  return parseNginxHeaders(readFileSync(NGINX_HEADERS_FILE, "utf8"), variables);
}

/** The Cache-Control rule of a path: the same rules as snippets/web-app.conf. */
export function cacheControlFor(pathname: string): string {
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (pathname.startsWith("/icons/")) {
    return "public, max-age=86400";
  }
  return "no-cache";
}
