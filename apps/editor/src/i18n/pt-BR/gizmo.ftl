# SPDX-License-Identifier: Apache-2.0

### Os textos do gizmo de transformação da página da cena (scene/gizmo).

## Os botões de modo da barra do gizmo (gizmoBar.ts). $key é a tecla do modo, por exemplo "W".

gizmo-bar-label = Ferramentas
gizmo-mode-view = Visualizar
gizmo-mode-view-title = Visualizar: selecionar, não mover nada ({ $key })
gizmo-mode-move = Mover
gizmo-mode-move-title = Mover ({ $key })
gizmo-mode-turn = Girar
gizmo-mode-turn-title = Girar ({ $key })
gizmo-mode-scale = Escalar
gizmo-mode-scale-title = Escalar ({ $key })

## Os eixos e os botões de pivô da barra do gizmo. As letras entre parênteses são as teclas dos botões.

gizmo-space-title = Os eixos: global ou local (L)
gizmo-space-world = Global
gizmo-space-local = Local
gizmo-pivot-title = O pivô: cada origem ou o centro da seleção (P)
gizmo-pivot-pivot = Pivô
gizmo-pivot-centre = Centro

## Os encaixes da barra do gizmo: a chave de liga/desliga de cada encaixe e o título do seu campo de passo (com a
## unidade).

gizmo-snap-grid = Grade
gizmo-snap-grid-step = Passo da grade (m)
gizmo-snap-angle = Ângulo
gizmo-snap-angle-step = Passo do ângulo (°)
gizmo-snap-scale = Escala
gizmo-snap-scale-step = Passo da escala (×)
gizmo-snap-surface = Superfície
gizmo-snap-surface-title = Um movimento livre se encaixa na superfície sob o ponteiro e em um soquete a até 8 cm

## O valor digitado de um arraste. $axis é X, Y ou Z, e $value é o texto que o usuário digita. O último caractere
## mostra o cursor de texto.

gizmo-typed-move = Mover: { $value }▏
gizmo-typed-move-axis = Mover { $axis }: { $value }▏
gizmo-typed-turn = Girar: { $value }▏
gizmo-typed-turn-axis = Girar { $axis }: { $value }▏
gizmo-typed-scale = Escalar: { $value }▏
gizmo-typed-scale-axis = Escalar { $axis }: { $value }▏

## Os comandos de página das teclas do gizmo (startGizmo.ts) e os motivos pelos quais um comando não pode ser
## executado agora.

gizmo-command-view = Gizmo: visualizar (sem gizmo)
gizmo-command-confirm = Arraste do gizmo: aplicar o valor digitado
gizmo-command-cancel = Arraste do gizmo: cancelar
gizmo-command-move = Gizmo: mover
gizmo-command-turn = Gizmo: girar
gizmo-command-scale = Gizmo: escalar
gizmo-command-space = Gizmo: eixos globais ou locais
gizmo-command-pivot = Gizmo: pivô ou centro
gizmo-command-type-axis = Digitar um valor no eixo { $axis }
gizmo-refuse-fly = A câmera do editor está voando.
gizmo-refuse-drag = Um arraste do gizmo está em andamento.
gizmo-refuse-no-entity = Nenhuma entidade para mover.
