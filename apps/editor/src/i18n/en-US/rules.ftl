# SPDX-License-Identifier: Apache-2.0

### The texts of the rules panel and the rule graph (core/rules/, shared by the lab and the scene page) and of the
### rules tab of the scene page (scene/rules/; scene docks). Rule IDs, metric names, entity IDs, sequence and
### marker names, source files and values with their units are data values. The limit text ($limit) and the words of
### a result ($detail, $reason) come from @scenity/rules and stay in English.

## The result of a rule. $status is pass, fail, known, error or n/a.

rules-status =
    { $status ->
        [pass] ok
        [fail] fail
        [known] known
        [error] error
       *[other] n/a
    }

## A row of the panel: the result, the rule ID, the value of the worst time and the limit. $value is a number with its
## unit, or a dash.

rules-row = { rules-status } { $id } { $value } · { $limit }
rules-row-provisional = { rules-status } { $id } { $value } · { $limit } (provisional)
# The reason of a known gap of a rule.
rules-known = known: { $reason }

## The head line: the count of the rules and the count of each result.

rules-summary-none = No rules
# $parts is the list of the counts of each result (rules-count).
rules-summary =
    { $count ->
        [one] { $count } rule: { $parts }
       *[other] { $count } rules: { $parts }
    }
# $status is pass, fail, known, error or n/a.
rules-count =
    { $status ->
        [pass] { $count } pass
        [fail] { $count } fail
        [known] { $count } known
        [error] { $count } error
       *[other] { $count } n/a
    }

## The scope of a rule in words. $entities, $sequence and $markers are data values; $from and $to are times in ms.

rules-scope-scene = scene
rules-scope-file = file
rules-scope-entity = entity { $entities }
rules-scope-sequence = sequence { $sequence }
rules-scope-sequence-open = sequence
rules-scope-range = range { $from } to { $to }
rules-scope-marker = marker { $markers }

## The level of a rule, and the level filter.

rules-level-block = block
rules-level-warn = warn
rules-level-all = all

## The panel (RulesPanel.vue).

rules-less = less
rules-more = more
rules-checking = checking…
rules-filter = Filter
rules-failed-only = Failed only
rules-level = Level
rules-list = Rules
# $source is the file of the rules (a data value).
rules-checks-of = Checks of { $source }

## The metric graph of a rule (RuleGraph.vue). $id is the rule ID, $t a time in ms.

rules-graph-sampling = Sampling the rule…
rules-graph-empty = Pick a rule with a sequence scope to see its value over time.
rules-graph-samples = { $count } samples
rules-graph-slider = { $id } over the sequence time: press to seek, the arrow keys step
# The title of a check point. $status is pass, fail, known, error or n/a.
rules-graph-check =
    { $status ->
        [pass] { $value } at { $t } ms: pass
        [fail] { $value } at { $t } ms: fail
        [known] { $value } at { $t } ms: known
        [error] { $value } at { $t } ms: error
       *[other] { $value } at { $t } ms: n/a
    }

## The rules tab of the scene page (scene/rules/).

rules-tab = Rules
rules-core-stopped = the scene core stopped before the rule check

## The tooltip of a rule row: the rule ID and the detail of its result (the detail comes from @scenity/rules).

