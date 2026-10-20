# SPDX-License-Identifier: Apache-2.0

### Os comandos do editor de cena da página do lab (apps/editor/src/core/editor): os títulos, as teclas e
### a documentação dos argumentos que a paleta mostra, os títulos das edições que o histórico e os cartões mostram, e
### as recusas. O Claude e os scripts recebem os mesmos textos no idioma da página. Mantenha o texto em inglês no en-US:
### as ferramentas e as especificações o leem. Uma variável com um número recebe um texto, para o Fluent não o formatar de novo.

## Os comandos de prop e de prop de rascunho (propCommands.ts): os títulos, as teclas, a documentação dos argumentos do
## formulário da paleta, os títulos das edições e as recusas.

commands-prop-select = Selecione um prop ou informe-o com o argumento prop.
commands-prop-no-place = O prop "{ $slot }" não tem posição ajustada. Props: { $props }.
commands-prop-arg-prop = O slot do prop, por exemplo 'cart' ou 'pillow'. Padrão: o prop selecionado.
commands-prop-arg-x = O novo x da posição (metros, leste). Padrão: o x atual.
commands-prop-arg-z = O novo z da posição (metros, sul). Padrão: o z atual.
commands-prop-arg-height = A nova altura (metros). Padrão: a altura atual.
commands-prop-move = Mover o prop sobre o piso
commands-prop-move-key = Arrastar (Shift: grade de 10 cm)
commands-prop-move-needs = prop.move precisa de x, z ou ambos.
commands-prop-move-edit = Mover { $slot } para x { $x }, z { $z }
commands-prop-lift = Erguer o prop
commands-prop-lift-key = Alt+arrastar
commands-prop-lift-arg-y = A nova altura da posição (metros acima do piso).
commands-prop-lift-edit = Erguer { $slot } para { $y } m
commands-prop-turn = Girar o prop
commands-prop-turn-key = R (Shift+R: sentido oposto, Alt+R: 1°)
commands-prop-turn-arg-degrees = O giro em torno da vertical (graus, + é o sentido anti-horário).
commands-prop-turn-edit = Girar { $slot } { $degrees }°
commands-prop-nudge = Ajustar o prop um passo
commands-prop-nudge-key = Alt+setas, Alt+Q/E, Alt+vírgula/ponto (aba Ajustes)
commands-prop-nudge-arg-axis = A parte da posição: x, y, z ou yaw.
commands-prop-nudge-arg-steps = O número de passos (1 cm ou 1° cada; um número negativo vai para o outro lado).
commands-prop-nudge-edit = Ajustar { $slot } { $axis } { $steps }
commands-prop-reset = Devolver o prop à posição dele no código
commands-prop-reset-edit = Redefinir { $slot }

## Os props de rascunho.

commands-prop-scratch-select = Selecione um prop de rascunho.
commands-prop-scratch-none = Não há prop de rascunho "{ $id }".
commands-prop-scratch-arg-x = O novo x (metros). Padrão: o x atual.
commands-prop-scratch-arg-z = O novo z (metros). Padrão: o z atual.
commands-prop-scratch-move = Mover o prop de rascunho
commands-prop-scratch-move-key = Arrastar
commands-prop-scratch-move-edit = Mover { $id }
commands-prop-scratch-turn = Girar o prop de rascunho
commands-prop-scratch-turn-arg-degrees = O giro em torno da vertical (graus).
commands-prop-scratch-duplicate = Duplicar o prop de rascunho
commands-prop-scratch-duplicate-edit = Duplicar { $id }
commands-prop-scratch-remove = Excluir o prop de rascunho
commands-prop-scratch-remove-edit = Excluir { $id }
commands-prop-scratch-promote = Promover o prop de rascunho para a sala
commands-prop-scratch-promote-arg-dry = True: a execução de teste (o que vai mudar); false: enviar o prompt preparado ao Claude.
commands-prop-scratch-promote-edit =
    { $dry ->
        [yes] Promover { $id } (execução de teste)
       *[no] Promover { $id }
    }

## Os comandos de encaixe (snapCommands.ts) e as recusas de encaixe (snapPlace.ts).

