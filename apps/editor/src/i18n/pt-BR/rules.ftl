# SPDX-License-Identifier: Apache-2.0

### Os textos do painel de regras e do gráfico de regras (core/rules/, compartilhados pelo lab e pela página da cena) e
### da aba de regras da página da cena (scene/rules/; docks da cena). IDs de regras, nomes de métricas, IDs de
### entidades, nomes de sequências e de marcadores, arquivos de origem e valores com suas unidades são valores de dados.
### O texto do limite ($limit) e as palavras de um resultado ($detail, $reason) vêm de @scenity/rules e ficam em inglês.

## O resultado de uma regra. $status é pass, fail, known, error ou n/a.

rules-status =
    { $status ->
        [pass] ok
        [fail] falha
        [known] conhecida
        [error] erro
       *[other] n/a
    }

## Uma linha do painel: o resultado, o ID da regra, o valor do pior momento e o limite. $value é um número com sua
## unidade, ou um traço.

rules-row = { rules-status } { $id } { $value } · { $limit }
rules-row-provisional = { rules-status } { $id } { $value } · { $limit } (provisória)
# O motivo de uma falha conhecida de uma regra.
rules-known = conhecida: { $reason }

## A linha de cabeçalho: a contagem das regras e a contagem de cada resultado.

rules-summary-none = Nenhuma regra
# $parts é a lista das contagens de cada resultado (rules-count).
rules-summary =
    { $count ->
        [one] { $count } regra: { $parts }
       *[other] { $count } regras: { $parts }
    }
# $status é pass, fail, known, error ou n/a.
rules-count =
    { $status ->
        [pass] { $count } ok
        [fail] { $count } com falha
        [known] { $count } com falha conhecida
        [error] { $count } com erro
       *[other] { $count } n/a
    }

## O escopo de uma regra em palavras. $entities, $sequence e $markers são valores de dados; $from e $to são tempos em ms.

rules-scope-scene = cena
rules-scope-file = arquivo
rules-scope-entity = entidade { $entities }
rules-scope-sequence = sequência { $sequence }
rules-scope-sequence-open = sequência
rules-scope-range = intervalo de { $from } a { $to }
rules-scope-marker = marcador { $markers }

## O nível de uma regra, e o filtro de nível.

rules-level-block = bloqueio
rules-level-warn = aviso
rules-level-all = todos

## O painel (RulesPanel.vue).

rules-less = menos
rules-more = mais
rules-checking = verificando…
rules-filter = Filtro
rules-failed-only = Só com falha
rules-level = Nível
rules-list = Regras
# $source é o arquivo das regras (um valor de dados).
rules-checks-of = Verificações de { $source }

## O gráfico de métrica de uma regra (RuleGraph.vue). $id é o ID da regra, $t um tempo em ms.

rules-graph-sampling = Amostrando a regra…
rules-graph-empty = Escolha uma regra com escopo de sequência para ver o valor dela ao longo do tempo.
rules-graph-samples = { $count } amostras
rules-graph-slider = { $id } ao longo do tempo da sequência: pressione para posicionar, as teclas de seta avançam um passo
# O título de um ponto de verificação. $status é pass, fail, known, error ou n/a.
rules-graph-check =
    { $status ->
        [pass] { $value } em { $t } ms: ok
        [fail] { $value } em { $t } ms: falha
        [known] { $value } em { $t } ms: conhecida
        [error] { $value } em { $t } ms: erro
       *[other] { $value } em { $t } ms: n/a
    }

## A aba de regras da página da cena (scene/rules/).

rules-tab = Regras
rules-core-stopped = o núcleo da cena parou antes da verificação das regras

## A dica de uma linha de regra: o ID da regra e o detalhe do seu resultado (o detalhe vem de @scenity/rules).