rules-row-title = { $id }: { $detail }
problem-asset-missing = { $name } uses the asset { $asset }, which the project does not have
problem-asset-missing-detail = Import the asset, build the assets again, or choose another asset in the inspector.
## The problems of the asset database and their fixes.
problem-db-bad-record = The asset record { $file } does not read
problem-db-duplicate-id = The asset record { $file } has the ID of another record
problem-db-missing-source = The source of the asset record { $file } is missing
problem-db-missing-file = A file of the source of { $file } is missing
problem-db-broken-reference = { $file } uses an asset that the project does not have
problem-db-bad-document = The document { $file } does not read
problem-db-missing-document = The project lists the document { $file }, which does not exist
problem-fix-relink-source = Relink to { $path }
problem-fix-relink-asset = Relink to { $name } ({ $kind })
problem-fix-new-id = Give it a new ID
problem-fix-failed = The fix failed
problem-component-unknown = { $name } has the component { $component }, which no plugin gives
problem-component-unknown-detail = Add the plugin of the component to the project, or remove the component.
problem-component-remove = Remove the component
panel-problems = Problems
problems-kind = Kind
problems-kind-all = All kinds
problems-kind-rule = Rule
problems-kind-budget = Budget
problems-kind-asset = Asset
problems-kind-rights = Rights
problems-kind-component = Component
problems-kind-schema = Schema
problems-kind-plugin = Plugin
problems-kind-build = Build
problems-counts = { $errors ->
    [one] 1 error
   *[other] { $errors } errors
} · { $warnings ->
    [one] 1 warning
   *[other] { $warnings } warnings
}
problems-refresh = Check again
problems-none = No problem.
problems-list = The problems
problems-level-error = Error
problems-level-warn = Warning
problems-go = Go to
problems-ask = Ask the agent to fix
problem-ask-prompt = Fix this problem of the scene: { $title }. { $detail }
problem-rights = The rights of the asset { $asset } stop a release ({ $count ->
    [one] 1 entity uses it
   *[other] { $count } entities use it
})
problem-unbuilt = { $count ->
    [one] 1 asset has no build
   *[other] { $count } assets have no build
}
problem-unbuilt-detail = Run scenity assets build (or ask the agent): { $assets }

## The rules editor.
rules-edit = Rules editor
rules-edit-new = New rule
rules-edit-open = Edit the rule
rules-edit-file = File
rules-edit-new-file = A new rules file
rules-edit-new-path = Path
rules-edit-id = Rule ID
rules-edit-id-sample = lampAboveFloor
rules-edit-metric = Metric
rules-edit-args = Arguments of the metric
rules-edit-min = Min
rules-edit-max = Max
rules-edit-unit = Unit
rules-edit-level = Level
rules-edit-level-warn = Warn
rules-edit-level-block = Block a save
rules-edit-provisional = Provisional
rules-edit-scope = Scope
rules-edit-scope-default = As the file
rules-edit-scope-scene = The scene
rules-edit-scope-sequence = Each marker and key
rules-edit-scope-range = A time range
rules-edit-scope-marker = Markers
rules-edit-scope-entity = Entities
rules-edit-from = From
rules-edit-to = To
rules-edit-step = Step (ms)
rules-edit-marker = Marker names
rules-edit-entity = Entities
rules-edit-note = Note
rules-edit-save = Save the rule
rules-edit-remove = Remove the rule
rules-edit-cancel = Cancel
rules-edit-bad = The rule does not read: { $where }
rules-edit-same-id = Another rule of the file has the ID { $id }.
rules-edit-title = Rules
rules-edit-no-sequence = The page has no sequence.
rules-edit-failed = The write of the rules failed.

## The rules log.
rules-log = Overrides of the rules
rules-log-none = No save of this scene went past a failed rule.
rules-log-current = Counts now (the file has this hash)
rules-log-old = Old (the file changed after it)

## The check job.
check-run = Run scenity check
check-failed = scenity check gave no report
problem-check = scenity check: { $rule } fails in { $scene } at { $time }
check-compare-same = scenity check gives the same results for the { $count } rules of this scene.
check-compare-differs = scenity check differs for { $rules }.

## The Performance panel.
panel-performance = Performance
perf-frame = Frame statistics
perf-no-stats = The core gives no statistics yet.
perf-switches = Render
perf-tier = Tier
perf-backend = Backend
perf-worker = Render worker
perf-reload = Reload to use the new render settings
perf-costs = Cost of each entity
perf-cost-entity = Entity
perf-cost-triangles = Triangles
perf-cost-draws = Draw calls
perf-cost-meshes = Meshes
perf-stat-mode = Thread
perf-stat-tier = Quality tier
perf-stat-frames = Frames
perf-stat-intervalP50 = Frame time (median)
perf-stat-intervalP95 = Frame time (95 %)
perf-stat-workP50 = Work (median)
perf-stat-workP95 = Work (95 %)
perf-stat-updateP95 = Update (95 %)
perf-stat-renderP95 = Render calls (95 %)
perf-stat-poseP95 = Poses (95 %)
perf-stat-memory = GPU memory (geometries · textures · programs)
perf-stat-heapMb = JS heap
perf-stat-drawCalls = Draw calls
perf-stat-triangles = Triangles
perf-stat-entities = Entities
perf-stat-instances = Instanced entities
perf-stat-visibleEntities = Entities in the view
perf-stat-effects = Effects
perf-stat-assets = Assets
perf-stat-loads = Loads ready
perf-stat-failures = Asset failures
perf-stat-gpu = GPU time
perf-stat-backend = Backend
perf-stat-backendReason = Reason of the backend
perf-stat-backendChosen = Backend asked for
perf-stat-other = { $key }

