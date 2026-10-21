# @scenity/character

The character parts of Scenity: the humanoid rig, the rig profiles and the retarget, the IK body, the rig driver, the
clip sampler and the clip layer. The package also has the walks, the locomotion, the clip times and the crossfade of
the poses, the animator and the navigation over the obstacles of a scene document. The package can import only `@scenity/scene` (the tune registry, the
component types and the sequence samples) and three.js.

A plugin binds the parts to its own pose, input and clip families: the pose of a plugin extends `BodyPose`, its member input
has the fields of `WalkerInput`, `MixInput` and `PhaseInput`, and its clip configs are `ClipConfig<Rig, Family, Pose>`.

## Entry points

Import a subpath (one per module). The barrel `@scenity/character` has the types only. The package has no side effects
except the two modules that register tune values at module level (`locomotion.ts`: `pose.turn`, `pose.sidestep`;
`poseBlend.ts`: `pose.mix`), so its `sideEffects` field names them: a lab build keeps them on each side that imports
them.

## The file map: to change X, edit Y

All paths are under `src/`.

| To change                                                                               | Edit                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Vector and easing helpers, `Vec3`                                                       | `math.ts` (one copy of each)                                                                      |
| The floor shapes, the slot, the place, the hand goals, `BodyPose`, `yawTo`              | `place.ts` (types and one pure function)                                                          |
| The bone list, the retarget chains, the skeleton check                                  | `rig.ts` (`HUMANOID_BONES`, `RETARGET_CHAINS`, `checkSkeleton`)                                   |
| The reference skeleton of the tests and the clip baker                                  | `referenceRig.ts`                                                                                 |
| The neutral body: the trunk, the look, the reach and the two-bone IK                    | `body.ts`; the reach limit `LEAN_MAX` in `reach.ts`                                               |
| The copy of the body pose to a skinned skeleton                                         | `rigDriver.ts`                                                                                    |
| The sample of a glTF clip at a time, the additive layer, the cycle clips                | `clipSampler.ts`; the cycle length in `cycle.ts`                                                  |
| A recorded clip over the procedural pose (the trunk drive)                              | `clipLayer.ts`                                                                                    |
| The parts of an in/hold/out clip, a once clip, the phase length                         | `clipTime.ts`                                                                                     |
| Walks and paths around the obstacles                                                    | `path.ts`                                                                                         |
| The obstacles and the stand points of a scene document                                  | `navigation.ts`                                                                                   |
| The walks of a `locomotion` component over time, the walk speed parameter               | `walkPlan.ts`                                                                                     |
| The walkers of a scene document and their transforms at a time                          | `sceneWalks.ts`                                                                                   |
| The place of a character in a frame (the walk, the side step, the turn)                 | `locomotion.ts`                                                                                   |
| The crossfade of two poses after a change of the family                                 | `poseBlend.ts`; the points in front of the body and the blend of two hand goals in `handBlend.ts` |
| The animator: parameters over time, the source of a sequence                            | `animator/parameters.ts`                                                                          |
| The 1D blend, the length and the rate of a motion, the motion samples                   | `animator/motion.ts`                                                                              |
| The state machines: checks, transitions, crossfades, events, the rate marks             | `animator/machine.ts`                                                                             |
| The frame of the layers at a time, the memo, `createAnimator`                           | `animator/animator.ts`                                                                            |
| The mix of a frame on a model: layers, masks, additive, procedural, root                | `animator/poseMixer.ts`                                                                           |
| The foot lock: the contacts of a clip, the plant, the two-bone IK                       | `animator/footLock.ts`                                                                            |
| The canonical humanoid bones (VRM 1.0 names), their parents and directions              | `profiles/humanoid.ts`                                                                            |
| The rig profiles: `ue5`, `rigify`, `vrm`, `mixamo` and their bone names                 | `profiles/profiles.ts`                                                                            |
| The bone map of a profile, the detection, the profile of an asset record                | `profiles/resolve.ts`                                                                             |
| The rest pose as data (from a model or from glTF JSON), a pose at a time                | `rest.ts`                                                                                         |
| The retarget of a clip from one humanoid skeleton to another                            | `retarget.ts`                                                                                     |
| The IK of any skeleton: the leg, the arm with a pole, the aim of a head                 | `ik.ts`                                                                                           |
| The parent of an attach key, the move of an object under a bone                         | `attach.ts`                                                                                       |
| The bone map of a `character` component, the node of a bone, the clips of a clip source | `characterRig.ts`                                                                                 |

