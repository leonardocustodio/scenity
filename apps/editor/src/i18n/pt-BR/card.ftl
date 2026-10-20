# SPDX-License-Identifier: Apache-2.0

### Os textos do cartão de seleção sobre a cena da página do lab e do seu bloco escolhido (src/core/edit).

## O cabeçalho do cartão (SelectionCard.vue).

card-selection = Seleção
card-grip = Mover os cartões (setas; Home os devolve ao lugar)
card-grip-title = Arraste para mover os cartões; um clique duplo os devolve ao lugar
card-unfold = Mostrar o cartão inteiro
card-fold = Recolher o cartão
card-fold-title = Recolher o cartão até o cabeçalho
card-clear = Limpar a seleção
card-clear-title = Limpar a seleção (Escape)
card-drag-move = mover…
card-drag-turn = girar…
card-drag-lift = elevar…

## Os dados do item selecionado. Os valores são dados.

card-field-slot = slot
card-field-asset = asset
card-field-place = lugar
card-field-bone = osso
card-field-near = perto de
card-tune-keys = Chaves de ajuste
card-prop-keys = Arrastar: mover (Shift 10 cm) · Shift+arrastar: girar · Alt+arrastar: elevar · R: girar 15° (Alt 1°)
card-prop-propose = ⌘ com um arraste: propor (um fantasma)

## Salvar posicionamento e seu bloqueio de layout.

card-gate =
    { $count ->
        [one] Salvar posicionamento está bloqueado: { $count } verificação de layout falha (limites provisórios)
       *[other] Salvar posicionamento está bloqueado: { $count } verificações de layout falham (limites provisórios)
    }
card-override = Motivo para salvar com uma verificação de layout em falha
card-override-placeholder = Motivo para salvar mesmo assim (vai junto com o posicionamento)…
card-undo = Desfazer
card-undo-title = Desfazer (⌘Z)
card-redo = Refazer
card-redo-title = Refazer (⇧⌘Z)
card-save-dry = Salvar posicionamento (execução de teste)
card-save-apply = Aplicar ao código-fonte do runtime
card-placement-dry = { $status } (execução de teste)

## As marcas.

card-mark = Marcar
card-mark-done = Concluir a marcação
card-marks-clear =
    { $count ->
        [one] Limpar { $count } marca
       *[other] Limpar { $count } marcas
    }

## Perguntar ao Claude (SelectionCard.vue, useEditPanel.ts).

card-ask = Perguntar ao Claude sobre a seleção
card-ask-placeholder-workbench = Pergunte ao Claude sobre isto…
card-ask-placeholder = Pergunte ao Claude (copia a solicitação)…
card-ask-send = Perguntar
card-ask-sent = Enviado ao workbench…
card-ask-terminal = Enviado ao terminal do Claude com o bloco escolhido.
card-ask-chat = Enviado ao chat com o bloco escolhido.
card-ask-no-session = Nenhuma sessão do Claude: abra a aba Claude do workbench e pergunte de novo.
card-ask-clipboard = Sem workbench: a solicitação e o bloco escolhido estão na área de transferência.
card-ask-no-clipboard = Sem workbench e sem área de transferência: copie o bloco escolhido do cartão.

## O bloco escolhido (pickedItem.ts): o cartão o mostra, e o prompt da pergunta o leva. O código coloca dois espaços
## antes de cada linha depois da primeira linha.

card-picked-block = Bloco escolhido
card-picked = Escolhido: { $kind } { $id }
card-picked-bone = Escolhido: { $kind } { $id }, osso { $bone }
card-picked-asset = asset: { $id } ({ $file })
card-picked-scratch = prop provisório da importação { $import } ({ $name }), apenas uma entrada do lab
card-picked-rights = fonte "{ $source }", licença "{ $licence }"
card-picked-rights-gap = fonte "{ $source }", licença "{ $licence }" (direitos não permitidos: { $gap })
card-picked-place = lugar: x { $x }, y { $y }, z { $z }, giro { $turn }°
card-picked-tunes = chaves de ajuste: { $keys }
card-picked-point = ponto de contato: { $point }
card-picked-near = perto de: { $points }
card-picked-warning = aviso: { $warning }
