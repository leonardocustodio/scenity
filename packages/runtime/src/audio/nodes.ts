// SPDX-License-Identifier: Apache-2.0
/**
 * The Web Audio nodes of a voice: a buffer source, a gain for the volume and, for a spatial voice, a
 * `PannerNode` at the world place of the entity. The listener of the context follows the camera of the frame. The
 * types name only the part of Web Audio that the player uses, so a test can give a fake context.
 */
import type { AudioListenerPose, AudioVector, AudioVoice } from "../protocolAudio";

/** The part of an `AudioParam` that the player sets. */
interface ParamLike {
  value: number;
}

/** The part of an `AudioNode` that the player uses. */
export interface NodeLike {
  connect(destination: NodeLike): unknown;
  disconnect(): void;
}

export interface SourceLike extends NodeLike {
  buffer: AudioBuffer | null;
  loop: boolean;
  onended: (() => void) | null;
  start(when: number, offset: number): void;
  stop(): void;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface PannerLike extends NodeLike {
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  refDistance: number;
  rolloffFactor: number;
  maxDistance: number;
  readonly positionX: ParamLike;
  readonly positionY: ParamLike;
  readonly positionZ: ParamLike;
}

export interface ListenerLike {
  readonly positionX?: ParamLike;
  readonly positionY?: ParamLike;
  readonly positionZ?: ParamLike;
  readonly forwardX?: ParamLike;
  readonly forwardY?: ParamLike;
  readonly forwardZ?: ParamLike;
  readonly upX?: ParamLike;
  readonly upY?: ParamLike;
  readonly upZ?: ParamLike;
  /** The old API of Firefox before the `AudioParam` fields. */
  setPosition?(x: number, y: number, z: number): void;
  setOrientation?(x: number, y: number, z: number, upX: number, upY: number, upZ: number): void;
}

/** The part of an `AudioContext` that the player uses. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: NodeLike;
  readonly listener: ListenerLike;
  createBufferSource(): SourceLike;
  createGain(): GainLike;
  createPanner(): PannerLike;
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** The nodes of one voice: the source, and each node of the chain from the source to the destination. */
export interface VoiceNodes {
  readonly source: SourceLike;
  readonly gain: GainLike;
  readonly panner: PannerLike | null;
  readonly chain: readonly NodeLike[];
}

function setVector(x: ParamLike | undefined, y: ParamLike | undefined, z: ParamLike | undefined, v: AudioVector) {
  if (x === undefined || y === undefined || z === undefined) return false;
  [x.value, y.value, z.value] = v;
  return true;
}

/** Put the listener of a context at the pose of the camera. */
export function applyListener(context: AudioContextLike, pose: AudioListenerPose): void {
  const listener = context.listener;
  if (!setVector(listener.positionX, listener.positionY, listener.positionZ, pose.position)) {
    listener.setPosition?.(...pose.position);
  }
  const forward = setVector(listener.forwardX, listener.forwardY, listener.forwardZ, pose.forward);
  const up = setVector(listener.upX, listener.upY, listener.upZ, pose.up);
  if (!forward || !up) listener.setOrientation?.(...pose.forward, ...pose.up);
}

/** Set the volume, the place and the distance values of the nodes of a voice. */
export function setVoiceNodes(nodes: VoiceNodes, voice: AudioVoice): void {
  nodes.gain.gain.value = voice.volume;
  const panner = nodes.panner;
  if (panner === null) return;
  panner.distanceModel = voice.distanceModel;
  panner.refDistance = voice.refDistance;
  panner.rolloffFactor = voice.rolloff;
  panner.maxDistance = voice.maxDistance;
  setVector(panner.positionX, panner.positionY, panner.positionZ, voice.position);
}

/** Make the nodes of a voice and connect them to the destination of the context. */
export function makeVoiceNodes(context: AudioContextLike, voice: AudioVoice, buffer: AudioBuffer): VoiceNodes {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = voice.loop;
  const gain = context.createGain();
  source.connect(gain);
  let panner: PannerLike | null = null;
  if (voice.spatial) {
    panner = context.createPanner();
    panner.panningModel = "HRTF";
    gain.connect(panner);
    panner.connect(context.destination);
  } else {
    gain.connect(context.destination);
  }
  const nodes: VoiceNodes = { source, gain, panner, chain: panner === null ? [source, gain] : [source, gain, panner] };
  setVoiceNodes(nodes, voice);
  return nodes;
}
