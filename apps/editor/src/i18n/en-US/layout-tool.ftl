# SPDX-License-Identifier: Apache-2.0

### The texts of the layout tools of the scene page (scene/layoutTools). The lines of a tool
### result and the reasons of a tool with no input come from @scenity/runtime-dev and stay in English.

## The tool menu (startLayoutTools.ts): the name of each tool, and its title with what the tool needs.

layout-tool-bar = Layout tools
layout-tool-readout = Readout
layout-tool-measure = Measure
layout-tool-measure-title = Measure: two selected entities or two picks
layout-tool-reach = Reach
layout-tool-reach-title = Reach: an entity with a character component or a stand point
layout-tool-clearance = Clearance
layout-tool-clearance-title = Clearance: one or more selected entities with a box
layout-tool-walk = Walk paths
layout-tool-walk-title = Walk paths: an entity with a locomotion component, or two entities
layout-tool-visibility = Visibility
layout-tool-visibility-title = Visibility: a target entity, and an eye entity or the camera
layout-tool-clear = Clear

## The readout. $index is the number of the next pick of the measure (1 or 2).

layout-tool-pick = Click a point on the canvas ({ $index } of 2).

## The page command of the Escape key and the reason why it cannot run now.

layout-tool-command-measure-clear = Clear the points of the measure
layout-tool-refuse-no-points = The measure has no points.
# A rule with the current value as its limit.
layout-tool-save-rule = Save as a rule
# The layout search.
layout-search = Find a place
layout-search-title = Search a place near the first selected entity where the rules of the scene pass
layout-search-apply = Apply
layout-search-apply-title = Find a place
layout-search-none = No place passes the rules near this entity.
layout-search-no-variant = The last search has no place { $id }.