rules-row-title = { $id }: { $detail }
problem-asset-missing = { $name } usa o asset { $asset }, que o projeto não tem
problem-asset-missing-detail = Importe o asset, gere o build dos assets de novo ou escolha outro asset no inspetor.
## Os problemas do banco de dados de assets e suas correções.
problem-db-bad-record = Não é possível ler o registro de asset { $file }
problem-db-duplicate-id = O registro de asset { $file } tem o ID de outro registro
problem-db-missing-source = Falta a origem do registro de asset { $file }
problem-db-missing-file = Falta um arquivo da origem de { $file }
problem-db-broken-reference = { $file } usa um asset que o projeto não tem
problem-db-bad-document = Não é possível ler o documento { $file }
problem-db-missing-document = O projeto lista o documento { $file }, que não existe
problem-fix-relink-source = Vincular de novo a { $path }
problem-fix-relink-asset = Vincular de novo a { $name } ({ $kind })
problem-fix-new-id = Dar um novo ID
problem-fix-failed = A correção falhou
problem-component-unknown = { $name } tem o componente { $component }, que nenhum plugin fornece
problem-component-unknown-detail = Adicione o plugin do componente ao projeto ou remova o componente.
problem-component-remove = Remover o componente
panel-problems = Problemas
problems-kind = Tipo
problems-kind-all = Todos os tipos
problems-kind-rule = Regra
problems-kind-budget = Orçamento
problems-kind-asset = Asset
problems-kind-rights = Direitos
problems-kind-component = Componente
problems-kind-schema = Esquema
problems-kind-plugin = Plugin
problems-kind-build = Build
problems-counts = { $errors ->
    [one] { $errors } erro
   *[other] { $errors } erros
} · { $warnings ->
    [one] { $warnings } aviso
   *[other] { $warnings } avisos
}
problems-refresh = Verificar de novo
problems-none = Nenhum problema.
problems-list = Os problemas
problems-level-error = Erro
problems-level-warn = Aviso
problems-go = Ir para
problems-ask = Pedir ao agente para corrigir
problem-ask-prompt = Corrija este problema da cena: { $title }. { $detail }
problem-rights = Os direitos do asset { $asset } impedem uma release ({ $count ->
    [one] { $count } entidade o usa
   *[other] { $count } entidades o usam
})
problem-unbuilt = { $count ->
    [one] { $count } asset não tem build
   *[other] { $count } assets não têm build
}
problem-unbuilt-detail = Execute scenity assets build (ou peça ao agente): { $assets }

## O editor de regras.
rules-edit = Editor de regras
rules-edit-new = Nova regra
rules-edit-open = Editar a regra
rules-edit-file = Arquivo
rules-edit-new-file = Um novo arquivo de regras
rules-edit-new-path = Caminho
rules-edit-id = ID da regra
rules-edit-id-sample = lampAboveFloor
rules-edit-metric = Métrica
rules-edit-args = Argumentos da métrica
rules-edit-min = Mín.
rules-edit-max = Máx.
rules-edit-unit = Unidade
rules-edit-level = Nível
rules-edit-level-warn = Avisar
rules-edit-level-block = Bloquear o salvamento
rules-edit-provisional = Provisória
rules-edit-scope = Escopo
rules-edit-scope-default = Como o arquivo
rules-edit-scope-scene = A cena
rules-edit-scope-sequence = Cada marcador e chave
rules-edit-scope-range = Um intervalo de tempo
rules-edit-scope-marker = Marcadores
rules-edit-scope-entity = Entidades
rules-edit-from = De
rules-edit-to = Até
rules-edit-step = Passo (ms)
rules-edit-marker = Nomes dos marcadores
rules-edit-entity = Entidades
rules-edit-note = Nota
rules-edit-save = Salvar a regra
rules-edit-remove = Remover a regra
rules-edit-cancel = Cancelar
rules-edit-bad = Não é possível ler a regra: { $where }
rules-edit-same-id = Outra regra do arquivo tem o ID { $id }.
rules-edit-title = Regras
rules-edit-no-sequence = A página não tem sequência.
rules-edit-failed = A escrita das regras falhou.

## O log das regras.
rules-log = Substituições das regras
rules-log-none = Nenhum salvamento desta cena passou por cima de uma regra com falha.
rules-log-current = Vale agora (o arquivo tem este hash)
rules-log-old = Antigo (o arquivo mudou depois)

## O job de verificação.
check-run = Executar scenity check
check-failed = scenity check não gerou relatório
problem-check = scenity check: { $rule } falha em { $scene } no tempo { $time }
check-compare-same = scenity check dá os mesmos resultados para as { $count } regras desta cena.
check-compare-differs = scenity check difere em { $rules }.

## O painel Desempenho.
panel-performance = Desempenho
perf-frame = Estatísticas dos quadros
perf-no-stats = O núcleo ainda não fornece estatísticas.
perf-switches = Renderização
perf-tier = Nível
perf-backend = Backend
perf-worker = Worker de renderização
perf-reload = Recarregue para usar as novas configurações de renderização
perf-costs = Custo de cada entidade
perf-cost-entity = Entidade
perf-cost-triangles = Triângulos
perf-cost-draws = Draw calls
perf-cost-meshes = Malhas
perf-stat-mode = Thread
perf-stat-tier = Nível de qualidade
perf-stat-frames = Quadros
perf-stat-intervalP50 = Tempo de quadro (mediana)
perf-stat-intervalP95 = Tempo de quadro (95 %)
perf-stat-workP50 = Trabalho (mediana)
perf-stat-workP95 = Trabalho (95 %)
perf-stat-updateP95 = Atualização (95 %)
perf-stat-renderP95 = Chamadas de renderização (95 %)
perf-stat-poseP95 = Poses (95 %)
perf-stat-memory = Memória da GPU (geometrias · texturas · programas)
perf-stat-heapMb = Heap do JS
perf-stat-drawCalls = Draw calls
perf-stat-triangles = Triângulos
perf-stat-entities = Entidades
perf-stat-instances = Entidades instanciadas
perf-stat-visibleEntities = Entidades na vista
perf-stat-effects = Efeitos
perf-stat-assets = Assets
perf-stat-loads = Carregamentos prontos
perf-stat-failures = Falhas de assets
perf-stat-gpu = Tempo de GPU
perf-stat-backend = Backend
perf-stat-backendReason = Motivo do backend
perf-stat-backendChosen = Backend pedido
perf-stat-other = { $key }