commands-snap-prop = Encaixar o prop em um alvo da sala
commands-snap-prop-key = Arrastar (segure Alt: sem encaixe)
commands-snap-prop-arg-target = O ID do alvo (surface:floor, surface:cart, wall:head, socket:wall_outlet, anchor:door, …; a parte depois dos dois-pontos basta quando é única), ou 'nearest' (num raio de 8 cm).
commands-snap-no-target = Não há alvo de encaixe "{ $name }". Alvos: { $targets }.
commands-snap-no-port = Sem encaixe em { $id }: { $slot } não tem porta (*_port).
commands-snap-not-along = Sem encaixe em { $id }: a posição não está ao longo dele.
commands-snap-prop-edit = Encaixar { $slot } em { $label } ({ $id })
commands-snap-prop-edit-surface = Encaixar { $slot } em { $label } ({ $id }); nenhum outro alvo num raio de { $radius } cm
commands-snap-prop-edit-none = Encaixar { $slot }: nenhum alvo num raio de { $radius } cm
commands-snap-place = Definir a posição do prop
commands-snap-place-key = ⌘+arrastar com encaixe (uma proposta)
commands-snap-place-arg-yaw = O novo giro em torno da vertical (radianos, como o valor de ajuste). Padrão: o giro atual.
commands-snap-place-needs = prop.place precisa de x, y, z ou yaw.
commands-snap-place-edit = Posicionar { $slot } em x { $x }, y { $y }, z { $z }, giro { $turn } rad

## Os comandos de seleção múltipla e de grupo (groupCommands.ts) e as recusas de grupo (groups.ts).

commands-group-no-host = Esta página não guarda grupos.
commands-group-arg-props = Os slots dos props, por exemplo 'cart,pillow' (padrão: os props selecionados).
commands-group-add = Adicionar um item à seleção (ou retirá-lo)
commands-group-add-key = Shift+clique
commands-group-add-arg-target = O item como kind:id, por exemplo 'prop:cart' (um item selecionado sai da seleção).
commands-group-not-item = "{ $text }" não é um item (kind:id).
# $out é "yes" quando o item sai da seleção.
commands-group-add-edit =
    { $out ->
        [yes] Retirar { $item } da seleção
       *[no] Adicionar { $item }
    }
commands-group-select = Selecionar o grupo nomeado do prop selecionado
commands-group-select-arg-group = O nome de um grupo, por exemplo 'crash-cart' (padrão: o grupo do prop selecionado).
commands-group-none-of = { $prop } não está em nenhum grupo. Grupos: { $known }.
commands-group-unknown = Não há grupo "{ $name }": { $known }.
commands-group-select-edit = Selecionar o grupo { $name }
commands-group-move = Mover props juntos (os props selecionados ou um grupo)
commands-group-move-key = Arrastar um prop selecionado
commands-group-move-arg-about = O prop de referência do movimento e do giro (padrão: o primeiro prop).
commands-group-move-arg-dx = O movimento ao longo de x (metros, leste).
commands-group-move-arg-dy = O movimento para cima (metros).
commands-group-move-arg-dz = O movimento ao longo de z (metros, sul).
commands-group-move-arg-degrees = O giro em torno da vertical que passa pelo prop de referência (°).
commands-group-move-no-place = O prop "{ $slot }" não tem posição ajustada.
commands-group-move-edit = Mover { $props } em x { $dx }, y { $dy }, z { $dz }
commands-group-move-edit-turn = Mover { $props } em x { $dx }, y { $dy }, z { $dz }, giro { $degrees }°
commands-group-save = Guardar os props selecionados como um grupo nomeado
commands-group-save-arg-name = O nome do grupo, por exemplo 'west-corner' (a-z, 0-9, _ e -).
commands-group-save-few = Um grupo tem dois ou mais props: selecione-os ou informe os nomes deles.
commands-group-save-edit = Guardar o grupo { $name }
commands-group-remove = Remover um grupo do dono
commands-group-remove-arg-name = O nome de um grupo do dono (não um grupo integrado).
commands-group-remove-edit = Remover o grupo { $name }
commands-group-list = Listar os grupos nomeados
commands-group-bad-name = "{ $name }" não é um nome de grupo (a-z, 0-9, _ e -; no máximo 24 caracteres).
commands-group-built-in = "{ $name }" é um grupo integrado.
commands-group-few-slots = Um grupo tem dois ou mais slots de prop.

## Os comandos de luz (lightCommands.ts) e o rótulo da alça da luz principal (lightEdit.ts). A variável $part
## é o valor do argumento part (key, fill, sky ou ground).

