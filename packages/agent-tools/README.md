# @scenity/agent-tools

The agent tools of Scenity: `studio_state`, `scene_query`, `scene_commands`, `scene_command`,
`scene_batch`, `scene_frame`, `scene_measure`, `scene_pick`, `scene_sheet`, the `ui_*` tools and the job tools. Each tool
has a name, a description, a zod input schema and a handler that reaches an editor window through a `SurfacePort`. The
studio host and the workbench host run them.
