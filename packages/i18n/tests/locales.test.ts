// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { collectResources, isDisplayLocale, isUiLocale, negotiateUiLocale, resourcePath } from "../src/index";

describe("negotiateUiLocale", () => {
  test("maps Portuguese tags to pt-BR and English tags to en-US", () => {
    expect(negotiateUiLocale(["pt-BR"])).toBe("pt-BR");
    expect(negotiateUiLocale(["pt"])).toBe("pt-BR");
    expect(negotiateUiLocale(["pt-PT"])).toBe("pt-BR");
    expect(negotiateUiLocale(["en-GB"])).toBe("en-US");
    expect(negotiateUiLocale(["en"])).toBe("en-US");
  });

  test("takes the first requested locale that matches", () => {
    expect(negotiateUiLocale(["es", "pt", "en"])).toBe("pt-BR");
    expect(negotiateUiLocale(["de", "en-AU", "pt-BR"])).toBe("en-US");
  });

  test("gives the fallback without a match, and ignores invalid tags", () => {
    expect(negotiateUiLocale([])).toBe("en-US");
    expect(negotiateUiLocale(["fr", "ja"])).toBe("en-US");
    expect(negotiateUiLocale(["fr"], "pt-BR")).toBe("pt-BR");
    expect(negotiateUiLocale(["not a tag", "pt"])).toBe("pt-BR");
  });

  test("never gives the pseudo-locale", () => {
    expect(negotiateUiLocale(["en-XA"])).toBe("en-US");
  });
});

describe("locale guards", () => {
  test("isUiLocale accepts only the shipped locales", () => {
    expect(isUiLocale("en-US")).toBe(true);
    expect(isUiLocale("pt-BR")).toBe(true);
    expect(isUiLocale("en-XA")).toBe(false);
    expect(isUiLocale("pt")).toBe(false);
    expect(isUiLocale(3)).toBe(false);
  });

  test("isDisplayLocale also accepts the pseudo-locale", () => {
    expect(isDisplayLocale("en-XA")).toBe(true);
    expect(isDisplayLocale("es-ES")).toBe(false);
  });
});

describe("resourcePath", () => {
  test("reads the locale from the file name and the namespace from the folders", () => {
    expect(resourcePath("/src/features/library/i18n/en-US.ftl")).toEqual({ locale: "en-US", namespace: "library" });
    expect(resourcePath("../../packages/ui/src/i18n/pt-BR.ftl")).toEqual({ locale: "pt-BR", namespace: "ui" });
    expect(resourcePath("./app/i18n/en-US.ftl")).toEqual({ locale: "en-US", namespace: "app" });
    expect(resourcePath("./i18n/en-US.ftl")).toEqual({ locale: "en-US", namespace: "app" });
    expect(resourcePath("/packages/i18n/src/registry/pt-BR.ftl")).toEqual({ locale: "pt-BR", namespace: "registry" });
  });

  test("reads the locale from the folder and the namespace from the file name", () => {
    expect(resourcePath("/src/features/room/i18n/pt-BR/panels.ftl")).toEqual({
      locale: "pt-BR",
      namespace: "panels",
    });
  });

  test("ignores paths without a locale and files that are not FTL", () => {
    expect(resourcePath("/src/i18n/messages.ftl")).toBeNull();
    expect(resourcePath("/src/i18n/en-US.json")).toBeNull();
    expect(resourcePath("C:\\web\\src\\app\\i18n\\en-US.ftl")).toEqual({ locale: "en-US", namespace: "app" });
  });
});

describe("collectResources", () => {
  test("returns the resources in the order of their paths and skips other files", () => {
    const resources = collectResources({
      "./features/room/i18n/pt-BR.ftl": "b = B",
      "./app/i18n/en-US.ftl": "a = A",
      "./app/i18n/notes.ftl": "ignored = Ignored",
    });
    expect(resources).toEqual([
      { locale: "en-US", namespace: "app", source: "a = A" },
      { locale: "pt-BR", namespace: "room", source: "b = B" },
    ]);
  });
});