commands-light-no-tunables = O runtime não tem valores de ajuste de luz (model/light.ts).
commands-light-no-host = Esta página não tem alça da luz principal.
commands-light-arg-x = O x (metros, leste). Padrão: o x atual.
commands-light-arg-y = A altura (metros). Padrão: a altura atual.
commands-light-arg-z = O z (metros, sul). Padrão: o z atual.
commands-light-needs = { $command } precisa de x, y, z ou todos.
commands-light-section-key = A seção Luz da aba Ajustes
commands-light-move = Mover uma luz
commands-light-move-key = Arrastar a alça da luz principal (I)
commands-light-move-arg-part = A luz: key ou fill.
commands-light-move-same = A luz { $part } já está lá.
commands-light-move-edit = Mover a luz { $part } para { $at }
commands-light-aim = Apontar a luz principal
commands-light-aim-same = A luz principal já aponta para lá.
commands-light-aim-edit = Apontar a luz principal para { $at }
commands-light-intensity = Definir a intensidade de uma luz
commands-light-intensity-arg-part = A luz: key, fill ou sky.
commands-light-intensity-arg-value = A intensidade (a luz principal do código: 2.1).
commands-light-intensity-same = A luz { $part } já tem essa intensidade.
commands-light-intensity-edit = Definir a luz { $part } como { $value }
commands-light-colour = Definir a cor de uma luz
commands-light-colour-arg-part = A cor: key, fill, sky ou ground (a cor inferior da luz do céu).
commands-light-colour-arg-colour = A cor: '#rrggbb' ou 'r,g,b' com cada canal de 0 a 255 (sRGB).
commands-light-colour-bad = A cor é '#rrggbb' ou 'r,g,b' (0 a 255).
commands-light-colour-same = A cor { $part } já é { $hex }.
commands-light-colour-edit = Definir a cor { $part } como { $hex }
commands-light-reset = Devolver a luz aos valores dela no código
commands-light-reset-arg-part = A luz: key, fill ou sky (padrão: a luz inteira).
commands-light-reset-none = A luz não tem valores ajustados nessa parte.
commands-light-reset-edit = Redefinir a luz
commands-light-reset-edit-part = Redefinir a luz { $part }
commands-light-show = Mostrar a alça da luz principal
commands-light-show-arg-on = Mostrar ou ocultar (padrão: alternar).
commands-light-hide-edit = Ocultar a alça da luz principal
commands-light-handle-label = luz principal · { $intensity } · { $up }° para cima, giro { $turn }°
commands-light-handle-label-drag = luz principal · { $intensity } · { $up }° para cima, giro { $turn }° · arraste o ponto

## Os comandos de câmera (cameraCommands.ts).

commands-camera-no-camera = Esta página não tem câmera para salvar.
commands-camera-no-bookmarks = Esta página não tem favoritos de câmera.
commands-camera-arg-name = O nome: letras minúsculas e dígitos, com um hífen entre as partes (por exemplo 'bay-foot').
commands-camera-save = Salvar câmera
commands-camera-save-arg-dry = True: a execução de teste (as linhas que mudam); false: escrever a câmera em cameras.ts.
commands-camera-save-arg-replace = True substitui uma câmera nomeada de mesmo nome; false recusa um nome existente.
commands-camera-save-arg-doc = A linha de documentação da câmera em cameras.ts (uma frase curta).
commands-camera-save-exists = A câmera "{ $name }" já existe: dê outro nome ou substitua-a (replace: true).
commands-camera-save-edit =
    { $dry ->
        [yes] Salvar câmera { $name } (execução de teste)
       *[no] Salvar câmera { $name }
    }
commands-camera-bookmark = Adicionar a vista aos favoritos
commands-camera-bookmark-edit = Adicionar a vista aos favoritos como { $name }
commands-camera-recall = Abrir uma vista favorita
commands-camera-recall-arg-name = O nome de um favorito da URL (views=).
commands-camera-recall-none = Não há favoritos: adicione uma vista aos favoritos primeiro.
commands-camera-recall-unknown = Não há favorito "{ $name }". Favoritos: { $names }.
commands-camera-recall-edit = Abrir o favorito { $name }

## Os comandos de vista (viewCommands.ts): a seleção, o histórico, as câmeras nomeadas, as marcas e a pergunta.

