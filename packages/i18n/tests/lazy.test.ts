// SPDX-License-Identifier: Apache-2.0
// Texts on demand: addResources, requireGroups and changeLocale of createI18n with the `load` option.
import { describe, expect, test } from "bun:test";
import { computed } from "vue";
import { createI18n, sourceLocales, type FtlResource, type UiLocale } from "../src/index";

/** The test groups: "shell" and "feature", each with an en-US and a pt-BR file. */
const FILES: Record<string, Record<UiLocale, string>> = {
  shell: { "en-US": "shell-hello = Hello\n", "pt-BR": "shell-hello = Olá\n" },
  feature: { "en-US": "feature-title = Library\nfeature-new = New\n", "pt-BR": "feature-title = Biblioteca\n" },
};

function plain(text: string): string {
  return text.replace(/[⁨⁩]/g, "");
}

/** A loader that records each call and can hold or fail a load. */
function loader(): {
  load: (group: string, locale: UiLocale) => Promise<FtlResource[]>;
  calls: string[];
  failNext: () => void;
} {
  const calls: string[] = [];
  let fail = false;
  return {
    calls,
    failNext: () => {
      fail = true;
    },
    load: async (group, locale) => {
      calls.push(`${group}:${locale}`);
      await Promise.resolve();
      if (fail) {
        fail = false;
        throw new Error("the chunk did not load");
      }
      const source = FILES[group]?.[locale];
      return source === undefined ? [] : [{ locale, namespace: group, source }];
    },
  };
}

describe("sourceLocales", () => {
  test("gives the locale and the fallback locale", () => {
    expect(sourceLocales("pt-BR")).toEqual(["pt-BR", "en-US"]);
    expect(sourceLocales("en-US")).toEqual(["en-US"]);
    expect(sourceLocales("en-XA")).toEqual(["en-US"]);
  });
});

describe("texts on demand", () => {
  test("requireGroups loads each group once in the locale and in the fallback locale", async () => {
    const { load, calls } = loader();
    const i18n = createI18n({ locale: "pt-BR", resources: [], load, onMissing: () => undefined });
    expect(i18n.format("shell-hello")).toBe("shell-hello");
    await i18n.requireGroups(["shell", "feature"]);
    await i18n.requireGroups(["shell"]);
    expect(calls.sort()).toEqual(["feature:en-US", "feature:pt-BR", "shell:en-US", "shell:pt-BR"]);
    expect(i18n.format("shell-hello")).toBe("Olá");
    // The pt-BR file has no feature-new: the en-US text of the same group is the fallback.
    expect(i18n.format("feature-new")).toBe("New");
  });

  test("en-US and the pseudo-locale load only en-US", async () => {
    const { load, calls } = loader();
    const english = createI18n({ locale: "en-US", resources: [], load });
    await english.requireGroups(["shell"]);
    expect(english.format("shell-hello")).toBe("Hello");
    const pseudo = createI18n({ locale: "en-XA", resources: [], load });
    await pseudo.requireGroups(["shell"]);
    expect(plain(pseudo.format("shell-hello"))).toBe("[Ħḗḗŀŀǿǿ]");
    expect(calls).toEqual(["shell:en-US", "shell:en-US"]);
  });

  test("changeLocale loads every required group before the change", async () => {
    const { load, calls } = loader();
    const i18n = createI18n({ locale: "en-US", resources: [], load });
    await i18n.requireGroups(["shell", "feature"]);
    const change = i18n.changeLocale("pt-BR");
    expect(i18n.locale.value).toBe("en-US");
    await change;
    expect(i18n.locale.value).toBe("pt-BR");
    expect(i18n.format("feature-title")).toBe("Biblioteca");
    expect(calls).toEqual(["shell:en-US", "feature:en-US", "shell:pt-BR", "feature:pt-BR"]);
  });

  test("changeLocale also loads a group that a navigation requires during the change", async () => {
    const { load } = loader();
    const i18n = createI18n({ locale: "en-US", resources: [], load });
    await i18n.requireGroups(["shell"]);
    const change = i18n.changeLocale("pt-BR");
    const navigation = i18n.requireGroups(["feature"]);
    await Promise.all([change, navigation]);
    expect(i18n.locale.value).toBe("pt-BR");
    expect(i18n.format("feature-title")).toBe("Biblioteca");
  });

  test("only the last of two changes applies", async () => {
    const { load } = loader();
    const i18n = createI18n({ locale: "en-US", resources: [], load });
    await i18n.requireGroups(["shell"]);
    const first = i18n.changeLocale("pt-BR");
    const second = i18n.changeLocale("en-XA");
    await Promise.all([first, second]);
    expect(i18n.locale.value).toBe("en-XA");
  });

  test("a failed load rejects, and the next call tries again", async () => {
    const { load, calls, failNext } = loader();
    const i18n = createI18n({ locale: "en-US", resources: [], load });
    failNext();
    let failure: unknown = null;
    await i18n.requireGroups(["shell"]).catch((error: unknown) => {
      failure = error;
    });
    expect(failure).toBeInstanceOf(Error);
    await i18n.requireGroups(["shell"]);
    expect(calls).toEqual(["shell:en-US", "shell:en-US"]);
    expect(i18n.format("shell-hello")).toBe("Hello");
  });

  test("without load, requireGroups resolves and changeLocale selects the locale", async () => {
    const i18n = createI18n({
      locale: "en-US",
      resources: [
        { locale: "en-US", namespace: "shell", source: FILES.shell?.["en-US"] ?? "" },
        { locale: "pt-BR", namespace: "shell", source: FILES.shell?.["pt-BR"] ?? "" },
      ],
    });
    await i18n.requireGroups(["shell"]);
    await i18n.changeLocale("pt-BR");
    expect(i18n.format("shell-hello")).toBe("Olá");
    let failure: unknown = null;
    await i18n.changeLocale("es-ES" as "en-US").catch((error: unknown) => {
      failure = error;
    });
    expect(failure).toBeInstanceOf(RangeError);
  });

  test("addResources ignores a resource with a known locale and namespace", () => {
    const i18n = createI18n({ locale: "en-US", resources: [], onMissing: () => undefined });
    i18n.addResources([{ locale: "en-US", namespace: "shell", source: "shell-hello = Hello\n" }]);
    i18n.addResources([{ locale: "en-US", namespace: "shell", source: "shell-hello = Other\n" }]);
    expect(i18n.format("shell-hello")).toBe("Hello");
  });

  test("a text that a component reads changes when its resources arrive", async () => {
    const { load } = loader();
    const i18n = createI18n({ locale: "en-US", resources: [], load, onMissing: () => undefined });
    // A computed value tracks the bundles as a render function does.
    const text = computed(() => i18n.format("shell-hello"));
    expect(text.value).toBe("shell-hello");
    await i18n.requireGroups(["shell"]);
    expect(text.value).toBe("Hello");
  });
});
