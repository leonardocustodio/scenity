// SPDX-License-Identifier: Apache-2.0
/**
 * The clip lanes of the content browser: for each member, the catalog clip (MemberPose.clip) and the clip family that
 * the scene draws over time. The core keeps a memory from frame to frame (the walks, the holds of a repeated motion).
 * Thus the lanes come from the inspect report of drawn frames (`__room3dLab.sweep`), not from the pose model alone.
 * A sweep keeps the lanes of each take in generated/takeLanes.json.
 *
 * This module has no Vite import: the Bun tools read it.
 */

/** What a member draws in one frame. */
export interface LaneMember {
  readonly id: string;
  readonly clip: string | null;
  readonly family: string;
  /** The clips that play over the clip (MemberPose.layers), or absent. */
  readonly layers?: readonly string[];
}

/** One frame of a sweep: its time and what each member draws. */
export interface LaneSample {
  readonly at: number;
  readonly members: readonly LaneMember[];
}

/** A part of a lane with one clip (or none) and one family, from `from` to `to` (ms; `to` is the next sample). */
export interface LaneSegment {
  readonly clip: string | null;
  readonly family: string;
  readonly from: number;
  readonly to: number;
}

/** The lanes of a take: the segments of each member, in the order of time. */
export type Lanes = Readonly<Record<string, readonly LaneSegment[]>>;

/** The lanes of a list of samples (in the order of time); a sample covers the time to the next one, or `step`. */
export function lanesOf(samples: readonly LaneSample[], step: number): Lanes {
  const out: Record<string, LaneSegment[]> = {};
  samples.forEach((sample, index) => {
    const end = samples[index + 1]?.at ?? sample.at + step;
    for (const member of sample.members) {
      const lane = (out[member.id] ??= []);
      const last = lane.at(-1);
      if (last?.clip === member.clip && last.family === member.family && last.to >= sample.at) {
        lane[lane.length - 1] = { ...last, to: end };
      } else {
        lane.push({ clip: member.clip, family: member.family, from: sample.at, to: end });
      }
    }
  });
  return out;
}

/**
 * The layer lanes of a list of samples: for each member, the segments of each clip that plays over its clip
 * (MemberPose.layers: the jaw of a voice, a readback, a gesture). The segments of two layer clips can overlap. The
 * family of a segment is `layer`.
 */
export function layerLanesOf(samples: readonly LaneSample[], step: number): Lanes {
  const out: Record<string, LaneSegment[]> = {};
  samples.forEach((sample, index) => {
    const end = samples[index + 1]?.at ?? sample.at + step;
    for (const member of sample.members) {
      for (const clip of member.layers ?? []) {
        const lane = (out[member.id] ??= []);
        const open = lane.findLast((segment) => segment.clip === clip);
        if (open !== undefined && open.to >= sample.at) {
          lane[lane.lastIndexOf(open)] = { ...open, to: end };
        } else {
          lane.push({ clip, family: "layer", from: sample.at, to: end });
        }
      }
    }
  });
  return out;
}

/** The label of a segment: the catalog clip, else the family. */
export function segmentLabel(segment: LaneSegment): string {
  return segment.clip ?? segment.family;
}

/** The segments of a clip in the lanes: the member and the time of each. */
export function clipSegments(lanes: Lanes, clip: string): { readonly member: string; readonly segment: LaneSegment }[] {
  return Object.entries(lanes).flatMap(([member, lane]) =>
    lane.filter((segment) => segment.clip === clip).map((segment) => ({ member, segment })),
  );
}

/** The segment of a member at a time, or null. */
export function segmentAt(lanes: Lanes, member: string, at: number): LaneSegment | null {
  return lanes[member]?.find((segment) => segment.from <= at && at < segment.to) ?? null;
}
