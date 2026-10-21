# The built-in components

The components of `@scenity/scene` with their fields. `bun tools/component-docs.ts` writes this page from the
registry; the inspector links the card of each component to its section. The format of the documents is in
[formats.md](formats.md).

## animator

Animator (Animation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `controller` | Controller | an object |  |
| `parameters` | Parameters | an object |  |
| `speed` | Speed | a number |  |
| `rootBone` | Root bone | a string |  |
| `rootMotion` | Root motion | one of `in-place`, `clip` |  |
| `footLock` | Foot lock | an object |  |
| `clipSource` | Clip source | an object |  |

## annotation

Annotation (General): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `text` | Text | a string |  |
| `colour` | Colour | a string or a list |  |
| `status` | Status | one of `open`, `done` |  |
| `task` | Task of the agent | a string |  |

## audioSource

Audio source (Audio): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `asset` | Sound | a string |  |
| `volume` | Volume | a number |  |
| `loop` | Loop | a boolean |  |
| `spatial` | Spatial | a boolean |  |
| `refDistance` | Reference distance | a number |  |
| `rolloff` | Rolloff | a number |  |
| `maxDistance` | Max distance | a number |  |
| `distanceModel` | Distance model | one of `linear`, `inverse`, `exponential` |  |
| `autoplay` | Autoplay | a boolean |  |

## camera

Camera (Render): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `fov` | Field of view | a number |  |
| `near` | Near | a number |  |
| `far` | Far | a number |  |
| `target` | Target | a list or a string |  |
| `safeFrame` | Safe frame | an object |  |

## character

Character (Animation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `rig` | Rig profile | a string |  |
| `bones` | Bones | an object |  |
| `variant` | Variant | a string |  |
| `variants` | Variants | an object |  |
| `ik` | IK goals | an object |  |

## environment

Environment (Scene): a field of the scene.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `background` | Background | a string or a list |  |
| `toneMapping` | Tone mapping | one of `none`, `linear`, `reinhard`, `cineon`, `aces`, `agx`, `neutral` |  |
| `exposure` | Exposure | a number |  |
| `map` | Environment map | a string |  |
| `mapIntensity` | Map intensity | a number |  |
| `fog` | Fog | an object |  |
| `ao` | Ambient occlusion | an object |  |
| `bloom` | Bloom | an object |  |
| `antialias` | Anti-aliasing | one of `none`, `fxaa`, `smaa`, `msaa` |  |
| `outline` | Selection outline | an object |  |

## light

Light (Render): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `type` | Type | one of `directional`, `point`, `spot`, `ambient`, `hemisphere` |  |
| `colour` | Colour | a string or a list |  |
| `groundColour` | Ground colour | a string or a list |  |
| `intensity` | Intensity | a number |  |
| `range` | Range | a number |  |
| `angle` | Angle | a number |  |
| `penumbra` | Penumbra | a number |  |
| `shadow` | Shadow | a boolean |  |
| `target` | Target | a list or a string |  |
| `shadowCamera` | Shadow camera | an object |  |
| `shadowBias` | Shadow bias | a number |  |
| `shadowNormalBias` | Shadow normal bias | a number |  |

## locomotion

Locomotion (Navigation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `speed` | Walk speed | a number |  |
| `turnSpeed` | Turn speed | a number |  |
| `parameter` | Speed parameter | a string |  |
| `walks` | Walks | a list of an object |  |

## model

Model (Render): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `asset` | Model | a string |  |
| `materials` | Material overrides | an object |  |
| `castShadow` | Cast shadow | a boolean |  |
| `receiveShadow` | Receive shadow | a boolean |  |
| `lod` | Levels of detail | an object |  |

## obstacle

Obstacle (Navigation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `footprint` | Footprint | `"bounds"` or an object |  |
| `height` | Height | a number |  |

## path

Path (Navigation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `points` | Points | a list of a list |  |
| `closed` | Closed | a boolean |  |
| `width` | Width | a number |  |

## pickable

Pickable (General): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `enabled` | Enabled | a boolean |  |
| `priority` | Priority | a whole number |  |
| `mode` | Hit test | one of `bounds`, `mesh` |  |
| `layers` | Layers | a list of a string |  |

## prefab

Prefab (General): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `source` | Prefab | a string |  |
| `overrides` | Overrides | a list of a value |  |

## shape

Shape (Render): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `kind` | Kind | one of `box`, `plane`, `cylinder`, `sphere` |  |
| `size` | Size | a list |  |
| `colour` | Colour | a string or a list |  |
| `roughness` | Roughness | a number |  |
| `metalness` | Metalness | a number |  |
| `material` | Material | a string |  |
| `castShadow` | Cast shadow | a boolean |  |
| `receiveShadow` | Receive shadow | a boolean |  |

## socket

Sockets (Place): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `points` | Points | an object |  |

## standPoint

Stand point (Navigation): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `facing` | Facing | a number |  |
| `role` | Role | a string |  |

## tags

Tags (General): a field of the entity.

## transform

Transform (Place): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `position` | Position | a list |  |
| `rotation` | Rotation | a list |  |
| `scale` | Scale | a list |  |

## visibility

Visibility (General): the components of an entity.

| Field | Label | Value | Description |
| --- | --- | --- | --- |
| `visible` | Visible | a boolean |  |
