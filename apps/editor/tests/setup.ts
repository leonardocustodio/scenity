// SPDX-License-Identifier: Apache-2.0
/**
 * The setup of each vitest file of the editor: the editor registers its plugin (src/plugins.ts), as the page
 * does before it mounts, so a core module that reads the plugin works in a test.
 *
 * Each mounted component gets the Fluent runtime of the editor (src/texts.ts), as the apps of the page do.
 */
import { config } from "@vue/test-utils";
import { editorI18n } from "../src/texts";
import "../src/plugins";

config.global.plugins = [...config.global.plugins, editorI18n().plugin];
