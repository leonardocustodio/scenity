// SPDX-License-Identifier: Apache-2.0
/**
 * The Hub page of Scenity Studio (`hub.html`): the start page of the studio with no project. The studio host serves
 * it at `/`. One time, the page moves the `scenity.*` keys of the browser storage of this origin to the user state of
 * the host.
 */
import { createAnnouncer } from "@scenity/ui";
import { isDisplayLocale } from "@scenity/i18n";
import { createApp, h } from "vue";
import { editorI18n } from "../texts";
import HubApp from "./HubApp.vue";
import { studioApi } from "./studioApi";
import { applyTheme, importBrowserKeys, useHub } from "./useHub";
import "./hub.css";

const api = studioApi();
const hub = useHub(api);
const i18n = editorI18n();
document.title = i18n.format("hub-title");
createApp({ render: () => h(HubApp, { hub }) })
  .use(i18n.plugin)
  .use(createAnnouncer())
  .mount("#hub");

void hub.load().then(async () => {
  const studio = hub.state.studio;
  if (studio === null) return;
  applyTheme(studio.preferences);
  const fromUrl = new URLSearchParams(location.search).has("locale");
  if (!fromUrl && isDisplayLocale(studio.preferences.locale)) i18n.setLocale(studio.preferences.locale);
  await importBrowserKeys(api, studio.preferences.importedKeys);
});
