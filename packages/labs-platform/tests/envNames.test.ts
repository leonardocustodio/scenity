// SPDX-License-Identifier: Apache-2.0
/**
 * The environment variable names: the new name `SCENITY_X` first, then the old name `CODEBLUE_X` with one warning,
 * and the copy of an environment without a variable under both names.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { envNames, envValue, oldEnvName, withoutEnv } from "../src/envNames";

describe("envNames", () => {
  test("the old name of a variable", () => {
    expect(oldEnvName("SCENITY_LABS_POOL")).toBe("CODEBLUE_LABS_POOL");
    expect(oldEnvName("HOME")).toBeNull();
    expect(envNames("SCENITY_X")).toEqual(["SCENITY_X", "CODEBLUE_X"]);
    expect(envNames("CI")).toEqual(["CI"]);
  });

  test("the new name wins; the old name gives the value with one warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(envValue("SCENITY_T1", { SCENITY_T1: "new", CODEBLUE_T1: "old" })).toBe("new");
      expect(warn).not.toHaveBeenCalled();
      expect(envValue("SCENITY_T1", { CODEBLUE_T1: "old" })).toBe("old");
      expect(envValue("SCENITY_T1", { CODEBLUE_T1: "old" })).toBe("old");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("use SCENITY_T1");
      expect(envValue("SCENITY_T1", {})).toBeUndefined();
      expect(envValue("PLAIN", { PLAIN: "1" })).toBe("1");
    } finally {
      warn.mockRestore();
    }
  });

  test("a copy without the variables removes the old names too", () => {
    const env = { SCENITY_TOKEN: "a", CODEBLUE_TOKEN: "b", HOME: "/h" };
    expect(withoutEnv(env, ["SCENITY_TOKEN"])).toEqual({ HOME: "/h" });
  });
});
