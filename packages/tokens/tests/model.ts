// SPDX-License-Identifier: Apache-2.0
// A shared build model for the token tests. Style Dictionary runs once per test process.
import { buildModel, runChecks } from "../config/build";
import type { BuildModel } from "../config/formats";

let model: Promise<BuildModel> | null = null;

export function sharedModel(): Promise<BuildModel> {
  model ??= buildModel();
  return model;
}

export async function sharedChecks(): Promise<ReturnType<typeof runChecks>> {
  return runChecks(await sharedModel());
}
