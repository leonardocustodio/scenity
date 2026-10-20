# SPDX-License-Identifier: Apache-2.0
# The studio faces of the plugins.

plugin-error-title = { $name } of the plugin { $plugin } stopped with an error.
plugin-error-again = Try again
plugin-error-off = { $name } of the plugin { $plugin } is off: it stopped with an error { $count } times in a row.
plugin-error-on = Turn on
plugin-reloaded = The studio faces of the plugins loaded again ({ $count }) after a change of their code.
plugin-not-face = A studio face of a plugin is not an object from defineStudioPlugin.
plugin-bad-id = The ID of a studio face is not a lower-case word.
plugin-no-version = The studio face of { $id } has no apiVersion.
plugin-version-unknown = The studio face of { $id } has apiVersion { $version }; this editor takes { $current } and the one before. The editor does not load it.
plugin-version-old = The studio face of { $id } has the old apiVersion { $version }. It works; move it to { $current } (docs/plugins.md, "The studio face").
plugin-not-prefixed = The plugin { $id } has the contribution { $name }: its ID must start with "{ $prefix }".
plugin-load-failed = The studio faces of the plugins of { $project } did not load.
plugin-contribution-failed = { $name } of the plugin { $plugin } stopped with an error.

## The Plugins window.

plugins-restart = The plugins of the project changed. The window loads them after a reload.
plugins-reload = Reload
plugins-none = The project has no plugins.
plugins-remove = Remove
plugins-add = Add a plugin
plugins-checkout = The plugins of the checkout
plugins-add-button = Add
plugins-entry = A package name or a folder path
plugins-docs = The docs of the plugins
plugins-face-runtime = Runtime
plugins-face-host = Host
plugins-face-dev = Dev
plugins-face-studio = Studio
plugins-face-editor = Lab editor
plugins-face-cli = Commands

## The new plugin wizard.

plugins-new = A new plugin
plugins-new-id = The plugin ID (a lower-case word)
plugins-new-component = The component name
plugins-new-field = The name of the field
plugins-new-kind = The kind of the field
plugins-new-kind-number = Number
plugins-new-kind-boolean = Flag
plugins-new-kind-text = Text
plugins-new-add-field = Add a field
plugins-new-part-system = A system
plugins-new-part-presenter = A presenter (a three.js object)
plugins-new-part-simulation = A simulation (the action keys of a sequence)
plugins-new-part-metric = A metric of the rules
plugins-new-part-studio = A studio panel
plugins-new-make = Make the plugin
plugins-new-ask = Ask the agent to write it
plugins-new-prompt = Write the logic of the new plugin { $id } in plugins/{ $id }/: the system of the component { $component } (fields: { $fields }). Keep the files of the plugin; add tests; run scenity check.

## The Takes panel of a lab face in the studio
lab-takes-title = Takes
lab-takes-take = Take
lab-takes-time = Time
lab-takes-ms = { $time } ms
lab-takes-members = The members at this time
lab-takes-marks = The marks up to this time
lab-takes-none = None
lab-takes-note = A play of a take in the view needs the lab page of the plugin.