## O executor de bench.
panel-bench = Bench
bench-run = Executar o bench
bench-running = O bench está em execução…
bench-quick = Rápido (janelas curtas)
bench-done = A execução terminou
bench-failed = A execução falhou: veja o log
bench-runs = { $count ->
    [one] { $count } execução no histórico
   *[other] { $count } execuções no histórico
}
bench-last = A última execução: { $date }, nível { $tier }
bench-passed = Todos os valores de todos os orçamentos passam.
bench-result-pass = Passa
bench-result-over = Acima do orçamento
bench-result-not-measured = Não medido
bench-result-not-judged = Não avaliado
bench-trend = A tendência das execuções

## A janela Build.
panel-build = Build
build-out = Pasta de saída
build-run = Gerar o build
build-running = O build está em execução…
build-open = Abrir o player gerado
build-passed = O build passa nos orçamentos e no gate
build-failed = O build falhou: veja o relatório
build-entries = Entradas do player
build-entry = Entrada
build-size = Tamanho (gzip)
build-budget = Orçamento (KB)
build-budget-of = O orçamento de { $id } em KB
build-entry-result = Resultado
build-entry-ok = Dentro do orçamento
build-entry-exceeded = Acima do orçamento
build-entry-exception = Acima do orçamento, com uma exceção conhecida
build-entry-no-budget = Sem orçamento
build-save-budgets = Salvar os orçamentos
build-budgets-saved = O projeto tem os novos orçamentos. Gere o build para verificá-los.
build-budget-bad = O orçamento de { $id } não é um tamanho em KB.
build-gate = Gate de marcadores
build-gate-clean = Nenhum código de dev ou de lab no build.

## A prévia do player e os snippets de incorporação.
panel-embed = Incorporar
embed-base = URL pública
embed-scene = Cena
embed-sequence = Sequência
embed-camera = Câmera
embed-default = Como o projeto
embed-autoplay = Reprodução automática
embed-loop = Repetir
embed-muted = Sem som
embed-kinds = Tipo de snippet
embed-kind-element = Web component
embed-kind-script = Tag script
embed-kind-vue = Vue
embed-copy = Copiar o snippet
embed-copied = Copiado
embed-preview = Prévia do player gerado
embed-reload = Recarregar

## As capturas e as baselines.
panel-baselines = Capturas
shots-camera = Câmera (vazio: a câmera da cena)
shots-at = Tempo (ms)
shots-size = Tamanho
shots-take = Fazer uma captura
shots-taking = A captura está em execução…
shots-verify = Executar verify
shots-verifying = O verify está em execução…
shots-shots = Capturas
shots-baseline = Adicionar como baseline
shots-baseline-confirm = Confirmar: substituir a baseline
shots-baseline-added = { $path } é a nova baseline.
shots-poster = Definir como pôster
shots-poster-set = { $path } é o pôster da cena. Salve a cena para mantê-lo.
shots-poster-title = Pôster
shots-baselines = Baselines de { $platform }
shots-diff = Mostrar a diferença de uma baseline com falha
shots-same = Igual
shots-differs = Difere

## A fila de renderização.
panel-renderQueue = Fila de renderização
render-kind = Tipo de renderização
render-kind-clip = Clipe
render-kind-sheet = Folha de contato
render-range = Intervalo de tempo (ms)
render-cell = Largura da célula (px)
render-fps = Quadros por segundo
render-add = Adicionar à fila
render-queue = Fila
render-state-waiting = Aguardando
render-state-running = Em execução…
render-state-done = Concluído
render-state-failed = Falhou
render-outputs = Saídas

## A publicação.
publish = Publicar
publish-zip = Publicar como arquivo ZIP
publish-running = A publicação está em execução…
publish-hint = A verificação de release dos assets é executada primeiro.
publish-done = O arquivo ZIP tem { $files } arquivos ({ $kb } KB).
publish-download = Baixar o arquivo ZIP
publish-send = Enviar para { $target }
publish-stopped = A verificação de release impede a publicação:
