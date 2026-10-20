# SPDX-License-Identifier: Apache-2.0

### The texts of the material tab of the scene page (scene/material/; scene docks). Material names, asset
### references, file paths, texture names, material types, colour spaces and entity IDs are data values. The labels of
### the values, the groups, the texture slots and the parts come from @scenity/editor-core and stay in English.

## The open material (MaterialPanel.vue).

material-panel = Material
material-asset = Material asset
material-open = Open a material…
# $count is the count of the entities that use the material.
material-users =
    { $count ->
        [one] Used by { $count } entity
       *[other] Used by { $count } entities
    }
material-type = Type
material-type-label = Material type
material-name = Name
material-name-label = Material name
material-save = Save
material-new-name = New material name
material-new = New

## The assignment to a part of the selected entity. $part is the label of a part, $name the name of the material.

material-assign-section = Assign to a part
material-select-entity = Select an entity.
material-part = Part
material-part-this = { $part } (this material)
material-no-parts = The entity has no model or shape.
material-assign = Assign { $name }
material-assign-unnamed = Assign the material

## A value and a texture slot (MaterialValue.vue, TextureSlot.vue). $label is the label of a value, $axis is U or V.

material-hex = { $label } (hex)
# The sample of a hex colour in an empty colour field.
material-hex-sample = #rrggbb
material-reset = Reset { $label } to the default
material-texture-none = none
material-colour-space = Colour space
material-repeat = Repeat
material-repeat-axis = Repeat { $axis }
material-offset = Offset
material-offset-axis = Offset { $axis }

## The status line of the panel. $entity is an entity ID, $ref an asset reference, $reason the reason of a refusal.

material-assigned = Assigned to { $entity }.
material-assigned-part = Assigned to { $entity } ({ $part }).
material-created = New material { $ref }.
material-saved = Saved.
material-not-saved = Not saved: { $reason }
material-not-saved-changed = Not saved: the file changed on the disk

## The material editor of the page (pageMaterials.ts). The status line shows these errors.

# $status is the HTTP status code of the asset index request.
material-no-index = no asset index ({ $status })
material-not-found = the project has no material asset { $ref }
# $reason comes from the dev server (in English).
material-import-failed = the import failed: { $reason }
material-no-changes = No material has changes.

## The title of the assignment in the history. $part is the part name of the model.

material-assign-step = Assign a material to { $entity }
material-assign-step-part = Assign a material to { $entity } { $part }

## The labels of the material fields, groups and texture maps of @scenity/editor-core, by key.

material-field-colour = Colour
material-field-roughness = Roughness
material-field-metalness = Metalness
material-field-opacity = Opacity
material-field-alpha-test = Alpha test
material-field-side = Side
material-field-flat-shading = Flat shading
material-field-normal-scale = Normal scale
material-field-emissive = Emissive colour
material-field-emissive-intensity = Emissive intensity
material-field-clearcoat = Clear coat
material-field-clearcoat-roughness = Clear coat roughness
material-field-sheen = Sheen
material-field-sheen-colour = Sheen colour
material-field-sheen-roughness = Sheen roughness
material-field-transmission = Transmission
material-field-thickness = Thickness (m)
material-field-ior = IOR
material-field-iridescence = Iridescence
material-field-specular-intensity = Specular intensity
material-field-specular-colour = Specular colour
material-field-specular = Specular colour
material-field-shininess = Shininess

material-group-surface = Surface
material-group-emission = Emission
material-group-physical = Physical
material-group-phong = Phong

material-map-colour = Colour map
material-map-normal = Normal map
material-map-roughness = Roughness map
material-map-metalness = Metalness map
material-map-emissive = Emissive map
material-map-occlusion = Occlusion map
material-map-alpha = Alpha map

## The presets of the material editor, and the drop of a texture on a slot.

material-presets = Presets
material-preset-plastic = Plastic
material-preset-metal = Metal
material-preset-wood = Wood
material-preset-glass = Glass
material-preset-rubber = Rubber
material-preset-ceramic = Ceramic
material-texture-drop = Drop a texture here, or choose one
