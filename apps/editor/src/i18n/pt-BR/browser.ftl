# SPDX-License-Identifier: Apache-2.0

### Os textos do dock sob a cena da página do lab: o navegador de conteúdo, seu cabeçalho, sua árvore, sua grade e
### suas partes da linha do tempo (src/core/browser).

## O dock e seu cabeçalho (LabDock.vue, DockHeader.vue).

browser-dock-title = Navegador de conteúdo
browser-dock-title-item = Navegador de conteúdo · { $item }
browser-dock-tabs = Abas do dock
browser-dock-open = Abrir o dock (Shift+B)
browser-dock-close = Fechar o dock (Shift+B)
browser-dock-parts = Partes do dock
browser-dock-reset = Restaurar o layout padrão do dock
browser-dock-detach = Abrir o navegador de conteúdo em uma janela
browser-tab-assets = Assets

## As partes do dock. O cabeçalho e os painéis laterais as mostram e ocultam.

browser-part-timeline = Linha do tempo
browser-folders = Pastas
browser-part-browser = Navegador
browser-part-show-timeline = Mostrar a linha do tempo
browser-part-hide-timeline = Ocultar a linha do tempo
browser-part-show-folders = Mostrar as pastas
browser-part-hide-folders = Ocultar as pastas
browser-part-show-browser = Mostrar o navegador (B)
browser-part-hide-browser = Ocultar o navegador (B)

## As alças de redimensionamento (ResizeHandle.vue). O rótulo vai para o leitor de tela; o título aparece ao passar
## o mouse.

browser-dock-height = A altura do dock: arraste ou use as setas; pressione duas vezes para o tamanho padrão
browser-dock-height-title = A altura do dock (arraste; pressione duas vezes: o tamanho padrão)
browser-tree-width = A largura das pastas: arraste ou use as setas; pressione duas vezes para o tamanho padrão
browser-tree-width-title = A largura das pastas (arraste; pressione duas vezes: o tamanho padrão)

## A árvore de pastas (DockTree.vue).

browser-tree-open = Abrir a pasta
browser-tree-close = Fechar a pasta

## A barra sobre a grade: o caminho, a busca e os filtros (DockBreadcrumb.vue).

browser-up = Subir um nível
browser-up-title = Subir um nível (Backspace)
browser-path = Caminho
browser-content = Conteúdo
browser-search = Buscar no conteúdo
browser-search-placeholder = Buscar (/)
browser-filters = Filtros
browser-filter-status = Status
browser-filter-priority = Prioridade
browser-filter-kind = Tipo
browser-filter-layer = Camada
browser-filter-scene = Cena
browser-filter-any = qualquer
browser-filters-clear = Limpar os filtros

## A grade de miniaturas e sua linha de status (DockGrid.vue).

browser-recent = Recentes
browser-no-match = Nada corresponde à busca e aos filtros.
browser-empty = Esta pasta está vazia.
browser-count-items =
    { $count ->
        [one] { $count } item
       *[other] { $count } itens
    }
browser-count-playable =
    { $count ->
        [one] { $count } reproduzível no lab
       *[other] { $count } reproduzíveis no lab
    }
browser-count-captured = capturados: { $count }
browser-count-drawn = desenhados: { $count }
browser-count-none = sem movimento: { $count }

## Uma miniatura da grade (DockTile.vue, dockUi.ts). As palavras de status descrevem o movimento de um clipe.

browser-clip-capture = clipe capturado
browser-clip-proc = desenhado pelo modelo de pose
browser-clip-generic = a pose compartilhada da sua família
browser-clip-none = ainda sem movimento
browser-not-in-lab = não está no lab
browser-tile-not-playable = ainda não está no lab
browser-tile-family-scene = reproduz a cena da sua família
browser-tile-no-picture = sem imagem: bun run labs stills { $key }
browser-tile-stale-picture = a imagem está desatualizada: bun run labs stills { $key }
browser-tile-stale = desatualizada
browser-tile-family = família
browser-tile-family-title = Reproduz a cena da sua família: o modelo de pose ainda não nomeia este clipe

## A faixa de quadros da linha do tempo (DockStrip.vue).

browser-strip-frame = Quadro em { $time }
browser-strip-frame-title = { $time } — pressione: ir até lá; Shift: definir o loop
browser-strip-zoom = Quadros na faixa
browser-strip-slots =
    { $count ->
        [one] { $count } quadro
       *[other] { $count } quadros
    }
browser-strip-full = Todos os quadros estão presentes
browser-strip-fill-title =
    { $count ->
        [one] Capturar agora { $count } quadro vazio
       *[other] Capturar agora os { $count } quadros vazios
    }
browser-strip-fill = Preencher
browser-strip-refresh = Atualizar os quadros
browser-strip-refresh-title = Atualizar os quadros (descartar os quadros em cache desta faixa)

## As pistas de clipes da linha do tempo (DockLanes.vue).

browser-lanes-live-empty = Ainda não há pistas: reproduza a janela ou preencha a faixa.
browser-lanes-empty = Nenhum membro atua na janela.
browser-lanes-tracks = As trilhas de { $item } (preset.md) em relação às pistas:
browser-lanes-drawn = Uma pista da janela a desenha
browser-lanes-missing = Nenhuma pista da janela a desenha
