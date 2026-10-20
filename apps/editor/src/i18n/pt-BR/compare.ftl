# SPDX-License-Identifier: Apache-2.0

### Os textos da vista de comparação do núcleo do lab (core/compare).

## Os controles da vista de comparação (ComparePage.vue). Os nomes das tomadas e das câmeras são valores de dados.

compare-title = Comparar
compare-side = Lado { $side }
compare-code = Código
compare-code-now = atual
compare-code-hash = { $hash } (índice)
compare-camera = Câmera
compare-view = Vista
compare-mode-side = Lado a lado
compare-mode-wipe = Cortina (W)
compare-play = Reproduzir os dois
compare-pause = Pausar os dois
compare-play-title = Reproduzir os dois (Space)
compare-pause-title = Pausar os dois (Space)
compare-time = O tempo dos dois lados
compare-drawing = Desenhando…
# A fonte do quadro de cada lado e o tempo para obtê-lo.
compare-status = A: { $aFrom ->
        [index] índice { $aMs } ms
        [render] renderização { $aMs } ms
        [none] nenhum { $aMs } ms
       *[empty] —
    } · B: { $bFrom ->
        [index] índice { $bMs } ms
        [render] renderização { $bMs } ms
        [none] nenhum { $bMs } ms
       *[empty] —
    }

## As duas imagens (CompareStage.vue, sources.ts).

compare-no-take = sem tomada
compare-frame-alt = { $label } em { $time }
compare-frame-loads = O quadro está carregando.
compare-alt-a = A: { $label }
compare-alt-b = B: { $label }
compare-wipe-a = A { $label } { $time }
compare-wipe-b = B { $label } { $time }
compare-split = A linha da cortina: a parcela de A

## As notas de um quadro (compareFrames.ts).

compare-no-frame-no-lab = Sem quadro e sem lab.
compare-no-older-frame = O índice não tem quadro deste hash de conteúdo e desta câmera.
compare-nearest-frame = O quadro mais próximo: { $seconds } s.
