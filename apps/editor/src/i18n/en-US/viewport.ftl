# SPDX-License-Identifier: Apache-2.0

### The texts of the viewport of the scene page (scene/viewport).

## The viewport bar (viewportBar.ts): the camera menu, the view mode menu, the grid switch and the Frame button.

viewport-bar = Viewport
viewport-camera = Camera
viewport-camera-title = Camera (0: editor, 1-9: document cameras)
viewport-camera-editor = Editor camera
# One document camera in the camera menu. $label is the name of the camera, and $number is its key (1 to 9).
viewport-camera-option = { $label } ({ $number })
viewport-view = View
viewport-view-title = View mode
viewport-mode-lit = Lit
viewport-mode-unlit = Unlit
viewport-mode-wireframe = Wireframe
viewport-mode-normals = Normals
viewport-grid = Grid
viewport-frame = Frame
viewport-frame-title = Frame the selection (F)

## The icons of the lights and the cameras (viewIcons.ts). $name is the name of the entity.

viewport-icon-light = { $name } (light)
viewport-icon-camera = { $name } (camera)

## The camera preview (previewInset.ts). $label is the name of the document camera.

viewport-preview = Preview: { $label }

## The page commands of the viewport keys (startViewport.ts) and the reasons why a command cannot run now.
## $number is the key of a document camera (1 to 9).

viewport-command-frame = Frame the selection
viewport-command-editor-camera = Open the editor camera
viewport-command-open-camera = Open document camera { $number }
viewport-refuse-fly = The editor camera flies.
viewport-refuse-no-camera = No document camera { $number }.

## The held keys of the camera (the key map).

viewport-held-camera-fly-forward = Fly forward (hold, with the right button)
viewport-held-camera-fly-back = Fly back (hold, with the right button)
viewport-held-camera-fly-left = Fly left (hold, with the right button)
viewport-held-camera-fly-right = Fly right (hold, with the right button)
viewport-held-camera-fly-down = Fly down (hold, with the right button)
viewport-held-camera-fly-up = Fly up (hold, with the right button)
viewport-held-camera-look-left = Turn the view left (hold)
viewport-held-camera-look-right = Turn the view right (hold)
viewport-held-camera-look-up = Tilt the view up (hold)
viewport-held-camera-look-down = Tilt the view down (hold)

viewport-change-pin = { $name }: { $change }, waits for review
overlay-menu = Overlays
overlay-menu-of = The menu of the overlay { $name }
overlay-fold = Fold
overlay-unfold = Unfold
overlay-hide = Hide
overlay-dock-top = Dock to the top
overlay-dock-right = Dock to the right
overlay-dock-bottom = Dock to the bottom
overlay-dock-left = Dock to the left
overlay-tools = Tools
overlay-tool-settings = Tool settings
overlay-view = View options
overlay-cameras = Cameras
overlay-grid = Grid and snap
overlay-orientation = Orientation
overlay-stats = Stats
overlay-agent = Agent
command-overlay-menu = The overlay menu
overlay-stats-fps = { $fps } fps
overlay-stats-entities = { $count ->
    [one] 1 entity
   *[other] { $count } entities
}
overlay-stats-selected = { $count } selected
overlay-agent-idle = No agent works now.
viewport-command-view-front = Front view
viewport-command-view-back = Back view
viewport-command-view-right = Right view
viewport-command-view-left = Left view
viewport-command-view-top = Top view
viewport-command-view-bottom = Bottom view
viewport-command-projection = Perspective or orthographic
viewport-projection-perspective = Persp
viewport-projection-orthographic = Ortho
viewport-projection-title = The projection of the editor camera (Alt+5)
viewport-axis-view = { $view }

## The split view of the Scene view: the layouts (Window ▸ Split view) and the bar of each pane. $pane is
## the number of a pane (1 is the main view).

viewport-command-split-one = One view
viewport-command-split-side = Two views side by side
viewport-command-split-stacked = Two views stacked
viewport-command-split-four = Four views
viewport-pane-camera = Camera of view { $pane }
viewport-pane-mode = View mode of view { $pane }
viewport-pane-perspective = Perspective view
viewport-pane-main = Main
viewport-pane-main-title = Put this view into the main view, and the main view here

## The onion skins of the Scene view.

view-onion-title = Onion skins: the selected entity at times round the clock (blue before, orange after)
view-onion-arg-on = True shows the onion skins; false hides them (default: the other state).

## The walks of an actor. $index is the number of a walk; $seconds is its start time.

walk-label = { $index } · { $seconds } s
walk-add-title = Add a walk of the actor to a stand point at a time
walk-arg-to = The stand point: an entity with a standPoint component.
walk-arg-t = The start time of the walk (ms).
walk-arg-entity = The actor (default: the selected entity).
walk-none = Select an actor and give a stand point.
# The debug layers of the core in the View options overlay.
viewport-debug-layers = Debug layers
