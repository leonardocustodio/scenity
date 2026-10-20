// SPDX-License-Identifier: Apache-2.0
// Vitest setup of the ui component tests: unmount every rendered component after each test.
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});
