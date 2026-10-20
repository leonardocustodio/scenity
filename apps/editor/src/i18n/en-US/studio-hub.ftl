# SPDX-License-Identifier: Apache-2.0

### The texts of the Hub of Scenity Studio (hub.html, src/hub).
### The file name is not "hub.ftl": a name of two or three small letters is a locale tag (@scenity/i18n resourcePath).

hub-title = Scenity Studio
hub-nav-label = Studio sections
hub-nav-projects = Projects
hub-nav-learn = Learn
hub-nav-agents = Agents
hub-nav-settings = Settings
hub-new-project = New project
hub-open = Open…
hub-cancel = Cancel
hub-close = Close
hub-safe = Safe mode: each project opens with no plugin code.
hub-role-viewer = View only: you look at the projects. The owner of the studio makes the changes.
hub-role-editor = Editor: you change the scenes. Only the owner of the studio trusts or removes a project.
hub-agent-state-ok = Claude is ready
hub-agent-state-warn = Claude needs a check
hub-agent-state-missing = No agent set up
hub-agent-state-checking = Checking the agent…
# $error is the message of the host.
hub-error = { $error }
hub-state-error = The studio host did not answer: { $error }

## The projects.

hub-search = Search projects
hub-sort = Sort
hub-sort-recent = Last opened
hub-sort-name = Name
hub-view = View
hub-view-cards = Cards
hub-view-list = List
hub-projects-empty-title = No projects yet
hub-projects-empty-body = Make a project from a template, or open a folder that holds a Scenity project.
hub-projects-none-found = No project matches the search.
hub-project-missing = Folder not found
hub-project-locate = Locate…
hub-project-remove = Remove from the list
hub-project-newer = Made with a newer Scenity. Update Scenity to open it.
hub-project-pinned = Pinned
# $name is the project name.
hub-project-menu = Actions for { $name }
hub-project-open = Open
hub-project-open-window = Open in a new window
hub-project-reveal = Reveal on the disk
hub-project-rename = Rename…
hub-project-pin = Pin
hub-project-unpin = Unpin
hub-project-trust = Trust this project
hub-project-template = Save as a template…
hub-template-save-title = Save as a template
hub-template-save-body = The template is a copy of the project folder with no build outputs and no local state. The new project wizard shows it after the built-in templates.
hub-template-save-name = Title
hub-template-save-about = Description
hub-template-save-go = Save the template
hub-template-saved = Saved the template { $title }. New project shows it.
# $when is the date and time of the last open.
hub-project-last = Opened { $when }
# $branch is the Git branch; $changed is the number of changed files.
hub-project-git = { $branch } · { $changed } changed
# $version is the major version of the project format.
hub-project-format = Format { $version }
hub-project-scenes =
    { $count ->
        [one] 1 scene
       *[other] { $count } scenes
    }
hub-project-restricted = Runs code: it opens restricted until you trust it.
hub-rename-title = Rename the project
hub-rename-name = Name
hub-rename-save = Rename

## The new project wizard.

