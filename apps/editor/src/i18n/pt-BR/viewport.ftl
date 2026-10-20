# SPDX-License-Identifier: Apache-2.0

### Os textos da viewport da página da cena (scene/viewport).

## A barra da viewport (viewportBar.ts): o menu de câmera, o menu de modo de visualização, a chave da grade e o botão Enquadrar.

viewport-bar = Viewport
viewport-camera = Câmera
viewport-camera-title = Câmera (0: editor, 1-9: câmeras do documento)
viewport-camera-editor = Câmera do editor
# Uma câmera do documento no menu de câmera. $label é o nome da câmera, e $number é a tecla dela (1 a 9).
viewport-camera-option = { $label } ({ $number })
viewport-view = Visualização
viewport-view-title = Modo de visualização
viewport-mode-lit = Iluminado
viewport-mode-unlit = Sem iluminação
viewport-mode-wireframe = Wireframe
viewport-mode-normals = Normais
viewport-grid = Grade
viewport-frame = Enquadrar
viewport-frame-title = Enquadrar a seleção (F)

## Os ícones das luzes e das câmeras (viewIcons.ts). $name é o nome da entidade.

viewport-icon-light = { $name } (luz)
viewport-icon-camera = { $name } (câmera)

## A prévia da câmera (previewInset.ts). $label é o nome da câmera do documento.

viewport-preview = Prévia: { $label }

## Os comandos de página das teclas da viewport (startViewport.ts) e os motivos pelos quais um comando não pode ser executado agora.
## $number é a tecla de uma câmera do documento (1 a 9).

viewport-command-frame = Enquadrar a seleção
viewport-command-editor-camera = Abrir a câmera do editor
viewport-command-open-camera = Abrir a câmera do documento { $number }
viewport-refuse-fly = A câmera do editor está em voo.
viewport-refuse-no-camera = Nenhuma câmera do documento { $number }.

## As teclas mantidas da câmera (o mapa de teclas).

viewport-held-camera-fly-forward = Voar para a frente (segure, com o botão direito)
viewport-held-camera-fly-back = Voar para trás (segure, com o botão direito)
viewport-held-camera-fly-left = Voar para a esquerda (segure, com o botão direito)
viewport-held-camera-fly-right = Voar para a direita (segure, com o botão direito)
viewport-held-camera-fly-down = Voar para baixo (segure, com o botão direito)
viewport-held-camera-fly-up = Voar para cima (segure, com o botão direito)
viewport-held-camera-look-left = Girar a vista para a esquerda (segure)
viewport-held-camera-look-right = Girar a vista para a direita (segure)
viewport-held-camera-look-up = Inclinar a vista para cima (segure)
viewport-held-camera-look-down = Inclinar a vista para baixo (segure)

viewport-change-pin = { $name }: { $change }, aguarda revisão
overlay-menu = Sobreposições
overlay-menu-of = O menu da sobreposição { $name }
overlay-fold = Recolher
overlay-unfold = Expandir
overlay-hide = Ocultar
overlay-dock-top = Ancorar em cima
overlay-dock-right = Ancorar à direita
overlay-dock-bottom = Ancorar embaixo
overlay-dock-left = Ancorar à esquerda
overlay-tools = Ferramentas
overlay-tool-settings = Configurações da ferramenta
overlay-view = Opções de visualização
overlay-cameras = Câmeras
overlay-grid = Grade e encaixe
overlay-orientation = Orientação
overlay-stats = Estatísticas
overlay-agent = Agente
command-overlay-menu = O menu de sobreposições
overlay-stats-fps = { $fps } fps
overlay-stats-entities = { $count ->
    [one] { $count } entidade
   *[other] { $count } entidades
}
overlay-stats-selected = selecionadas: { $count }
overlay-agent-idle = Nenhum agente trabalha agora.
viewport-command-view-front = Vista frontal
viewport-command-view-back = Vista traseira
viewport-command-view-right = Vista direita
viewport-command-view-left = Vista esquerda
viewport-command-view-top = Vista superior
viewport-command-view-bottom = Vista inferior
viewport-command-projection = Perspectiva ou ortográfica
viewport-projection-perspective = Persp
viewport-projection-orthographic = Orto
viewport-projection-title = A projeção da câmera do editor (Alt+5)
viewport-axis-view = { $view }

## A vista dividida da Vista da cena: os layouts (Janela ▸ Vista dividida) e a barra de cada vista. $pane é
## o número de uma vista (1 é a vista principal).

viewport-command-split-one = Uma vista
viewport-command-split-side = Duas vistas lado a lado
viewport-command-split-stacked = Duas vistas empilhadas
viewport-command-split-four = Quatro vistas
viewport-pane-camera = Câmera da vista { $pane }
viewport-pane-mode = Modo de visualização da vista { $pane }
viewport-pane-perspective = Vista em perspectiva
viewport-pane-main = Principal
viewport-pane-main-title = Colocar esta vista na vista principal, e a vista principal aqui

## O papel de cebola da Vista da cena.

view-onion-title = Papel de cebola: a entidade selecionada em tempos ao redor do relógio (azul antes, laranja depois)
view-onion-arg-on = True mostra o papel de cebola; false oculta o papel de cebola (padrão: o outro estado).

## As caminhadas de um ator. $index é o número de uma caminhada; $seconds é o tempo de início dela.

walk-label = { $index } · { $seconds } s
walk-add-title = Adicionar uma caminhada do ator até um ponto de parada em um tempo
walk-arg-to = O ponto de parada: uma entidade com um componente standPoint.
walk-arg-t = O tempo de início da caminhada (ms).
walk-arg-entity = O ator (padrão: a entidade selecionada).
walk-none = Selecione um ator e indique um ponto de parada.
# As camadas de depuração do núcleo na sobreposição Opções de visualização.
viewport-debug-layers = Camadas de depuração