commands-view-select = Selecionar um item
commands-view-select-key = Clique
commands-view-select-arg-target = O item como kind:id, por exemplo 'prop:cart', 'member:bo', 'scratch:s1'.
commands-view-select-bad = "{ $text }" não é um item. Informe kind:id com um kind entre { $kinds }.
commands-view-select-edit = Selecionar { $text }
commands-view-clear = Limpar a seleção
commands-view-undo = Desfazer
commands-view-undo-none = Nada para desfazer.
commands-view-redo = Refazer
commands-view-redo-none = Nada para refazer.
commands-view-camera = Abrir uma câmera nomeada
commands-view-camera-arg-name = A câmera nomeada (cameras.ts).
commands-view-camera-unknown = Não há câmera "{ $name }".
commands-view-camera-edit = Abrir a câmera { $name }
commands-view-marks-start = Desenhar marcas no quadro
commands-view-marks-start-busy = O dono está desenhando marcas agora.
commands-view-marks-start-edit = Desenhar marcas
commands-view-marks-stop = Parar as marcas
commands-view-marks-stop-none = Não há marcas em andamento.
commands-view-marks-clear = Limpar as marcas
commands-view-marks-clear-none = O quadro não tem marcas.
commands-view-ask = Perguntar ao Claude sobre a seleção
commands-view-ask-arg-text = O pedido, por exemplo 'aproxime isto da parede'.
commands-view-ask-edit = Perguntar ao Claude

## "Salvar posicionamento".

commands-view-placement-save = Salvar posicionamento
commands-view-placement-save-arg-dry = True: a execução de teste (as linhas que mudam); false: escrever as posições no código-fonte do runtime.
commands-view-placement-save-arg-override = O motivo para salvar enquanto uma verificação de layout falha (as verificações mostram os números); ele acompanha o posicionamento.
commands-view-placement-save-none = Não há valores de posição: mova um prop primeiro.
# $dry e $override são "yes" ou "no".
commands-view-placement-save-edit =
    { $dry ->
        [yes]
            { $override ->
                [yes] Salvar posicionamento (execução de teste) (substituição do layout)
               *[no] Salvar posicionamento (execução de teste)
            }
       *[no]
            { $override ->
                [yes] Salvar posicionamento (substituição do layout)
               *[no] Salvar posicionamento
            }
    }

## As propostas do dono (proposal.*).

commands-view-proposal-arg-id = O ID da proposta, por exemplo 'p1'.
commands-view-proposal-none = Nenhuma proposta aguarda.
commands-view-proposal-accept = Aceitar uma proposta
commands-view-proposal-accept-edit = Aceitar { $id }
commands-view-proposal-reject = Rejeitar uma proposta
commands-view-proposal-reject-edit = Rejeitar { $id }
commands-view-proposal-accept-all = Aceitar todas as propostas
commands-view-proposal-reject-all = Rejeitar todas as propostas

## Os nomes dos passos do histórico que nenhum comando fez (editHistory.ts): a entrada que mudou.

commands-view-history-tunes = valores de ajuste
commands-view-history-events = eventos
commands-view-history-scratch = props de rascunho

## Os comandos de solo e de ocultar (hideCommands.ts). $all é "yes" para todos os painéis, senão "no".

commands-hide-arg-all = True: todos os painéis; false: apenas o painel em foco (o painel principal sem a tela dividida).
commands-hide-arg-target = Os itens como kind:id, por exemplo 'prop:cart,prop:pillow' (padrão: os itens selecionados).
commands-hide-no-host = Esta página não tem solo nem ocultar.
commands-hide-select = Selecione os itens primeiro.
commands-hide-no-item = "{ $text }" não indica nenhum item (kind:id).
commands-hide-hide = Ocultar os itens selecionados
commands-hide-hide-edit =
    { $all ->
        [yes] Ocultar { $count } item(ns) em todos os painéis
       *[no] Ocultar { $count } item(ns) no painel em foco
    }
commands-hide-solo = Mostrar apenas os itens selecionados
commands-hide-solo-edit =
    { $all ->
        [yes] Mostrar apenas { $items } em todos os painéis
       *[no] Mostrar apenas { $items } no painel em foco
    }
commands-hide-show-all = Mostrar todos os itens de novo
commands-hide-show-all-edit =
    { $all ->
        [yes] Mostrar todos os itens em todos os painéis
       *[no] Mostrar todos os itens no painel em foco
    }

## Os comandos de medição (measureCommands.ts) e a ferramenta de medição (measure.ts, useMeasure.ts).

commands-measure-no-host = Esta página não tem ferramenta de medição.
# $which é "first" ou "second"; $forms é commands-measure-forms.
commands-measure-arg-end =
    { $which ->
        [first] A primeira extremidade: { $forms }.
       *[second] A segunda extremidade: { $forms }.
    }
