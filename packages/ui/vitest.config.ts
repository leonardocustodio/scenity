// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
// Component tests of the ui package: Vitest with happy-dom and Vue Testing Library (README "Tests").
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.vitest.ts"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
