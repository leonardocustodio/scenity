// SPDX-License-Identifier: Apache-2.0
import { describe, expect, spyOn, test } from "bun:test";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n, formatDurationMs, useI18n, type FtlResource } from "../src/index";

const RESOURCES: FtlResource[] = [
  {
    locale: "en-US",
    namespace: "test",
    source: [
      "test-hello = Hello, { $name }!",
      "test-only-english = Only in English",
      "test-items = { $count ->",
      "    [one] { $count } item",
      "   *[other] { $count } items",
      "}",
      "test-wait = Wait { DURATION($ms, fractionDigits: 1) }.",
      "test-button = Close",
      "    .aria-label = Close the panel",
      "",
    ].join("\n"),
  },
  {
    locale: "pt-BR",
    namespace: "test",
    source: [
      "test-hello = Olá, { $name }!",
      "test-items = { $count ->",
      "    [one] { $count } item",
      "   *[other] { $count } itens",
      "}",
      "test-wait = Aguarde { DURATION($ms, fractionDigits: 1) }.",
      "test-button = Fechar",
      "    .aria-label = Fechar o painel",
      "",
    ].join("\n"),
  },
];

/** Remove the Unicode isolation marks that Fluent puts around placeables. */
function plain(text: string): string {
  return text.replace(/[⁨⁩]/g, "");
}

describe("createI18n", () => {
  test("formats messages with variables, plurals and the DURATION function", () => {
    const i18n = createI18n({ locale: "en-US", resources: RESOURCES });
    expect(plain(i18n.format("test-hello", { name: "Ana" }))).toBe("Hello, Ana!");
    expect(plain(i18n.format("test-items", { count: 1 }))).toBe("1 item");
    expect(plain(i18n.format("test-items", { count: 3 }))).toBe("3 items");
    expect(plain(i18n.format("test-wait", { ms: 2_800 }))).toBe("Wait 2.8 sec.");
  });

  test("switches the locale and keeps the locale ref in step", () => {
    const i18n = createI18n({ locale: "en-US", resources: RESOURCES });
    i18n.setLocale("pt-BR");
    expect(i18n.locale.value).toBe("pt-BR");
    expect(plain(i18n.format("test-hello", { name: "Ana" }))).toBe("Olá, Ana!");
    // The unit word comes from the CLDR data of the runtime ("seg" or "s"), so compare with formatDurationMs.
    expect(plain(i18n.format("test-wait", { ms: 2_800 }))).toBe(
      `Aguarde ${formatDurationMs(2_800, "pt-BR", { fractionDigits: 1 })}.`,
    );
    i18n.locale.value = "en-US";
    expect(plain(i18n.format("test-hello", { name: "Ana" }))).toBe("Hello, Ana!");
  });

  test("puts isolation marks around placeables unless useIsolating is false", () => {
    expect(createI18n({ locale: "en-US", resources: RESOURCES }).format("test-hello", { name: "Ana" })).toBe(
      "Hello, ⁨Ana⁩!",
    );
    const flat = createI18n({ locale: "pt-BR", resources: RESOURCES, useIsolating: false });
    expect(flat.format("test-hello", { name: "Ana" })).toBe("Olá, Ana!");
    expect(flat.format("test-only-english")).toBe("Only in English");
  });

  test("rejects a locale that does not ship", () => {
    const i18n = createI18n({ locale: "en-US", resources: RESOURCES });
    expect(() => {
      i18n.setLocale("es-ES" as "en-US");
    }).toThrow(RangeError);
  });

  test("falls back to en-US and reports the missing message once", () => {
    const missing: [string, string][] = [];
    const i18n = createI18n({
      locale: "pt-BR",
      resources: RESOURCES,
      onMissing: (id, locale) => missing.push([id, locale]),
    });
    expect(i18n.format("test-only-english")).toBe("Only in English");
    expect(i18n.format("test-only-english")).toBe("Only in English");
    expect(missing).toEqual([["test-only-english", "pt-BR"]]);
  });

  test("marks fallback text when markFallback is set", () => {
    const i18n = createI18n({ locale: "pt-BR", resources: RESOURCES, markFallback: true, onMissing: () => undefined });
    expect(i18n.format("test-only-english")).toBe("⟦Only in English⟧");
    expect(plain(i18n.format("test-hello", { name: "Ana" }))).toBe("Olá, Ana!");
  });

  test("returns the ID of a message that no locale has, and reports each locale", () => {
    const missing: [string, string][] = [];
    const i18n = createI18n({
      locale: "pt-BR",
      resources: RESOURCES,
      onMissing: (id, locale) => missing.push([id, locale]),
    });
    expect(i18n.format("test-nowhere")).toBe("test-nowhere");
    expect(missing).toEqual([
      ["test-nowhere", "pt-BR"],
      ["test-nowhere", "en-US"],
    ]);
  });

  test("warns on the console without onMissing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const i18n = createI18n({ locale: "en-US", resources: RESOURCES });
    i18n.format("test-nowhere");
    expect(warn).toHaveBeenCalledWith('[i18n] no message "test-nowhere" in en-US');
    warn.mockRestore();
  });

  test("builds the pseudo-locale from en-US", () => {
    const i18n = createI18n({ locale: "en-XA", resources: RESOURCES });
    expect(plain(i18n.format("test-hello", { name: "Ana" }))).toBe("[Ħḗḗŀŀǿǿ, Ana!]");
    expect(plain(i18n.format("test-items", { count: 2 }))).toBe("[2 īīŧḗḗḿş]");
  });

  test("turns other argument types into Fluent variables", () => {
    const i18n = createI18n({ locale: "en-US", resources: RESOURCES });
    expect(plain(i18n.format("test-hello", { name: true }))).toBe("Hello, true!");
    expect(plain(i18n.format("test-items", { count: 2n }))).toBe("2 items");
  });
});

describe("the Vue plugin", () => {
  // One component reads texts through useI18n() in setup and through the global $t in render.
  const Probe = defineComponent({
    setup() {
      const { $t, $ta } = useI18n();
      return {
        greeting: () => $t("test-hello", { name: "Ana" }),
        label: () => $ta("test-button")["aria-label"],
      };
    },
    render() {
      return h("div", [
        h("button", { "aria-label": this.label() }, this.greeting()),
        h("p", this.$t("test-items", { count: 2 })),
      ]);
    },
  });

  test("serves $t and $ta to components through useI18n() and the global $t", async () => {
    const i18n = createI18n({ locale: "pt-BR", resources: RESOURCES });
    const html = await renderToString(createSSRApp(Probe).use(i18n.plugin));
    expect(plain(html)).toBe('<div><button aria-label="Fechar o painel">Olá, Ana!</button><p>2 itens</p></div>');
  });

  test("renders the texts of the selected locale", async () => {
    const i18n = createI18n({ locale: "pt-BR", resources: RESOURCES });
    i18n.setLocale("en-US");
    const html = await renderToString(createSSRApp(Probe).use(i18n.plugin));
    expect(plain(html)).toBe('<div><button aria-label="Close the panel">Hello, Ana!</button><p>2 items</p></div>');
  });
});
