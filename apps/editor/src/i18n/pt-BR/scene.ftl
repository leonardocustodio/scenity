# SPDX-License-Identifier: Apache-2.0

### Os textos da estrutura da página de cena: a barra de arquivo, seus avisos, o
### cartão de propostas, o painel de inspeção e os textos de erro da página.

## O título da página e a barra de arquivo. Os specs leem os textos de estado do en-US.

scene-page-title = Cena do Scenity
scene-page-title-dirty = * Cena do Scenity
scene-bar-save = Salvar
scene-bar-save-title = Salvar o arquivo da cena (⌘S)
scene-state-saved = salvo
scene-state-unsaved = não salvo
scene-state-saving = salvando
scene-state-rule-fails = não salvo: uma regra falha
scene-state-not-saved = não salvo: { $reason }

## As recusas de um salvamento.

scene-save-no-edit-mode = A página não tem modo de edição (edit=1).
scene-save-drag = Um arraste está em andamento.
scene-save-play = Pare o modo de jogo antes de salvar.
scene-file-save-failed = o salvamento falhou ({ $status })
scene-file-create-failed = a criação falhou ({ $status })

## Os avisos da barra de arquivo: uma regra que falha, um rascunho local, um arquivo que mudou no disco. Cada um
## é uma caixa de diálogo da janela do editor com um título.

scene-notice-title-draft = Restaurar o rascunho?
scene-notice-title-conflict = O arquivo mudou no disco
scene-notice-title-rules = Uma regra impede o salvamento
scene-notice-title-scene = Cenas

scene-rules-notice = Não salvo. { $reason }
scene-rules-reason = Motivo para salvar mesmo assim (ele vai para o log ao lado da cena)
scene-rules-save = Salvar com o motivo
scene-notice-cancel = Cancelar
scene-draft-offer = Um rascunho local desta cena de { $time } tem alterações não salvas.
scene-draft-offer-stale = Um rascunho local desta cena de { $time } tem alterações não salvas. O arquivo mudou no disco depois do rascunho.
scene-draft-restore = Restaurar
scene-draft-discard = Descartar
scene-draft-changes = As alterações do rascunho
# A atualização de um arquivo de um formato mais antigo.
scene-upgrade-title = Atualizar o formato do arquivo
scene-upgrade-text = Este arquivo tem o formato { $from }. O editor o lê como { $to }; Atualizar salva o arquivo nesse formato.
scene-upgrade-changes = As alterações do arquivo
scene-upgrade-save = Atualizar
scene-upgrade-later = Agora não
scene-draft-none = Nenhum rascunho.
scene-draft-unread = Não foi possível ler o rascunho: { $reason }
scene-conflict = O arquivo da cena mudou no disco depois do carregamento. Recarregue-o (suas alterações serão perdidas) ou sobrescreva-o.
scene-conflict-reload = Recarregar
scene-conflict-overwrite = Sobrescrever

## Os títulos dos passos do histórico da página. Uma alteração do estado da vista ou do conjunto de prefabs fora de uma
## edição recebe o título do seu canal.

scene-history-edit = Edição
scene-history-restore-draft = Restaurar o rascunho
scene-history-view = vista
scene-history-prefabs = prefabs

## O cartão de propostas: as edições do Claude que aguardam o dono.

scene-proposals = Propostas
scene-proposals-count = Propostas: { $count }
scene-proposal-claude = { $title } (Claude)
scene-proposal-by = { $title } ({ $by })
scene-proposal-accept = Aceitar
scene-proposal-reject = Rejeitar

## O painel de inspeção. As células e o detalhe são dados brutos do relatório: eles ficam como estão.

scene-inspect = Inspecionar
scene-inspect-refresh = Atualizar
scene-inspect-layers = Camadas de depuração
scene-inspect-totals = { $entities } entidades, { $triangles } triângulos, { $calls } chamadas de desenho próprias
scene-inspect-head-entity = Entidade
scene-inspect-head-components = Componentes
scene-inspect-head-position = Posição
scene-inspect-head-size = Tamanho
scene-inspect-head-triangles = Triângulos
scene-inspect-head-draws = Desenhos
scene-inspect-head-batch = Lote
scene-inspect-head-joints = Juntas
scene-inspect-batched = sim
scene-inspect-toggle = Abrir ou fechar o painel de inspeção

## As regras da página.

scene-rules-file-unread = não foi possível ler o arquivo de regras

## Os textos de erro da página. A linha de status os mostra depois de "Erro da cena".

scene-error = Erro da cena: { $reason }
scene-error-project = "{ $project }" não é um nome de projeto
scene-error-no-canvas = a página não tem canvas
scene-error-no-camera = nenhuma câmera "{ $camera }"
scene-error-tier = "{ $tier }" não é um nível de qualidade
scene-error-output = "{ $output }" não é uma pasta de saída do projeto
scene-error-origin = "{ $origin }" não é uma origem de assets
scene-error-no-build = o projeto em { $base } não tem build
scene-error-no-scene = nenhuma cena em { $url } ({ $status })
scene-error-no-scene-list = nenhuma lista de cenas em { $base } ({ $status })
scene-error-no-sequence = nenhuma sequência em { $url } ({ $status })
scene-error-no-index = nenhum índice de assets em { $base } ({ $status })

