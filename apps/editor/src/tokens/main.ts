// SPDX-License-Identifier: Apache-2.0
/**
 * The token page of the studio (`tokens.html` of the scene dev server): each token of the studio with its CSS
 * variable, a sample in each theme variant and the result of its checks. A sample is in an element with the
 * `data-theme` and `data-contrast` of its variant, so it shows the CSS of that variant.
 */
import "./tokens.css";
import reference from "@scenity/tokens/reference.json";
import { t } from "../texts";
import { studioTokenRows, type TokenReference, type TokenRow } from "./tokenRows";

const data = reference as unknown as TokenReference;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The sample of one token in one variant. */
function sample(row: TokenRow, variant: TokenReference["variants"][number], value: string): HTMLTableCellElement {
  const cell = element("td");
  const box = element("div");
  box.dataset.theme = variant.theme;
  box.dataset.contrast = variant.contrast === "more" ? "more" : "standard";
  box.className = "token-sample";
  const mark = element("span");
  mark.className = row.kind === "colour" ? "token-swatch" : "token-bar";
  mark.style.setProperty(row.kind === "colour" ? "background" : "width", `var(${row.cssVar})`);
  box.append(mark, element("code", value));
  cell.append(box);
  return cell;
}

function header(): HTMLTableSectionElement {
  const head = element("thead");
  const line = element("tr");
  line.append(element("th", t("tokens-name")), element("th", t("tokens-checks")));
  for (const variant of data.variants) line.append(element("th", variant.id));
  head.append(line);
  return head;
}

function render(root: HTMLElement): void {
  const rows = studioTokenRows(data);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const table = element("table");
  const body = element("tbody");
  for (const row of rows) {
    const line = element("tr");
    line.dataset.token = row.name;
    const name = element("td");
    name.append(element("code", row.name), element("br"), element("small", row.cssVar));
    const checks =
      row.checks === 0 ? t("tokens-no-checks") : t("tokens-check-result", { checks: row.checks, failed: row.failed });
    line.append(name, element("td", checks));
    data.variants.forEach((variant, index) => line.append(sample(row, variant, row.values[index] ?? "")));
    body.append(line);
  }
  table.append(header(), body);
  root.append(
    element("h1", t("tokens-title")),
    element("p", t("tokens-summary", { tokens: rows.length, failed })),
    table,
  );
}

document.title = t("tokens-title");
const root = document.getElementById("tokens");
if (root !== null) render(root);