commands-measure-start = Medir entre dois pontos escolhidos
commands-measure-start-edit = Medir: escolha dois pontos
commands-measure-between = Medir entre dois pontos ou itens
commands-measure-between-edit = Medir de { $from } até { $to }
commands-measure-clear = Limpar as medições
commands-measure-clear-key = Escape (sem seleção)
commands-measure-forms = x,y,z (metros), prop:<slot>, member:<id> ou member:<id>.<joint> (por exemplo member:cy.wrist_r), point:<work point>
commands-measure-forms-named = x,y,z (metros), prop:<slot>, member:<id> ou member:<id>.<joint> (por exemplo member:cy.wrist_r), point:<work point> ou { $named }
commands-measure-named-end = { $name } (o ponto { $point })
commands-measure-end = { $what } ({ $at })
commands-measure-text = { $id }: { $cm } cm (horizontal { $horizontal }, vertical { $vertical }) de { $from } até { $to }
commands-measure-label = { $cm } cm · h { $horizontal } · v { $vertical }
commands-measure-label-named = { $id } { $cm } cm · h { $horizontal } · v { $vertical }
commands-measure-no-members = nenhum
commands-measure-no-member = Não há membro "{ $id }" no último quadro (membros: { $ids }).
commands-measure-no-joint = Não há articulação "{ $joint }" de { $id } (articulações: { $joints }).
commands-measure-no-prop = Não há prop "{ $slot }" com posição.
commands-measure-no-point = Não há ponto de trabalho "{ $name }" no último quadro.
commands-measure-bad-end = "{ $text }" não é uma extremidade. Informe { $forms }.
commands-measure-status-first = Medir: clique no primeiro ponto.
commands-measure-status-second = Medir: clique no segundo ponto.
commands-measure-status-miss = Medir: não há nada sob o ponto. Clique em um ponto da cena.

## O comando de papel de cebola (onionCommands.ts) e as palavras do estado dele (onion.ts).

commands-onion = Papel de cebola: as poses antes e depois do tempo do relógio
commands-onion-arg-on = True mostra o papel de cebola, false o oculta; sem ele, o papel de cebola alterna.
commands-onion-arg-step = O tempo entre duas cópias em ms (padrão 250).
commands-onion-arg-count = As cópias de cada lado do tempo do relógio (padrão 2: cinco poses com a pose atual).
commands-onion-arg-capture = True: toda captura (uma folha, lab_frame) também mostra o papel de cebola; padrão false.
commands-onion-no-host = Esta página não tem papel de cebola.
commands-onion-edit = Mostrar ou ocultar o papel de cebola
commands-onion-edit-show = Mostrar o papel de cebola
commands-onion-edit-hide = Ocultar o papel de cebola
commands-onion-words-off = papel de cebola desligado
commands-onion-words = papel de cebola ±{ $step } ms × { $count } (azul antes, laranja depois)
commands-onion-words-capture = papel de cebola ±{ $step } ms × { $count } (azul antes, laranja depois; nas capturas)

## As recusas de uma variante de layout (layoutFiles.ts, layoutIndex.ts). A CLI do lab (labs layout-save) e os
## comandos de layout do plugin as mostram.

commands-layout-name-length = Um nome de layout tem de 1 a { $max } caracteres.
commands-layout-name-bad = "{ $name }" não é um nome de layout: use letras minúsculas e dígitos, com um hífen entre as partes (bay-b).
commands-layout-name-word = "{ $name }" é uma palavra dos comandos: dê outro nome.
commands-layout-name-variant = "{ $name }" é o ID de uma variante de busca: dê outro nome.
commands-layout-doc-length = A linha de documentação de um layout tem no máximo { $max } caracteres.
commands-layout-doc-bad = A linha de documentação de um layout não tem quebra de linha nem nenhum dos caracteres ; | & $ ` < > \ ".
commands-layout-not-place = { $path } não é uma posição de um layout ({ $prefixes }).
commands-layout-not-tuned = { $path } não é um número ajustado.
commands-layout-not-finite = O valor de { $path } não é um número finito.
commands-layout-bad-file = { $name }.json não é um layout (name, doc, camera, tunes de room.props.* e routes.*).

## Os motivos e os títulos dos comandos de cena do núcleo nos menus.

command-needs = Selecione { $kinds } primeiro.
command-needs-or-arg = Selecione { $kinds } primeiro (ou informe o argumento { $arg }).
command-kind-any = algo
command-kind-entity = uma entidade
command-kind-or = { " " }ou{ " " }
command-reason-no-solo = Nenhuma entidade está isolada.
command-reason-clipboard-empty = A área de transferência está vazia.
settings-command-component-add = Adicionar um componente às entidades
settings-command-component-remove = Remover um componente das entidades