## A página de cena sem projeto no endereço (projects/noProject.ts).

scene-no-project = Nenhum projeto está aberto. Execute scenity studio para abrir o Hub com seus projetos, ou scenity dev em uma pasta de projeto.

## Os comandos de arquivo e de projeto.

command-scene-new = Nova cena
command-scene-open = Abrir uma cena
command-scene-save = Salvar a cena
command-scene-save-as = Salvar a cena como
command-scene-close = Fechar a cena
command-sequence-new = Nova sequência
command-sequence-open = Abrir uma sequência
command-sequence-path = O caminho de uma sequência termina com .sequence.json.
command-arg-sequence-path = O caminho do arquivo da sequência no projeto.
command-prefab-create = Criar um prefab da seleção
command-prefab-variant = Criar uma variante do prefab
command-prefab-variant-none = Selecione primeiro uma instância de um prefab.
command-prefab-variant-asset = Uma variante precisa de um arquivo de prefab do projeto, não de um asset de prefab.
command-material-new = Novo material
command-project-set = Definir uma configuração do projeto
command-name = Nome
command-path = Caminho no projeto
command-prompt-go = OK
command-prompt-cancel = Cancelar
command-no-scenes = Esta página não edita nenhum arquivo de cena.
command-no-materials = Esta página não tem editor de materiais.
command-prefab-none = Selecione primeiro as entidades do prefab.
command-file-made = { $path } criado
command-conflict = O arquivo mudou no disco.
command-project-json = O valor não é um valor JSON: { $value }
command-failed = { $id } não foi executado
command-arg-path = O caminho do arquivo da cena no projeto.
command-arg-scene-name = O nome da nova cena.
command-arg-file-name = O nome do novo arquivo.
command-arg-root = A entidade raiz (padrão: a entidade selecionada).
command-arg-instance = A instância do prefab (padrão: a entidade selecionada).
command-arg-setting = A configuração do projeto.
command-arg-value = O valor como JSON, por exemplo 0.05 ou "animate".

## Ajustar a última ação.

adjust-label = Ajustar a última ação
adjust-title = Ajustar: { $title }
adjust-close = Fechar o painel de ajuste

## A sincronização de documentos do studio.

sync-remote-title = Uma alteração de outra janela
sync-again-title = A sua alteração, depois da alteração de outra janela

## O título da janela.

window-title = { $scene } · { $project } · Scenity
window-title-dirty = * { $scene } · { $project } · Scenity

diff-add = { $name }: nova entidade
diff-remove = { $name }: removida
diff-move = { $name }: movida para dentro de { $parent }
diff-move-root = { $name }: movida para a raiz
diff-add-component = { $name }: novo componente { $component }
diff-remove-component = { $name }: componente { $component } removido
diff-set = { $name }: { $field } { $before } → { $after }
diff-set-scene = Cena: { $field } { $before } → { $after }
diff-unknown = Não é possível mostrar as alterações como uma lista.
diff-more = { $count ->
    [one] mais { $count } alteração
   *[other] mais { $count } alterações
}
scene-conflict-diff = Ver o diff
scene-conflict-diff-none = O arquivo no disco tem a mesma cena.

## Um prefab a partir da seleção. $name é o nome do novo prefab (dado).

command-prefab-made = Criar o prefab { $name }
command-prefab-variant-made = Criar a variante { $name }
command-arg-folder = A pasta do projeto para o novo prefab (padrão: prefabs).
command-arg-replace = False: gravar apenas o arquivo do prefab e manter a seleção como está.

## Os auxiliares de posicionamento (Entidade ▸ Posicionar). $entity é um ID de entidade (dado).

place-command-align = Alinhar a seleção em um eixo
place-command-spread = Distribuir a seleção em um eixo
place-command-dropToFloor = Baixar até o chão
place-command-on = Colocar sobre um alvo
place-command-against = Encostar em um lado de um alvo
place-command-near = Colocar perto de um alvo
place-command-facing = Girar para ficar de frente para um alvo
place-command-findSpace = Encontrar um lugar livre no chão
place-no-entities = Selecione primeiro as entidades a posicionar.
place-no-report = A vista ainda não fornece as caixas das entidades.
place-no-box = A entidade { $entity } não tem caixa na vista.
place-no-space = Nenhum lugar livre perto de { $entity }.
place-arg-entities = Os IDs das entidades separados por vírgulas (padrão: a seleção).
place-arg-entity = Um ID de entidade (padrão: a seleção).
place-arg-target = O ID da entidade alvo.
place-arg-axis = x, y ou z (padrão x).
place-arg-edge = min, centre ou max (padrão min).
place-arg-side = +x, -x, +z ou -z (padrão +x).
place-arg-angle = A direção em torno do eixo vertical, em graus (0: +Z, 90: +X).
place-arg-gap = O espaço entre as duas caixas, em metros (padrão 0.3).
place-arg-face = True: a entidade gira para ficar de frente para o alvo.
place-arg-near = Buscar um lugar perto desta entidade (padrão: onde a entidade está).

## O aviso de uma recarga a quente de um asset. $file é um arquivo do projeto (dado).

scene-asset-reloaded = { $file } mudou: a vista mostra a nova importação.
scene-asset-reload-failed = { $file } mudou, mas a nova importação não carregou.
