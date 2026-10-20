# SPDX-License-Identifier: Apache-2.0

### The texts of the transform gizmo of the scene page (scene/gizmo).

## The mode buttons of the gizmo bar (gizmoBar.ts). $key is the key of the mode, for example "W".

gizmo-bar-label = Tools
gizmo-mode-view = View
gizmo-mode-view-title = View: select, move nothing ({ $key })
gizmo-mode-move = Move
gizmo-mode-move-title = Move ({ $key })
gizmo-mode-turn = Turn
gizmo-mode-turn-title = Turn ({ $key })
gizmo-mode-scale = Scale
gizmo-mode-scale-title = Scale ({ $key })

## The axes and the pivot buttons of the gizmo bar. The letters in the brackets are the keys of the buttons.

gizmo-space-title = The axes: world or local (L)
gizmo-space-world = World
gizmo-space-local = Local
gizmo-pivot-title = The pivot: each origin or the centre of the selection (P)
gizmo-pivot-pivot = Pivot
gizmo-pivot-centre = Centre

## The snaps of the gizmo bar: the switch of each snap and the title of its step field (with the unit).

gizmo-snap-grid = Grid
gizmo-snap-grid-step = Grid step (m)
gizmo-snap-angle = Angle
gizmo-snap-angle-step = Angle step (°)
gizmo-snap-scale = Scale
gizmo-snap-scale-step = Scale step (×)
gizmo-snap-surface = Surface
gizmo-snap-surface-title = A free move snaps to the surface under the pointer and to a socket within 8 cm

## The typed value of a drag. $axis is X, Y or Z, and $value is the text that the user types. The last character
## shows the text cursor.

gizmo-typed-move = Move: { $value }▏
gizmo-typed-move-axis = Move { $axis }: { $value }▏
gizmo-typed-turn = Turn: { $value }▏
gizmo-typed-turn-axis = Turn { $axis }: { $value }▏
gizmo-typed-scale = Scale: { $value }▏
gizmo-typed-scale-axis = Scale { $axis }: { $value }▏

## The page commands of the gizmo keys (startGizmo.ts) and the reasons why a command cannot run now.

gizmo-command-view = Gizmo: view (no gizmo)
gizmo-command-confirm = Gizmo drag: apply the typed value
gizmo-command-cancel = Gizmo drag: cancel
gizmo-command-move = Gizmo: move
gizmo-command-turn = Gizmo: turn
gizmo-command-scale = Gizmo: scale
gizmo-command-space = Gizmo: world or local axes
gizmo-command-pivot = Gizmo: pivot or centre
gizmo-command-type-axis = Type a value on the { $axis } axis
gizmo-refuse-fly = The editor camera flies.
gizmo-refuse-drag = A gizmo drag runs.
gizmo-refuse-no-entity = No entity to move.
