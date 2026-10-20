# SPDX-License-Identifier: Apache-2.0

### The labels of the built-in components, their groups and their fields. Do not edit:
### `bun tools/component-texts.ts` writes this file from the schemas of @scenity/scene.

## The groups

component-group-place = Place
component-group-render = Render
component-group-shadow = Shadow
component-group-detail = Detail
component-group-clip = Clip
component-group-scene = Scene
component-group-effects = Effects
component-group-general = General
component-group-navigation = Navigation
component-group-animation = Animation
component-group-root-motion = Root motion
component-group-audio = Audio
component-group-spatial = Spatial
component-group-rig = Rig
component-group-look = Look
component-group-ik = IK

## transform

component-transform = Transform
component-field-transform-position = Position
component-field-transform-rotation = Rotation
component-field-transform-scale = Scale

## model

component-model = Model
component-field-model-asset = Model
component-field-model-materials = Material overrides
component-field-model-cast-shadow = Cast shadow
component-field-model-receive-shadow = Receive shadow
component-field-model-lod = Levels of detail
component-field-model-lod-screen = Screen
component-field-model-lod-hysteresis = Hysteresis

## shape

component-shape = Shape
component-field-shape-kind = Kind
component-field-shape-size = Size
component-field-shape-colour = Colour
component-field-shape-roughness = Roughness
component-field-shape-metalness = Metalness
component-field-shape-material = Material
component-field-shape-cast-shadow = Cast shadow
component-field-shape-receive-shadow = Receive shadow

## light

component-light = Light
component-field-light-type = Type
component-field-light-colour = Colour
component-field-light-ground-colour = Ground colour
component-field-light-intensity = Intensity
component-field-light-range = Range
component-field-light-angle = Angle
component-field-light-penumbra = Penumbra
component-field-light-shadow = Shadow
component-field-light-target = Target
component-field-light-shadow-camera = Shadow camera
component-field-light-shadow-camera-left = Left
component-field-light-shadow-camera-right = Right
component-field-light-shadow-camera-top = Top
component-field-light-shadow-camera-bottom = Bottom
component-field-light-shadow-camera-near = Near
component-field-light-shadow-camera-far = Far
component-field-light-shadow-bias = Shadow bias
component-field-light-shadow-normal-bias = Shadow normal bias

## camera

component-camera = Camera
component-field-camera-fov = Field of view
component-field-camera-near = Near
component-field-camera-far = Far
component-field-camera-target = Target
component-field-camera-safe-frame = Safe frame
component-field-camera-safe-frame-entities = Entities
component-field-camera-safe-frame-min = Min
component-field-camera-safe-frame-max = Max
component-field-camera-safe-frame-margin = Margin
component-field-camera-safe-frame-max-fov = Max fov

## environment

component-environment = Environment
component-field-environment-background = Background
component-field-environment-tone-mapping = Tone mapping
component-field-environment-exposure = Exposure
component-field-environment-map = Environment map
component-field-environment-map-intensity = Map intensity
component-field-environment-fog = Fog
component-field-environment-ao = Ambient occlusion
component-field-environment-ao-on = On
component-field-environment-ao-radius = Radius
component-field-environment-ao-intensity = Intensity
component-field-environment-bloom = Bloom
component-field-environment-bloom-on = On
component-field-environment-bloom-threshold = Threshold
component-field-environment-bloom-strength = Strength
component-field-environment-bloom-radius = Radius
component-field-environment-antialias = Anti-aliasing
component-field-environment-outline = Selection outline
component-field-environment-outline-on = On
component-field-environment-outline-colour = Colour
component-field-environment-outline-thickness = Thickness
component-field-environment-outline-strength = Strength

## socket

component-socket = Sockets
component-field-socket-points = Points

## tags

component-tags = Tags

## visibility

component-visibility = Visibility
component-field-visibility-visible = Visible

## pickable

component-pickable = Pickable
component-field-pickable-enabled = Enabled
component-field-pickable-priority = Priority
component-field-pickable-mode = Hit test
component-field-pickable-layers = Layers

## obstacle

component-obstacle = Obstacle
component-field-obstacle-footprint = Footprint
component-field-obstacle-height = Height

## standPoint

component-stand-point = Stand point
component-field-stand-point-facing = Facing
component-field-stand-point-role = Role

## path

component-path = Path
component-field-path-points = Points
component-field-path-closed = Closed
component-field-path-width = Width

## annotation

component-annotation = Annotation
component-field-annotation-text = Text
component-field-annotation-colour = Colour
component-field-annotation-status = Status
component-field-annotation-task = Task of the agent

## prefab

component-prefab = Prefab
component-field-prefab-source = Prefab
component-field-prefab-overrides = Overrides

## animator

component-animator = Animator
component-field-animator-controller = Controller
component-field-animator-controller-parameters = Parameters
component-field-animator-controller-layers = Layers
component-field-animator-controller-step-ms = Step ms
component-field-animator-parameters = Parameters
component-field-animator-speed = Speed
component-field-animator-root-bone = Root bone
component-field-animator-root-motion = Root motion
component-field-animator-foot-lock = Foot lock
component-field-animator-foot-lock-legs = Legs
component-field-animator-foot-lock-contact = Contact
component-field-animator-foot-lock-fade = Fade
component-field-animator-clip-source = Clip source
component-field-animator-clip-source-asset = Asset
component-field-animator-clip-source-rig = Rig

## locomotion

component-locomotion = Locomotion
component-field-locomotion-speed = Walk speed
component-field-locomotion-turn-speed = Turn speed
component-field-locomotion-parameter = Speed parameter
component-field-locomotion-walks = Walks

## audioSource

component-audio-source = Audio source
component-field-audio-source-asset = Sound
component-field-audio-source-volume = Volume
component-field-audio-source-loop = Loop
component-field-audio-source-autoplay = Autoplay
component-field-audio-source-spatial = Spatial
component-field-audio-source-ref-distance = Reference distance
component-field-audio-source-rolloff = Rolloff
component-field-audio-source-max-distance = Max distance
component-field-audio-source-distance-model = Distance model

## character

component-character = Character
component-field-character-rig = Rig profile
component-field-character-bones = Bones
component-field-character-variant = Variant
component-field-character-variants = Variants
component-field-character-ik = IK goals
component-field-character-ik-left-hand = Left hand
component-field-character-ik-left-hand-target = Target
component-field-character-ik-left-hand-weight = Weight
component-field-character-ik-left-hand-pole = Pole
component-field-character-ik-right-hand = Right hand
component-field-character-ik-right-hand-target = Target
component-field-character-ik-right-hand-weight = Weight
component-field-character-ik-right-hand-pole = Pole
component-field-character-ik-look = Look
component-field-character-ik-look-target = Target
component-field-character-ik-look-weight = Weight
component-field-character-ik-look-max-angle = Max angle