The modules `cycle.ts` and `reach.ts` have no imports: a page chunk reads the constants without the body code.

## The animator

`@scenity/character/animator` is the pure part (no three.js). `createAnimator({ value, clips, parameters })` takes the
`animator` component value of `@scenity/scene` (with its defaults), the clip lengths of the model in seconds and a
`ParameterSource` (`sequenceParameters(sequence, entity, defaults)` reads the property tracks on
`animator/parameters/<name>`; `constantParameters(values)` is a fixed set). `animator.at(t, since?)` gives the frame at
`t` ms: for each layer the current state, the state before it in a crossfade, the fade and the weighted motion
samples (a clip and its clip time, or a procedural motion), and the events of the states in (since, t].

- The transitions go only at checks: each multiple of `stepMs`, each parameter key, each exit time and each crossfade
  end. The run moves from check to check and never to a frame time, so the frame at `t` does not depend on the frames
  before it: a seek equals a play (`tests/animator.test.ts`, 1,000 random times). A memo keeps the runs at each
  second; its loss changes no frame.
- A loop state wraps its normalized time; a once state holds its last pose. The clips of a 1D blend keep the same
  normalized time, and the length of the blend is the weighted mean of the lengths.
- No transition goes during a crossfade (no interruption).

`@scenity/character/poseMixer` (`PoseMixer`) puts a frame on the nodes of a model with no AnimationMixer: each frame
starts from the rest pose; an override layer mixes the weighted mean of its clips by the layer weight (a clip with no
track for a node gives its rest value); an additive layer adds the motion away from time 0; a `ProceduralMotion` of a
plugin (`<plugin>.<name>`) changes the nodes after the clips of its layer; the root motion `in-place` keeps the floor
place of the root bone. `@scenity/character/footLock` (`FootLock`) holds a foot in contact at the floor place where the
contact started (the time comes from `animator.timeAtPhase`, so the place is a function of the time). The foot lock locks only x and
z, only out of a crossfade, and not for a foot that does not move in its clip.

## Navigation

`@scenity/character/navigation` reads the floor of the walks from a scene document: `floorObstacles(scene, options)`
gives the floor rectangle (x, z, world frame, in tree order) of each `obstacle` component (a `rect` footprint, the
rectangle around a `polygon`, or the `bounds` of a `shape`; the bounds of a model come from `options.bounds`, and an
entity with a tag of `options.skipTags` gives none). `standPlaces(scene)` gives each `standPoint` with the yaw of an
actor there (the `facing` 0 of a stand point faces -Z, so the actor yaw is the facing plus π). `scenePath` is
`planPath` over the obstacles of a scene. The package has no navigation grid (nav mesh).

`@scenity/character/walkPlan` plans the walks of a `locomotion` component: `planWalks(start, targets, obstacles, speed,
turnSpeed)` gives legs with fixed times (the start, the arrival, the end of the turn to the stand point, in whole ms);
`walkFrame(plan, t)` gives the place, the yaw and the walk speed at a time, a pure function, so a seek equals a play;
`walkParameters(plan, parameter, base)` gives the animator the walk speed (0 when the actor stands), with changes only
at the start and the arrival. The heading turns at each corner in a window that the turn speed gives.
`@scenity/character/sceneWalks` reads the walkers of a scene (`sceneWalkers`) and puts their transforms at a time into a
scene (`withWalkers`); `SceneTimeline` of `@scenity/runtime` uses it.

## Rig profiles and the retarget

