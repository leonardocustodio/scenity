# SPDX-License-Identifier: Apache-2.0

### Os textos do navegador de assets (assetBrowser/; docks da cena). A página da cena o mostra no dock inferior,
### e o lab o mostra na aba Assets do seu dock. IDs, nomes, tipos, tags, origens e caminhos de assets são valores de dados.

## A barra de ferramentas: a busca, os filtros de tipo e de tag, a contagem, o recarregamento e a importação.

assets-browser = Assets
assets-search = Buscar assets
assets-kinds = Tipos
assets-tags = Tags
# $shown é a contagem dos assets que passam nos filtros, $total a contagem de todos os assets.
assets-shown = { $shown } de { $total }
assets-reload = Ler os assets de novo
assets-import = Importar
# $extensions é a lista das extensões de arquivo que um importador lê (valores de dados).
assets-import-title = Importar arquivos ({ $extensions }); ou solte-os no navegador
assets-import-files = Importar arquivos

## A grade e os blocos.

assets-empty = Nenhum registro de asset neste projeto.
assets-empty-importable = Nenhum registro de asset neste projeto. Solte arquivos aqui para importá-los.
# A dica de um bloco: o arquivo de origem, o ID do asset e as tags do asset.
assets-tile-hint =
    Origem: { $source }
    ID: { $id }
    Tags: { $tags }
assets-tile-hint-untagged =
    Origem: { $source }
    ID: { $id }
# O selo de um bloco com um problema do banco de dados de assets.
assets-problem = problema

## Os detalhes do asset selecionado. $count é um número de triângulos ou de níveis de detalhe.

assets-size-bytes = { $size } B
assets-size-kilobytes = { $size } KB
assets-size-megabytes = { $size } MB
assets-open-prefab = Abrir prefab
    .title = Abrir o arquivo de prefab com as ferramentas do editor (o modo prefab)
assets-edit-material = Editar material
    .title = Abrir o material no editor de materiais
assets-used-by = Usado por
assets-unused = Nada usa este asset.

## A linha de status de uma importação. $file é o nome do arquivo, $source o caminho de origem do novo asset.

assets-importing = Importando { $file }…
assets-imported = { $file } importado como { $source }
# $warnings é a lista dos avisos do importador (do servidor de desenvolvimento, em inglês).
assets-imported-warnings = { $file } importado como { $source } ({ $warnings })
# $reason vem do servidor de desenvolvimento (em inglês).
assets-import-failed = { $file } não foi importado: { $reason }
# Uma requisição com falha e sem motivo. $status é o código de status HTTP, $text o texto de status HTTP.
assets-server-answered = o servidor respondeu { $status } { $text }
assets-no-server = Nenhuma lista de assets neste servidor. Abra o projeto no studio ou com o servidor de desenvolvimento.
project-failed = O servidor de desenvolvimento não respondeu.
project-folders = As pastas do projeto
project-favourites = Favoritos
project-assets = Assets
project-root = A pasta do projeto
project-search = Buscar nos arquivos
project-kind = Tipo
project-kind-all = Todos os tipos
project-kind-folder = Pastas
project-kind-scene = Cenas
project-kind-prefab = Prefabs
project-kind-material = Materiais
project-kind-sequence = Sequências
project-kind-rules = Regras
project-kind-plugin = Plugins
project-kind-asset = Assets
project-kind-file = Outros arquivos
project-create = Criar
project-new-folder = Nova pasta
project-new-folder-name = Nova pasta
project-new-scene = Nova cena
project-new-material = Novo material
project-new-sequence = Nova sequência
project-grid = Mostrar uma grade
project-list = Mostrar uma lista
project-empty = Nenhum arquivo aqui.
project-entries = Os arquivos da pasta
project-rename = Renomear { $name }
project-favourite = Manter { $name } nos favoritos
project-reveal = Mostrar { $name } no disco
project-reveal-short = Revelar

## A caixa de diálogo de importação e a fila de importação. $count é uma contagem de arquivos; $field é
## uma configuração (dados).

assets-import-dialog = Importar
assets-import-dialog-title = { $count ->
    [one] Importar { $count } arquivo
   *[other] Importar { $count } arquivos
}
assets-import-no-importer = Nenhum importador
assets-import-more = Mais configurações
assets-import-rights = Registro de direitos
assets-import-rights-default = rights/imports.yaml (o padrão: a licença ainda não é conhecida)
assets-import-folder = Pasta
assets-import-start = Importar
assets-import-cancel = Cancelar
assets-import-setting-bad = Não é possível ler a configuração { $field }.
assets-import-queue = A fila de importação
assets-import-state-waiting = Aguardando
assets-import-state-importing = Importando…
assets-import-state-done = Concluído
assets-import-state-failed = Falhou
assets-import-state-cancelled = Cancelado
assets-import-queue-cancel = Cancelar os outros arquivos
assets-import-fix-blender = Arquivos FBX, OBJ e .blend precisam do Blender 5.2. O diagnóstico do Hub verifica isso.
assets-import-fix-blender-link = Instalar o Blender
assets-import-folder-default = assets/sources
assets-import-new-rights = Novo registro…

## O formulário de um novo registro de direitos.

rights-name = Nome
rights-name-sample = kenney
rights-source = Origem
rights-author = Autor
rights-spdx = ID SPDX
rights-licence = Licença
rights-date = Data da licença
rights-uses = Uso permitido
rights-delivery = Entrega na web
rights-delivery-yes = Permitida
rights-delivery-pending = Pedida, ainda sem resposta
rights-delivery-no = Não permitida
rights-save = Salvar o registro

## O inspetor de assets.

asset-inspector = Inspetor de assets
asset-preview-channels = Canais
asset-preview-channel-rgb = RGB
asset-preview-channel-r = Vermelho
asset-preview-channel-g = Verde
asset-preview-channel-b = Azul
asset-preview-channel-a = Alfa
asset-preview-player = Tocar o som
asset-fact-size = Tamanho
asset-fact-triangles = Triângulos
asset-fact-meshes = Malhas
asset-fact-extent = Extensão
asset-fact-lods = LODs
asset-fact-clips = Clipes
asset-fact-rig = Rig
asset-fact-joints = Juntas
asset-fact-pixels = Pixels
asset-fact-type = Tipo
asset-fact-duration = Duração
asset-fact-channels = Canais
asset-fact-codec = Codec
asset-record-importer = Importador
asset-record-source = Origem
asset-record-rights = Direitos
asset-record-tags = Tags
asset-record-build = Build
asset-record-approvals = Aprovações
asset-reimport = Importar de novo
asset-reimport-start = Importar de novo

## As imagens estáticas.

assets-make-stills = Gerar imagens estáticas ({ $count })
assets-make-stills-hint = Desenhar nesta página as imagens estáticas ausentes e desatualizadas do projeto
assets-stills-drawing = Desenhando a imagem estática { $index } de { $count }…
assets-stills-made = { $count ->
    [one] { $count } imagem estática gerada
   *[other] { $count } imagens estáticas geradas
}
assets-stills-failed = Algumas imagens estáticas falharam: { $reasons }
assets-no-project-folder = { $base } não é uma pasta de projeto
assets-still-stale = Desatualizada
assets-still-stale-hint = A origem ou o build mudou depois da imagem estática: Gerar imagens estáticas a desenha de novo

## O painel de build de assets.

panel-asset-build = Build de assets
asset-build = Build de assets
asset-build-assets = Assets do build
asset-build-run = Gerar o build
asset-build-running = O build está em execução…
asset-build-ok = O build terminou
asset-build-failed = O build falhou: veja o log
asset-build-count-built = { $count } com build
asset-build-count-stale = { $count } com build desatualizado
asset-build-count-unbuilt = { $count } sem build
asset-build-count-failed = { $count } com falha
asset-build-state-built = Com build
asset-build-state-stale = Desatualizado
asset-build-state-unbuilt = Sem build
asset-build-state-failed = Falhou
asset-build-codec-color = Texturas de cor
asset-build-codec-normal = Normal maps
asset-build-codec-data = Texturas de dados
asset-build-codec-environment = Mapa de ambiente
asset-build-project = Como o projeto
asset-build-lods = Níveis de detalhe
asset-build-lods-bad = Os níveis de detalhe são um número de 1 a 8.
asset-build-save = Salvar as configurações
asset-build-saved = O registro tem as novas configurações de build. Gere o build para usá-las.
asset-build-levels = Níveis do build
asset-build-triangles = { $count } triângulos
asset-build-preview = Prévia

## Os direitos de muitos assets e a política de licenças.

assets-rights-mark = Direitos
assets-agent-mark = { $name } mudou este asset no turno { $turn }
assets-rights-bar = Assets escolhidos
assets-picked = { $count ->
    [one] { $count } asset escolhido
   *[other] { $count } assets escolhidos
}
assets-picked-clear = Limpar
assets-rights-record = Registro de direitos
assets-rights-assign = Atribuir o registro de direitos
assets-rights-assigned = { $count ->
    [one] { $count } asset tem o registro de direitos { $rights }
   *[other] { $count } assets têm o registro de direitos { $rights }
}
panel-rights = Direitos
rights-panel = Direitos e licenças
rights-policy = Licenças de uma release
rights-policy-hint = O gate de release aceita um registro de direitos quando o projeto aceita o ID SPDX dele.
rights-policy-none = O projeto não aceita nenhuma licença: o gate de release barra todos os assets.
rights-policy-remove = Remover { $id }
rights-policy-add = ID SPDX
rights-policy-add-button = Aceitar
rights-records = Registros de direitos do projeto
rights-not-accepted = O projeto não aceita esta licença

## As aprovações.

panel-approvals = Aprovações
approvals = Aprovações
approvals-role = Papel
approvals-queue = Assets do papel
approvals-refresh = Ler de novo
approvals-new-role = Novo papel
approvals-new-label = Rótulo
approvals-add-role = Adicionar o papel
approvals-no-role = O projeto não tem papel de aprovação. Adicione um: o gate de release passa a precisar da aprovação dele para cada asset.
approvals-state-missing = Não revisado
approvals-state-stale = Desatualizado
approvals-state-refused = Não aprovado
approvals-state-current = Aprovado
approvals-verdict-approved = aprovado
approvals-verdict-changes = alterações pedidas
approvals-verdict-rejected = rejeitado
approvals-last = Última revisão: { $verdict } por { $reviewer } em { $date }
approvals-reviewer = Revisor
approvals-reviewer-needed = Digite o nome do revisor primeiro.
approvals-note = Nota
approvals-approve = Aprovar
approvals-changes = Pedir alterações
approvals-reject = Rejeitar

## A verificação de release.

panel-release = Verificação de release
release-panel = Verificação de release
release-run = Executar a verificação de release
release-running = A verificação está em execução…
release-passed = O gate de release deixa passar os { $count } assets
release-failed = O gate de release barra a release: { $errors } erros em { $count } assets
release-findings = Resultados do gate de release
release-project = O projeto
release-level-error = Erro
release-level-warning = Aviso
release-fix-rights = Abrir os direitos
release-fix-approval = Revisar
release-fix-asset = Mostrar o asset

## A exportação GLB.

panel-export = Exportar
export-panel = Exportar uma cena como GLB
export-scene = Cena
export-out = Arquivo de saída
export-out-default = .scenity/exports/<scene>.glb
export-imports = Executar os importadores primeiro
export-run = Exportar GLB
export-running = A exportação está em execução…
export-counts = { $entities } entidades, { $models } modelos
export-valid = O validador glTF não encontra nenhum erro
export-invalid = O validador glTF encontra { $count } erros

## As fontes de assets.

sources = Fontes de assets
sources-open = Obter assets
sources-open-hint = Buscar em uma fonte de assets gratuitos (Poly Haven) e importar um item com o registro de direitos dele
sources-provider = Fonte
sources-kinds = Tipos
sources-kind-environment = Céus
sources-kind-model = Modelos
sources-kind-texture = Texturas
sources-search = Buscar na fonte
sources-licence-note = Cada item é importado com o registro de direitos da sua fonte.
sources-loading = Lendo a fonte…
sources-none = A fonte não tem nenhum item para esta busca.
sources-no-answer = A fonte não responde. Verifique a rede e busque de novo.
sources-import = Importar
sources-imported = { $name } importado com o registro de direitos { $rights }

## Os assets gerados.

generate = Gerar
generate-generator = Gerador
generate-kind = Tipo
generate-prompt = O que criar
generate-estimate = Obter o custo
generate-cost = Custo: { $cost } { $unit }, cerca de { $seconds } s
generate-run = Gerar
generate-running = Gerando…
generate-rights-note = O resultado é importado com o registro de direitos do gerador (tipo "generated"): o gate de release o barra até o dono revisar os termos.
