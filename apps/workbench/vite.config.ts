// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * The workbench page of Scenity. The dev server binds the loopback address and has no fixed port. `--port <n>` from
 * the CLI sets one, else the server takes a free port. Many checkouts and their servers run on one machine, so the page
 * never assumes a port.
 */
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
  build: {
    target: "es2023",
    sourcemap: true,
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.vitest.ts"],
    restoreMocks: true,
  },
});