`@scenity/character/profiles` has the rig profiles as data: each profile maps the canonical humanoid bones (the
humanoid bone names of VRM 1.0) to candidate bone names of one skeleton family. `ue5` (the UE5 mannequin, and the
short UE4 spine), `rigify` (the DEF-_, ORG-_ or metarig bones of a Rigify rig of Blender),
`vrm` (VRoid Studio names or the VRM names), `mixamo` (with or without `mixamorig:`; many motion capture files use the
same names). The names compare in the form of the glTF loader of three.js (`DEF-spine.001` finds `DEF-spine001`).

- The `rig` field of an asset record (`.meta.json`, `@scenity/assets`) names the profile, or `none` for a skeleton
  that plays its own clips only. With no field, `profileFor(undefined, names)` detects the profile: the profile with
  every required bone and the most bones. A skeleton of another shape has no profile and plays its own clips.
- `retargetClip(clip, fromProfile, toProfile, fromRest, toRest)` (`@scenity/character/retarget`) gives a clip with
  tracks on the node names of the target. The retarget is a function at load time, not a step of the pose mixer: the
  pose mixer binds the new clip by name as any clip, a frame costs nothing more, and the worker carries no profile
  table. It is rest-pose aware: the motion of each canonical bone is its turn from its rest rotation in the model
  space, and an alignment turns the rest direction of the target bone onto the rest direction of the source bone (an
  A-pose clip plays on a T-pose skeleton). The hips move by the motion of the source, scaled by the hip heights.
- `restPoseOf(model)` and `restPoseOfGltf(json)` (`@scenity/character/rest`) give the rest pose as data; `poseAt` and
  `boneDirections` pose a skeleton at a time and give the canonical bone directions (the tests compare two skeletons
  with them).

The sample `samples/characters` has a Rigify mannequin (`assets/sources/RigifyMannequin`, own work, CC0; the script
`tools/make_rigify_mannequin.py` makes it with Blender 5.2) with a procedural idle.

## Generic characters

`@scenity/character/ik` has the IK of any skeleton: `solveTwoBone` (the leg of the foot lock), `solveLimb` (an arm
with a pole: the rule of the hands of `body.ts` on the nodes of any model; the elbow goes to the side of the pole) and
`aimAt` (a head turns to a target within a limit). Each solver turns the nodes of a posed model in place and keeps no
state. `body.ts` keeps its own copy of the arm IK, so the frames of a plugin that uses it do not change.

`@scenity/character/characterRig` gives the bone map of a `character` component: the profile of `rig` (or the profile
from the bone names), then the node names of `bones` over it, so a skeleton with no profile (the robot of
`samples/characters`) names its hands. The map holds the node names of the loaded model: `findNode` compares a name as written and in the form of the
glTF loader (`UpperArm.L` finds `UpperArmL`; a bone renamed `Torso_1` after a mesh "Torso" comes before that mesh).
`boneNode` finds the node of a canonical bone. `clipsFrom` retargets the clips of a clip source onto a model at load time (`retargetClip`).

`@scenity/character/attach` parses the parent of an attach key (`attachTarget`) and moves an object under a node
(`attachTo`). It has no profile tables and no schema: a plugin can use it in its render worker for the held props.

## Rules

- The pose functions are pure: the same input, place and simulation time give the same result. No
  `Math.random`, no wall clock.
- No module names the domain of a plugin.

## Tests

`bun test ./packages/character` (from the repo root): the clip times, the humanoid rig and the rig driver on the
reference skeleton, the walks around an obstacle and the start place of a walk, and the crossfade.
`tests/retarget.test.ts` detects the profiles of the reference skeleton (UE5) and of the Rigify mannequin, and plays
the idle of the mannequin on the reference skeleton (and a clip of the reference skeleton on the mannequin): the
canonical bone directions agree at each sample time.
`tests/ik.test.ts` checks the arm IK with a pole, the aim of a head, the attach and the bone map of a character. `tests/navigation.test.ts` reads the table scene of `samples/characters`: the path of the robot has no point in the
table and ends at the stand point, and the walk speed and the turn stay in their limits at each frame. The
animator tests read the controller and the sequence of `samples/characters` (`tests/animatorKit.ts`): the states change at the
expected times, the events come once, seek equals play; the pose mixer and foot lock tests load its robot glTF.
