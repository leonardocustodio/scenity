// SPDX-License-Identifier: Apache-2.0
/**
 * The icon of each asset kind: a tile with no still shows the icon of its kind.
 * A plugin kind (`acme.name`) gets the default icon.
 */
import { Box, Clapperboard, File, Film, Image, Music, Package, Palette, PersonStanding, Sun } from "lucide-vue-next";
import type { Component } from "vue";

const ICONS: Readonly<Record<string, Component>> = {
  model: Box,
  "skinned-model": PersonStanding,
  animation: Film,
  texture: Image,
  material: Palette,
  environment: Sun,
  scene: Clapperboard,
  prefab: Package,
  audio: Music,
};

/** The icon of a kind. */
export function kindIcon(kind: string): Component {
  return ICONS[kind] ?? File;
}