hub-wizard-title = New project
hub-wizard-templates = Templates
hub-wizard-name = Name
hub-wizard-name-invalid = Use 1 to 64 letters, digits, - and _.
hub-wizard-place = Place
hub-wizard-choose = Choose…
hub-wizard-git = Make a Git repository
hub-wizard-packages = Scenity packages
hub-wizard-packages-linked = Link the packages of this checkout
hub-wizard-packages-npm = The published packages (npm)
hub-wizard-packages-sample = A sample links the packages of this checkout.
hub-wizard-make = Make
hub-wizard-making = Making the project…
hub-wizard-prompt = Describe what you want to make
hub-wizard-prompt-example = A small shop with three chairs and a warm light
hub-wizard-prompt-start = Start from the prompt
hub-wizard-prompt-about = The agent chooses a template and a name, makes the project and builds a first scene that waits for your review.
hub-wizard-choosing = The agent chooses a template…
hub-wizard-prompt-chosen = The template { $template }, the name { $name }
hub-wizard-failed = The project was not made.
hub-wizard-retry = Retry
hub-wizard-log = Log
hub-wizard-checkout-only = Needs a Scenity checkout
hub-template-empty = Empty
hub-template-empty-about = A floor, a box, two lights and a camera.
hub-template-showroom = Showroom
hub-template-showroom-about = Six furniture models, an HDR sky and three scenes.
hub-template-characters = Characters
hub-template-characters-about = A rigged robot that walks, waves and picks up a cup.
hub-template-walkthrough = Walkthrough
hub-template-walkthrough-about = Two robots and a mannequin meet on a plaza.
hub-template-sim-road = Road crossing
hub-template-sim-road-about = Cars and walkers with the traffic simulation.
hub-template-physics = Physics
hub-template-physics-about = Crates, a ball and a ramp with rigid bodies.
hub-template-spin = Spin plugin
hub-template-spin-about = A small project plugin: a component, a system and play input.
hub-template-gltf-samples = glTF samples
hub-template-gltf-samples-about = Khronos test models for materials and extensions.

## The folder dialog.

hub-folder-title = Choose a folder
hub-open-title = Open a project
hub-folder-up = Up
hub-folder-new = New folder
hub-folder-new-name = Folder name
hub-folder-make = Make
hub-folder-choose = Choose this folder
hub-folder-project = Project
hub-folder-open-project = Open this project
hub-folder-make-project = Make this folder a project
hub-folder-empty = No folders here.
hub-folder-list = The folders of { $path }
hub-clone = Clone from Git…
hub-clone-url = Repository URL (HTTPS or SSH)
hub-clone-folder = Folder name
hub-clone-start = Clone
hub-clone-running = Cloning…
hub-clone-failed = The clone failed.

## Learn.

hub-learn-samples = Samples
hub-learn-samples-body = A sample opens as a copy in a folder that you choose; the sample itself never changes.
hub-learn-copy = Open a copy
hub-learn-docs = Docs
hub-ask-title = Ask how to do something
hub-ask-placeholder = For example: how do I add a light?
hub-ask-go = Ask
hub-ask-none = No part of the docs matches. Try other words, or open one of the docs below.
hub-ask-tutorial = Tutorial: { $title }
hub-ask-tutorial-open = Open a project, then choose Help → Tutorials.
hub-ask-start = Start in { $project }
hub-doc-studio = Scenity Studio
hub-doc-quickstart = Quickstart
hub-doc-editor = The editor
hub-doc-formats = Document formats
hub-doc-plugins = Plugins
hub-doc-cli = The scenity command
hub-learn-tutorials = Tutorials
hub-learn-tutorials-body = Open a project, then choose Help → Tutorials: your first scene, a prefab and a sequence. Each step points at its part of the window and goes on when you do it. In the Agent panel, ask "show me how" for any task.
hub-learn-new = What is new
hub-learn-new-body = Scenity Studio puts the projects, the templates, the jobs and the agents in one place: an agent works in the editor beside you, and you review its changes.

## Agents.

