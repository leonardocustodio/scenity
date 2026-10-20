# SPDX-License-Identifier: Apache-2.0

### As palavras das partes do editor de cena da página do lab: a paleta de comandos, o cartão de propostas,
### "Salvar câmera" e a seção Luz da aba Ajuste.

## A paleta de comandos (CommandPalette.vue).

palette-dialog = Paleta de comandos
palette-command = Comando
palette-query = Digite um comando…
palette-close = Fechar (Escape)
palette-close-label = Fechar a paleta
palette-commands = Comandos
palette-none = Nenhum comando corresponde.
palette-arg-none = (nenhum)
palette-run = Executar
palette-back = Voltar

## O cartão de propostas (ProposalCard.vue) e as linhas de operação de uma proposta (ghosts.ts).

palette-proposals = Propostas
palette-proposals-count = Propostas · { $count }
palette-proposals-hint = os fantasmas as mostram
palette-operations = Operações
palette-by-owner = você
palette-by-claude = Claude
palette-by-script = script
palette-shown-ghost = fantasma
palette-shown-marker = marcador
palette-shown-card = só o cartão
# $value contém a unidade da verificação; $limit é o texto do limite do plugin.
palette-proposal-breaks = viola { $id } { $value } · { $limit }
palette-proposal-mends = corrige { $id }
# $summary é o resumo das verificações de layout do plugin.
palette-proposal-no-change = verificações de layout: sem alteração ({ $summary })
palette-proposal-accept = Aceitar
palette-proposal-accept-label = Aceitar { $id }
palette-proposal-reject = Rejeitar
palette-proposal-reject-label = Rejeitar { $id }
palette-proposals-accept-all = Aceitar todas
palette-proposals-reject-all = Rejeitar todas
palette-op-tune-default = { $path } = padrão
palette-op-source = { $tool } (fonte)
palette-op-place = { $member } → { $to } (posicionar, { $at } ms)
palette-op-prop = { $slot } → { $where } (a partir de { $at } ms)
palette-op-prop-tuned = { $slot } → seu lugar ajustado (a partir de { $at } ms)
palette-op-event = evento { $kind } em { $at } ms

## "Salvar câmera" e os favoritos de câmera da aba Vista (CameraSave.vue, useCameraSave.ts).

palette-camera-save = Salvar câmera
palette-camera-name = Nome da câmera
palette-camera-name-hint = Nome, por exemplo bay-foot
palette-camera-doc = Linha de documentação
palette-camera-doc-hint = Linha de documentação (opcional): o que a vista mostra
palette-camera-replace = Substituir uma câmera de mesmo nome
palette-camera-bookmark = Favorito
palette-camera-help = O salvamento pega a vista do painel em foco e a escreve no módulo de câmeras do plugin (labs camera-save), primeiro com uma execução de teste. Um favorito guarda a vista na URL (views=) e não escreve nada.
# O status da execução (um valor de dados) vem depois do texto.
palette-camera-result =
    { $dry ->
        [yes] { $name } (execução de teste):
       *[no] { $name }:
    }
palette-camera-no-workbench = Sem workbench: execute este comando na raiz do repositório.
palette-camera-copy = Copiar o comando
palette-camera-copied = O comando está na área de transferência.
palette-camera-no-clipboard = Sem área de transferência: selecione o comando e copie-o.
palette-camera-write = Escrever { $name } em cameras.ts
palette-camera-open-bookmark = Abrir o favorito { $name }
palette-camera-no-view = O salvamento não tem vista.

## A seção Luz da aba Ajuste (LightSection.vue).

palette-light = Luz
palette-light-handle = Alça (I)
palette-light-reset = Redefinir a luz
palette-light-key = Principal
palette-light-key-intensity = Intensidade da luz principal
palette-light-key-colour = Cor da luz principal
palette-light-fill = Preenchimento
palette-light-fill-intensity = Intensidade da luz de preenchimento
palette-light-fill-colour = Cor da luz de preenchimento
palette-light-sky = Céu
palette-light-sky-intensity = Intensidade da luz do céu
palette-light-sky-colour = Cor da luz do céu
palette-light-ground = Solo
palette-light-ground-hint = A cor inferior da luz do céu
palette-light-ground-colour = Cor do solo da luz do céu
palette-light-help = Arraste o ponto da alça para girar a luz principal (⌘: uma proposta). "Salvar posicionamento" escreve a luz no código.
