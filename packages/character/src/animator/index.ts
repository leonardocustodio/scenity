// SPDX-License-Identifier: Apache-2.0
/**
 * The pure part of the animator (`@scenity/character/animator`): the parameters over time, the motions, the
 * state machines and the frame of the layers at a time. It has no three.js: the pose mixer
 * (`@scenity/character/poseMixer`) and the foot lock (`@scenity/character/footLock`) put a frame on a model.
 */
export * from "./animator";
export { cloneRun, timeAtPhase, type AnimatorEvent, type MachineRun } from "./machine";
export * from "./motion";
export * from "./parameters";
