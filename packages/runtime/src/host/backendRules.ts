// SPDX-License-Identifier: Apache-2.0
/**
 * The data of the renderer backend choice: the WebGPU blocklist, the adapter limits that the scene needs, and the
 * compressed texture families that the KTX2 transcode targets. This module has only a type import, so the page chunks
 * stay small.
 *
 * The blocklist is empty at first. A defect on a device family adds a rule here with the record of the defect. A rule
 * matches when each of its fields matches the same field of `GPUAdapterInfo` (a regular expression, no case).
 */

import type { BackendKind } from "@scenity/render/types";

/** The renderer backends of a scene: three.js WebGPURenderer, or the classic WebGLRenderer. */
export type SceneBackend = BackendKind;

/** The server switch `room3d.backend` of the app config: the choice of the checks, or WebGL for all users. */
export type BackendSwitch = "auto" | "webgl";

/**
 * The reason why a backend runs. The telemetry of the game sends these codes. `Room3DBackendReason` of the client
 * telemetry contract has the same values, so a new code needs a change of the contract first.
 */
export const BACKEND_REASONS = [
  "supported",
  "server_switch",
  "url_override",
  "device_lost",
  "no_webgpu",
  "no_worker_webgpu",
  "no_adapter",
  "fallback_adapter",
  "blocklist",
  "no_texture_compression",
  "limits",
  "device_failed",
  "timeout",
  "entry_not_built",
] as const;
export type BackendReason = (typeof BACKEND_REASONS)[number];

/** The browser engine of the page: a blocklist rule can name one. */
export type BrowserEngine = "chromium" | "webkit" | "gecko" | "other";

/**
 * The browser engine of a user agent text. Chrome on iOS (`CriOS`) and Firefox on iOS (`FxiOS`) use WebKit, and their
 * text has no `Chrome/` or `Firefox/`.
 */
export function browserEngine(userAgent: string): BrowserEngine {
  if (/\b(?:Chrome|Chromium)\//.test(userAgent)) return "chromium";
  if (/\bFirefox\//.test(userAgent)) return "gecko";
  if (/\bAppleWebKit\//.test(userAgent)) return "webkit";
  return "other";
}

/**
 * A device class that uses WebGL. Each field that the rule gives must match: the adapter fields as regular
 * expressions, `engine` as the same word. The chooser ignores a rule with no field.
 */
export interface BackendBlockRule {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
  /** The browser engine of the page. */
  readonly engine?: BrowserEngine;
  /** The defect or the measurement and its record, for the people who read this file. */
  readonly why: string;
}

/**
 * The WebGPU blocklist. No device family has a known defect, so the list is empty. WebGPU is the default on each
 * device that passes the checks: a speed difference is not a reason for a rule.
 */
export const BACKEND_BLOCKLIST: readonly BackendBlockRule[] = [];

/**
 * The adapter limits that the scene needs. The values are at or below the WebGPU defaults of a core device, so only a
 * compatibility adapter or a weak adapter fails. The largest texture of the high tier is 2048 px.
 */
export const BACKEND_MIN_LIMITS: Readonly<Record<string, number>> = {
  maxTextureDimension2D: 4096,
  maxBindGroups: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
};

/** The compressed texture families that the KTX2 transcode can target. One family is sufficient. */
export const BACKEND_TEXTURE_FEATURES: readonly string[] = [
  "texture-compression-astc",
  "texture-compression-etc2",
  "texture-compression-bc",
];

/** The fields of an adapter that a blocklist rule reads. */
export interface AdapterFacts {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

const RULE_FIELDS = ["vendor", "architecture", "device", "description"] as const;

/** The first rule of the list that matches the adapter and the browser engine of the page, or null. */
export function blockedBy(
  facts: AdapterFacts,
  rules: readonly BackendBlockRule[],
  engine: BrowserEngine = "other",
): BackendBlockRule | null {
  for (const rule of rules) {
    const fields = RULE_FIELDS.filter((field) => rule[field] !== undefined);
    if (fields.length === 0 && rule.engine === undefined) continue;
    if (rule.engine !== undefined && rule.engine !== engine) continue;
    const match = fields.every((field) => new RegExp(rule[field] ?? "", "i").test(facts[field]));
    if (match) return rule;
  }
  return null;
}
