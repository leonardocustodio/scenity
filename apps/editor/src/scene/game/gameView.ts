// SPDX-License-Identifier: Apache-2.0
/**
 * The Game view of the editor window (the panel `game.view`): the scene through a document camera in the player path.
 * The view embeds the play page (player/play.html) with a handoff of the documents now, so it draws what a player
 * draws, with no editor layer. Its options: the camera, a resolution or aspect preset (the frame of the player fits in
 * the panel), the tier, the backend and the render worker of the player, and the stats of the player. Play brings the
 * view to the front with the documents of the play mode.
 */

/** The presets of the resolution: "free" fills the panel; the others keep their aspect. */
export const RESOLUTIONS = [
  { id: "free", width: 0, height: 0 },
  { id: "1920x1080", width: 1920, height: 1080 },
  { id: "1280x720", width: 1280, height: 720 },
  { id: "1080x1920", width: 1080, height: 1920 },
  { id: "1024x1024", width: 1024, height: 1024 },
  { id: "800x600", width: 800, height: 600 },
] as const;
export type ResolutionId = (typeof RESOLUTIONS)[number]["id"];

/** The options of the Game view. */
export interface GameOptions {
  readonly camera: string | null;
  readonly resolution: ResolutionId;
  readonly tier: "ultra" | "high" | "medium" | "low";
  readonly backend: "auto" | "webgl" | "webgpu";
  readonly worker: boolean;
  readonly stats: boolean;
}

export const DEFAULT_GAME: GameOptions = {
  camera: null,
  resolution: "free",
  tier: "high",
  backend: "auto",
  worker: true,
  stats: false,
};

/** The URL parameters of the play page for the options (with `embed=1`). */
export function gameParams(options: GameOptions): Record<string, string> {
  return {
    embed: "1",
    tier: options.tier,
    backend: options.backend,
    ...(options.worker ? {} : { worker: "0" }),
  };
}

/** The size of the frame of a preset that fits in a panel of a size (CSS pixels); the whole panel for "free". */
export function fitFrame(
  resolution: ResolutionId,
  panel: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  const preset = RESOLUTIONS.find((item) => item.id === resolution) ?? RESOLUTIONS[0];
  if (preset.width === 0 || panel.width <= 0 || panel.height <= 0) return panel;
  const scale = Math.min(panel.width / preset.width, panel.height / preset.height);
  return { width: Math.floor(preset.width * scale), height: Math.floor(preset.height * scale) };
}

/** The line of the stats of the player: the frame rate, the draw calls and the triangles. */
export function statsLine(stats: {
  readonly intervalP50: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly tier: string;
  readonly mode: string;
}): {
  readonly fps: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly tier: string;
  readonly mode: string;
} {
  const fps = stats.intervalP50 > 0 ? Math.round(1000 / stats.intervalP50) : null;
  return { fps, drawCalls: stats.drawCalls, triangles: stats.triangles, tier: stats.tier, mode: stats.mode };
}