## The bench runner.
panel-bench = Bench
bench-run = Run the bench
bench-running = The bench runs…
bench-quick = Quick (short windows)
bench-done = The run is done
bench-failed = The run failed: see the log
bench-runs = { $count ->
    [one] 1 run in the history
   *[other] { $count } runs in the history
}
bench-last = The last run: { $date }, tier { $tier }
bench-passed = Each value of each budget passes.
bench-result-pass = Passes
bench-result-over = Over the budget
bench-result-not-measured = Not measured
bench-result-not-judged = Not judged
bench-trend = The trend of the runs

## The Build window.
panel-build = Build
build-out = Output folder
build-run = Run the build
build-running = The build runs…
build-open = Open the built player
build-passed = The build passes its budgets and its gate
build-failed = The build failed: see the report
build-entries = Entries of the player
build-entry = Entry
build-size = Size (gzip)
build-budget = Budget (KB)
build-budget-of = The budget of { $id } in KB
build-entry-result = Result
build-entry-ok = Within the budget
build-entry-exceeded = Over the budget
build-entry-exception = Over the budget, with a known exception
build-entry-no-budget = No budget
build-save-budgets = Save the budgets
build-budgets-saved = The project has the new budgets. Run the build to check them.
build-budget-bad = The budget of { $id } is not a size in KB.
build-gate = Marker gate
build-gate-clean = No dev or lab code in the build.

## The player preview and the embed snippets.
panel-embed = Embed
embed-base = Public URL
embed-scene = Scene
embed-sequence = Sequence
embed-camera = Camera
embed-default = As the project
embed-autoplay = Autoplay
embed-loop = Loop
embed-muted = Muted
embed-kinds = Kind of snippet
embed-kind-element = Web component
embed-kind-script = Script tag
embed-kind-vue = Vue
embed-copy = Copy the snippet
embed-copied = Copied
embed-preview = Preview of the built player
embed-reload = Reload

## The shots and the baselines.
panel-baselines = Shots
shots-camera = Camera (empty: the scene camera)
shots-at = Time (ms)
shots-size = Size
shots-take = Take a shot
shots-taking = The shot runs…
shots-verify = Run verify
shots-verifying = Verify runs…
shots-shots = Shots
shots-baseline = Add as a baseline
shots-baseline-confirm = Confirm: replace the baseline
shots-baseline-added = { $path } is the new baseline.
shots-poster = Set as the poster
shots-poster-set = { $path } is the poster of the scene. Save the scene to keep it.
shots-poster-title = Poster
shots-baselines = Baselines of { $platform }
shots-diff = Show the difference of a failed baseline
shots-same = Same
shots-differs = Differs

## The render queue.
panel-renderQueue = Render queue
render-kind = Kind of render
render-kind-clip = Clip
render-kind-sheet = Contact sheet
render-range = Time range (ms)
render-cell = Cell width (px)
render-fps = Frames per second
render-add = Add to the queue
render-queue = Queue
render-state-waiting = Waits
render-state-running = Runs…
render-state-done = Done
render-state-failed = Failed
render-outputs = Outputs

## The publish.
publish = Publish
publish-zip = Publish as a ZIP archive
publish-running = The publish runs…
publish-hint = The release check of the assets runs first.
publish-done = The archive has { $files } files ({ $kb } KB).
publish-download = Download the archive
publish-send = Send to { $target }
publish-stopped = The release check stops the publish:
