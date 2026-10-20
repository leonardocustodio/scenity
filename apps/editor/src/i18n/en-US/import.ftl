# SPDX-License-Identifier: Apache-2.0

### The texts of the import by drop on the scene of the lab page: the hint, the form, the list of the models and the
### refusals (src/core/importDrop).

## The layer over the scene (ImportDropLayer.vue).

import-hint = Drop a .glb, .gltf, .obj, .fbx or .blend file to place it here
import-title = Import { $name }
import-no-point = no drop point
import-point = at { $point } m
import-source = Source (a URL, a vendor or "made by me")
import-licence = Licence (for example CC0-1.0, or a store licence)
import-send = Import on the host
import-cancel = Cancel
import-model-title = { $name } at { $point } m
import-remove = Remove { $name }

## The models in the scene (previewStore.ts).

import-quick-label = preview, not optimized
import-no-preview = No preview of { $name }: { $error }

## The state and the refusals of a drop (useImportDrop.ts).

import-refused-format = { $name }: the lab imports { $formats } files
import-refused-size = { $name }: { $mb } MB, above the limit of 200 MB
import-refused-blender = { $name }: a Blender file needs the workbench host (Blender 5.2); the lab page alone shows .glb, .gltf, .obj and .fbx files
import-refused-app = { $name }: a drop of the app needs the workbench
import-sent = { $name }: sent to the host for the import
