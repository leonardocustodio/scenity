# SPDX-License-Identifier: Apache-2.0

### The texts of the metrics graph of the lab core (core/graph).

## The graph card on the scene of the lab page (LabGraph.vue) and the graph window (GraphPage.vue).

graph-open = Graph
graph-open-title = The metrics of the take over time
graph-card = Metrics graph
graph-metrics-of = Metrics of { $take }
graph-metrics-no-take = Metrics of no take
graph-measure-again = Measure the take again
graph-detach = Open in a window
graph-close = Close the graph
graph-page-linked = Follows the clock of the lab
graph-page-alone = Alone: a hidden lab measures the take
graph-page-take = Take

## The metrics graph (MetricsGraph.vue). The metric names, the units and the member IDs are data values.

graph-measuring = Measuring the take…
graph-source = { $count } samples from the { $source ->
        [index] frame index
        [link] linked lab
       *[sweep] sweep
    } in { $ms } ms
graph-drawn = drawn in { $ms } ms
graph-legend = Legend
graph-scene = scene
graph-verdict-pass = pass
graph-verdict-known = known gap
graph-verdict-fail = fail
graph-empty = No metric has a value in this take.
graph-lanes = The time of the clock on the metrics: press to seek, the arrow keys step
graph-lane = { $metric } of { $count } lines
graph-tip-at = { $metric } at { $seconds } s
graph-tip-scene = scene { $value }
graph-table = The worst value of each check
graph-table-check = Check
graph-table-worst = Worst
graph-table-limit = Limit
graph-table-at = At
graph-table-state = State
graph-state-pass = pass
graph-state-known = known
graph-state-fail = FAIL

## The errors that the graph shows (graphData.ts, useLabGraphData.ts).

graph-no-source = No lab and no index has the metrics of this take.
graph-lab-not-ready = The lab API is not ready.
