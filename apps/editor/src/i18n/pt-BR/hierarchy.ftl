# SPDX-License-Identifier: Apache-2.0

### Os textos do painel de hierarquia da página da cena (scene/hierarchy).

## O painel (HierarchyPanel.vue).

hierarchy-title = Hierarquia
hierarchy-show-all = Mostrar tudo
hierarchy-show-all-title = Remover o isolamento
hierarchy-search-label = Buscar por nome, tag ou componente
# As palavras "tag:" e "component:" são chaves de busca. Mantenha-as em inglês.
hierarchy-search-placeholder = Buscar: nome, tag:…, component:…
hierarchy-tree = Entidades
hierarchy-empty = Nenhuma entidade corresponde.

## Uma linha da árvore (HierarchyRow.vue). $name é o nome da entidade.

hierarchy-collapse = Recolher
hierarchy-expand = Expandir
hierarchy-rename-field = Novo nome de { $name }
hierarchy-instance = Instância de prefab
# $count é o número de substituições da instância ou da entidade do prefab.
hierarchy-overrides =
    { $count ->
        [one] { $count } substituição do prefab
       *[other] { $count } substituições do prefab
    }
hierarchy-hide = Ocultar { $name }
hierarchy-unhide = Mostrar { $name }
hierarchy-hide-title = Ocultar (salvo na cena)
hierarchy-unhide-title = Mostrar (salvo na cena)
hierarchy-solo = Isolar { $name }
hierarchy-solo-title = Isolar (só na vista do editor)
hierarchy-lock = Bloquear { $name }
hierarchy-unlock = Desbloquear { $name }
hierarchy-lock-title = Bloquear: sem seleção e sem arrastar na viewport (só na vista do editor)

## O menu de contexto (HierarchyMenu.vue, hierarchyState.ts).

hierarchy-menu = Ações da entidade
hierarchy-menu-add-entity = Adicionar uma entidade vazia
hierarchy-menu-paste = Colar
hierarchy-menu-add-child = Adicionar um filho vazio
hierarchy-menu-duplicate = Duplicar
hierarchy-menu-copy = Copiar
hierarchy-menu-paste-child = Colar como filho
hierarchy-menu-rename = Renomear
hierarchy-menu-delete = Excluir
hierarchy-menu-prefab-open = Abrir prefab
# As ações de uma linha de instância: elas agem sobre todas as substituições da instância.
hierarchy-menu-prefab-apply = Aplicar as substituições ao prefab
hierarchy-menu-prefab-revert = Reverter as substituições
# As ações de uma linha de prefab: elas agem sobre as substituições dessa entidade do prefab.
hierarchy-menu-prefab-apply-entity = Aplicar as substituições da entidade ao prefab
hierarchy-menu-prefab-revert-entity = Reverter as substituições da entidade

## As recusas que o painel mostra, e o comando de tecla (hierarchyState.ts, hierarchyKeys.ts).

hierarchy-no-prefab-tools = A página não tem ferramentas de prefab.
hierarchy-rename-command = Renomear a entidade na hierarquia
hierarchy-rename-none = Nenhuma entidade para renomear.
selection-all = Selecionar tudo
selection-clear = Limpar a seleção
selection-invert = Inverter a seleção
selection-children = Selecionar os filhos
selection-back = Voltar na seleção
selection-forward = Avançar na seleção
selection-none = Nada está selecionado.
selection-history-start = Nenhuma seleção antes desta.
selection-history-end = Nenhuma seleção depois desta.
selection-by-tag = Selecionar por tag
selection-by-tag-label = A tag
selection-by-component = Selecionar por componente
selection-by-component-label = O ID do componente, por exemplo light
selection-by-kind = Selecionar por tipo
selection-by-kind-label = O tipo: model, light, camera, sound ou note
hierarchy-create = Criar uma entidade

## As entradas das predefinições de criação e a câmera a partir da vista.

create-ask-prefab = Criar uma instância de prefab
create-ask-prefab-label = O prefab: um caminho .prefab.json ou asset:<id>
create-ask-character = Criar um personagem
create-ask-character-label = O modelo do personagem: asset:<id>
create-ask-cancelled = A criação foi cancelada: nenhuma entrada.
create-camera-from-view = Criar uma câmera a partir da vista
create-camera-from-view-none = A vista ainda não tem câmera.
create-camera-name = Câmera
hierarchy-menu-prefab-unpack = Desempacotar a instância

## O painel Tags. $name é uma tag ou uma camada de seleção (dado).

panel-tags = Tags
tags-tags = Tags
tags-layers = Camadas de seleção
tags-none = Nenhuma na cena.
tags-select = Selecionar as entidades com { $name }
tags-rename = Renomear
tags-rename-label = O novo nome de { $name }

## As notas da cena. $text é o texto de uma nota e $entity um ID de entidade (dado); $count é um número.

panel-notes = Notas
hierarchy-notes =
    { $count ->
        [one] { $count } nota nesta entidade
       *[other] { $count } notas nesta entidade
    }
notes-pin = Nota: { $text }
notes-filter = As notas visíveis
notes-filter-all = Todas as notas
notes-filter-open = Notas abertas
notes-filter-done = Notas concluídas
notes-filter-none = Nenhum pino
notes-count =
    { $count ->
        [one] { $count } nota
       *[other] { $count } notas
    }
notes-new = Uma nova nota na seleção (ou na vista)
notes-add = Adicionar
notes-done = Concluir
notes-open = Reabrir
notes-send = Enviar
notes-remove = Remover
# A conversa de uma nota.
notes-thread = { $count ->
    [0] Responder
    [one] { $count } resposta
   *[other] { $count } respostas
}
notes-reply = Uma resposta
notes-reply-send = Responder
notes-reply-anonymous = Alguém
notes-send-prompt = Uma nota sobre { $entity }: { $text }
