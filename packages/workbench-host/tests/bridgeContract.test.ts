// SPDX-License-Identifier: Apache-2.0
// The bridge contract on the caller side of the host: the typed calls of the tools (`callTyped` of the tool kit) run
// the shared case table of @scenity/bridge. The lab page does the same on the frame side
// (apps/editor/tests/unit/bridge-contract.vitest.ts).
import { describe } from "bun:test";
import { BASE_CALL_CASES, SCENE_FILE_CALL_CASES } from "@scenity/bridge/cases";
import { runCallerCases } from "./bridgeCaller";

describe("the base calls on the caller side of the host", () => {
  runCallerCases(BASE_CALL_CASES);
});

describe("the scene file calls on the caller side of the host", () => {
  runCallerCases(SCENE_FILE_CALL_CASES);
});
