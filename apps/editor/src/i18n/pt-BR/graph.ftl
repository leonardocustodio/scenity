# SPDX-License-Identifier: Apache-2.0

### Os textos do gráfico de métricas do núcleo do lab (core/graph).

## O cartão do gráfico sobre a cena da página do lab (LabGraph.vue) e a janela do gráfico (GraphPage.vue).

graph-open = Gráfico
graph-open-title = As métricas da tomada ao longo do tempo
graph-card = Gráfico de métricas
graph-metrics-of = Métricas de { $take }
graph-metrics-no-take = Métricas sem tomada
graph-measure-again = Medir a tomada de novo
graph-detach = Abrir em uma janela
graph-close = Fechar o gráfico
graph-page-linked = Segue o relógio do lab
graph-page-alone = Independente: um lab oculto mede a tomada
graph-page-take = Tomada

## O gráfico de métricas (MetricsGraph.vue). Os nomes das métricas, as unidades e os IDs dos membros são valores de
## dados.

graph-measuring = Medindo a tomada…
graph-source = { $count } amostras { $source ->
        [index] do índice de quadros
        [link] do lab vinculado
       *[sweep] da varredura
    } em { $ms } ms
graph-drawn = desenhado em { $ms } ms
graph-legend = Legenda
graph-scene = cena
graph-verdict-pass = aprovado
graph-verdict-known = lacuna conhecida
graph-verdict-fail = reprovado
graph-empty = Nenhuma métrica tem valor nesta tomada.
graph-lanes = O tempo do relógio nas métricas: pressione para saltar, as setas avançam em passos
graph-lane = { $metric } de { $count } linhas
graph-tip-at = { $metric } em { $seconds } s
graph-tip-scene = cena { $value }
graph-table = O pior valor de cada verificação
graph-table-check = Verificação
graph-table-worst = Pior
graph-table-limit = Limite
graph-table-at = Em
graph-table-state = Estado
graph-state-pass = aprovado
graph-state-known = conhecido
graph-state-fail = REPROVADO

## Os erros que o gráfico mostra (graphData.ts, useLabGraphData.ts).

graph-no-source = Nenhum lab e nenhum índice tem as métricas desta tomada.
graph-lab-not-ready = A API do lab não está pronta.
