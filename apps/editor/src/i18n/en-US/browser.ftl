# SPDX-License-Identifier: Apache-2.0

### The texts of the dock under the scene of the lab page: the content browser, its header, its tree, its grid and
### its timeline parts (src/core/browser).

## The dock and its header (LabDock.vue, DockHeader.vue).

browser-dock-title = Content browser
browser-dock-title-item = Content browser · { $item }
browser-dock-tabs = Tabs of the dock
browser-dock-open = Open the dock (Shift+B)
browser-dock-close = Close the dock (Shift+B)
browser-dock-parts = Parts of the dock
browser-dock-reset = The default layout of the dock
browser-dock-detach = Open the content browser in a window
browser-tab-assets = Assets

## The parts of the dock. The header and the side panels show and hide them.

browser-part-timeline = Timeline
browser-folders = Folders
browser-part-browser = Browser
browser-part-show-timeline = Show the timeline
browser-part-hide-timeline = Hide the timeline
browser-part-show-folders = Show the folders
browser-part-hide-folders = Hide the folders
browser-part-show-browser = Show the browser (B)
browser-part-hide-browser = Hide the browser (B)

## The resize handles (ResizeHandle.vue). The label goes to the screen reader, the title shows on hover.

browser-dock-height = The height of the dock: drag, or the arrow keys; double press for the default size
browser-dock-height-title = The height of the dock (drag; double press: the default size)
browser-tree-width = The width of the folders: drag, or the arrow keys; double press for the default size
browser-tree-width-title = The width of the folders (drag; double press: the default size)

## The tree of folders (DockTree.vue).

browser-tree-open = Open the folder
browser-tree-close = Close the folder

## The bar over the grid: the path, the search and the filters (DockBreadcrumb.vue).

browser-up = Up one level
browser-up-title = Up one level (Backspace)
browser-path = Path
browser-content = Content
browser-search = Search the content
browser-search-placeholder = Search (/)
browser-filters = Filters
browser-filter-status = Status
browser-filter-priority = Priority
browser-filter-kind = Kind
browser-filter-layer = Layer
browser-filter-scene = Scene
browser-filter-any = any
browser-filters-clear = Clear the filters

## The grid of tiles and its status line (DockGrid.vue).

browser-recent = Recent
browser-no-match = Nothing matches the search and the filters.
browser-empty = This folder is empty.
browser-count-items =
    { $count ->
        [one] { $count } items
       *[other] { $count } items
    }
browser-count-playable =
    { $count ->
        [one] { $count } play in the lab
       *[other] { $count } play in the lab
    }
browser-count-captured = { $count } captured
browser-count-drawn = { $count } drawn
browser-count-none = { $count } no motion

## A tile of the grid (DockTile.vue, dockUi.ts). The status words describe the motion of a clip.

browser-clip-capture = captured clip
browser-clip-proc = drawn by the pose model
browser-clip-generic = the shared pose of its family
browser-clip-none = no motion yet
browser-not-in-lab = not in the lab
browser-tile-not-playable = not in the lab yet
browser-tile-family-scene = plays the scene of its family
browser-tile-no-picture = no picture: bun run labs stills { $key }
browser-tile-stale-picture = the picture is stale: bun run labs stills { $key }
browser-tile-stale = stale
browser-tile-family = family
browser-tile-family-title = Plays the scene of its family: the pose model does not name this clip yet

## The frame strip of the timeline (DockStrip.vue).

browser-strip-frame = Frame at { $time }
browser-strip-frame-title = { $time } — press: go there; Shift: set the loop
browser-strip-zoom = Frames in the strip
browser-strip-slots =
    { $count ->
        [one] { $count } frames
       *[other] { $count } frames
    }
browser-strip-full = Every frame is there
browser-strip-fill-title =
    { $count ->
        [one] Capture the { $count } empty frames now
       *[other] Capture the { $count } empty frames now
    }
browser-strip-fill = Fill
browser-strip-refresh = Refresh the frames
browser-strip-refresh-title = Refresh the frames (drop the cached frames of this strip)

## The clip lanes of the timeline (DockLanes.vue).

browser-lanes-live-empty = No lanes yet: play the window or fill the strip.
browser-lanes-empty = No member works in the window.
browser-lanes-tracks = The tracks of { $item } (preset.md) against the lanes:
browser-lanes-drawn = A lane of the window draws it
browser-lanes-missing = No lane of the window draws it
