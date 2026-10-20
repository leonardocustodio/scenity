// SPDX-License-Identifier: Apache-2.0
/** The quality tier of the scene page: the `tier` parameter of the URL. */
import type { Tier } from "@scenity/runtime/protocol";
import { t } from "../texts";

/** The quality tier of the `tier` parameter, or "high" when the page gives none. */
export function tierOf(value: string | null): Tier {
  if (value === null) return "high";
  if (value !== "ultra" && value !== "high" && value !== "medium" && value !== "low") {
    throw new Error(t("scene-error-tier", { tier: value }));
  }
  return value;
}