hub-agents-claude = Claude on this machine
hub-agents-claude-body = The built-in agent uses the Claude Code login of this machine or an API key.
hub-agents-external = External agents
hub-agents-external-body = Claude Code, Codex, Cursor and Claude Desktop connect to the studio over MCP: add the line of your app once. At its first call the studio asks you to allow it (the agent panel of the project); its changes then wait for review as the changes of any agent.
hub-agents-setup-claude-code = Claude Code (in a terminal)
hub-agents-setup-codex = Codex (in a terminal)
hub-agents-setup-cursor = Cursor (.cursor/mcp.json)
hub-agents-setup-claude-desktop = Claude Desktop (claude_desktop_config.json)
hub-agents-copy = Copy
hub-agents-copied = Copied
hub-clients-title = Connections
hub-clients-none = No external agent asked to connect yet.
hub-clients-pending = asks to connect
hub-clients-allowed = connected
hub-clients-denied = denied
hub-clients-project = Project
hub-clients-allow = Allow
hub-clients-deny = Deny
hub-clients-revoke = Revoke
hub-clients-name = The name of the app
hub-clients-http = Connect over HTTP
hub-clients-token-once = The token of { $name } shows only now. Copy the line into the app; Revoke takes the token back.
hub-agents-defaults = Defaults of new sessions
hub-agents-mode = Permission mode
hub-mode-ask = Ask: the agent reads and answers
hub-mode-review = Review: edits wait for you
hub-mode-auto = Auto: edits apply at once; undo stays
hub-agents-budget = Budget of a session (US dollars)
hub-agents-none = Every feature works with no agent.
hub-agents-usage = Today: ${ $cost } and { $tokens } tokens of the agents.
hub-agents-recipes = Recipes
hub-agents-recipes-body = Saved prompts with parameters: run one from the search box (⌘K), the Agent menu or / in the agent panel. Your recipes are in recipes.json of the studio folder; a project keeps its own in .scenity/recipes.
hub-recipe-project = Project of a run
hub-recipe-run = Run in the project
hub-recipe-edit = Change
hub-recipe-remove = Remove
hub-recipe-new = New recipe
hub-recipe-title = Title
hub-recipe-prompt = Prompt
hub-recipe-prompt-hint = Each {"{"}name{"}"} of the prompt is a field that the run asks for.
hub-recipe-save = Save the recipe
hub-agents-recipe-studio = from the studio
hub-agents-recipe-user = yours
hub-agents-recipe-project = from the project
hub-agents-kinds = Each kind of action
hub-agents-kinds-body = A value here tightens the mode of each session: the stricter value wins. Git is always the owner's only.
hub-agents-kind-default = As the mode
hub-agents-kind-allow = Allow
hub-agents-kind-ask = Ask
hub-agents-kind-deny = Deny
hub-agents-kind-name-scene = Scene edits
hub-agents-kind-name-files = File writes
hub-agents-kind-name-runs = Runs and jobs
hub-agents-kind-name-imports = Imports and downloads
hub-agents-kind-name-network = Network

## Settings and the doctor.

hub-settings-theme = Theme
hub-theme-dark = Dark
hub-theme-light = Light
hub-theme-navy = Navy
hub-settings-contrast = High contrast
hub-settings-language = Language
hub-settings-recent = Recent projects to keep
hub-doctor-title = This machine
hub-doctor-ok = Ready
hub-doctor-warn = Check
hub-doctor-missing = Missing
# $what is the list of the parts that need the tool.
hub-doctor-needed = Needed for: { $what }
hub-doctor-running = Running…
hub-doctor-webgpu = WebGPU in this browser
hub-doctor-webgpu-ok = WebGPU works: the editor draws with it.
hub-doctor-webgpu-no = No WebGPU: the editor draws with WebGL.
hub-doctor-check-bun = Bun
hub-doctor-check-git = Git
hub-doctor-check-blender = Blender
hub-doctor-check-chromium = Chromium for pictures
hub-doctor-check-claude = Claude

## The first run.

hub-first-title = Welcome to Scenity Studio
hub-first-body = Make 3D scenes, check them and ship a small web player, with agents that work next to you.
# $n is the number of the step; $total is the number of steps.
hub-first-step = Step { $n } of { $total }
hub-first-look = Look and language
hub-first-agent = Connect an agent
hub-first-agent-claude = The Claude login of this machine
hub-first-agent-key = An API key
hub-first-agent-later = You set up the agent in Agents after the last step.
hub-first-agent-external = An external agent over MCP
hub-first-agent-none = No agent for now
hub-first-doctor = Check this machine
hub-first-next = Next
hub-first-back = Back
hub-first-skip = Skip
hub-first-done = Start
