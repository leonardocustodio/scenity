# SPDX-License-Identifier: Apache-2.0

### Os textos da janela do editor do Scenity Studio (src/studio/shell).

## Os painéis (o registro, src/studio/shell/panels.ts).

panel-scene-view = Cena
panel-inspector = Inspetor
panel-hierarchy = Hierarquia
panel-project = Projeto
panel-timeline = Linha do tempo
panel-rules = Regras
panel-material = Material
panel-lighting = Iluminação
panel-project-settings = Configurações do projeto
panel-shortcuts = Atalhos
panel-vcs = Controle de versão
panel-jobs = Jobs
panel-plugins = Plugins
panel-budgets = Orçamentos
panel-preferences = Preferências
panel-loading = Carregando…
panel-unknown = Este painel não está disponível neste projeto.
# $title é o título do painel; $copy é o número da cópia (2 ou mais).
panel-copy = { $title } { $copy }
# $title é o título do painel.
panel-open = Abrir o painel { $title }
panel-close = Fechar { $title }

## O menu Janela e os comandos do dock.

menu-window = Janela
window-maximize = Maximizar o painel
window-float = Tornar o painel flutuante ou fixá-lo no dock
window-copy = Nova cópia do painel
window-move-left = Mover o painel para a esquerda
window-move-centre = Mover o painel para o centro
window-move-right = Mover o painel para a direita
window-move-bottom = Mover o painel para a parte inferior
window-close = Fechar o painel
window-next = Próximo painel
window-previous = Painel anterior
window-reset = Redefinir o layout
panel-none = Nenhum painel está ativo.
panel-no-copy = O painel ativo não pode ter cópias.
layout-not-custom = Só um espaço de trabalho seu pode mudar de nome ou ser excluído.
workspace-switch = Mostrar um espaço de trabalho
workspace-arg-id = O ID do espaço de trabalho, por exemplo layout ou animate.
workspace-arg-name = O nome do espaço de trabalho (nenhum: perguntar à pessoa).

## Os espaços de trabalho e o menu Layout.

workspace-label = Espaços de trabalho
workspace-layout = Layout
workspace-animate = Animação
workspace-assets = Assets
workspace-review = Revisão
workspace-build = Build
layout-menu = Layout
layout-save-as = Salvar como…
layout-rename = Renomear…
layout-delete = Excluir
layout-reset = Redefinir
layout-save-title = Salvar o layout como um espaço de trabalho
layout-rename-title = Renomear o espaço de trabalho
layout-name = Nome
layout-name-save = Salvar
layout-cancel = Cancelar

## As caixas de diálogo, os avisos e os banners da janela.

notice-dismiss = Dispensar
# $path é o caminho do arquivo da cena.
notice-saved = { $path } salvo
notice-playing = Em execução: as edições do modo de jogo não são salvas.
notice-restricted = Modo restrito: os plugins deste projeto não são executados até você confiar nele.
notice-viewer = Só visualização: você olha este projeto e deixa notas. Uma alteração precisa de um link com o papel de editor, do dono.
notice-viewer-locked = Quem visualiza não altera nada: peça ao dono do estúdio um link com o papel de editor.
notice-restricted-owner = Modo restrito: os plugins deste projeto não são executados até o dono do estúdio confiar nele.
role-owner-only = Só o dono do estúdio faz isto, não um editor nem quem visualiza.
role-remote-shell = O estúdio em modo remoto não abre shell. Use o terminal do Claude.
role-editor-auto = Um editor escolhe Perguntar ou Revisar. Só o dono do estúdio escolhe Automático.
role-remote-files = Modo remoto: cada gravação de arquivo de um agente pergunta, também no modo Automático.
notice-trust = Confiar neste projeto…
notice-trust-title = Confiar neste projeto?
# $name é o nome do projeto.
notice-trust-text = Os plugins de { $name } executam código nesta máquina. Confie nele apenas quando você souber de onde ele vem.
notice-trust-yes = Confiar e recarregar
notice-trust-no = Agora não

## A barra de status.

status-label = Status
status-save-title = O estado do arquivo da cena (um clique salva)
status-selection =
    { $count ->
        [0] Nada selecionado
       *[other] Selecionados: { $count }
    }
status-selection-title = A seleção (um clique a enquadra)
# $count é o número de jobs em execução.
status-jobs = Jobs: { $count }
status-problems-title = As regras que falham e os avisos (um clique abre o painel Problemas)
status-render-title = O backend, o nível e a taxa de quadros (um clique abre o painel de inspeção)
# $fps é o número de quadros por segundo.
status-fps = { $fps } fps
# $count é o número de fatos que precisam de uma ação.
status-bell = Notificações: { $count }
status-bell-empty = Nada precisa de uma ação.

## Os trilhos de uma janela pequena.

fold-left = Painéis da esquerda
fold-right = Painéis da direita

## A barra de menus.

menu-bar = Barra de menus
menu-file = Arquivo
menu-edit = Editar
menu-assets = Assets
menu-entity = Entidade
menu-component = Componente
menu-sequence = Sequência
menu-agent = Agente
menu-build = Build
menu-help = Ajuda
menu-window-theme = Tema
menu-window-split = Vista dividida
menu-sequence-loop = Intervalo de repetição
menu-entity-create = Criar
menu-entity-place = Posicionar
menu-agent-recipes = Receitas
menu-edit-camera = Câmera do editor
menu-edit-selectBy = Selecionar por
# Os rótulos curtos dos comandos nos menus (senão o menu mostra o título do comando).
menu-item-file-save = Salvar
menu-item-history-undo = Desfazer
menu-item-history-redo = Refazer
menu-item-entity-copy = Copiar
menu-item-entity-paste = Colar
menu-item-entity-duplicate = Duplicar
menu-item-entity-delete = Excluir
menu-item-entity-rename = Renomear
menu-item-view-frame = Enquadrar
menu-item-play-start = Jogar
menu-item-play-replay = Jogar de novo
menu-item-play-stop = Parar
menu-item-entity-add = Criar entidade vazia
menu-item-entity-hide = Ocultar ou mostrar
menu-item-entity-solo = Isolar
menu-item-view-show-all = Mostrar tudo
menu-item-entity-lock = Bloquear
menu-item-sequence-track-add = Adicionar uma trilha
menu-item-sequence-key-add = Adicionar uma chave
menu-item-sequence-marker-add = Adicionar um marcador
menu-item-clock-toggle = Reproduzir ou pausar
menu-item-panel-open-preferences = Preferências
menu-item-theme-dark = Escuro
menu-item-theme-light = Claro
menu-item-theme-navy = Azul-marinho
menu-item-theme-contrast = Alto contraste

## Buscar e perguntar.

search-label = Buscar e perguntar
search-placeholder = Buscar comandos, entidades, assets, arquivos, configurações e documentação (> @ # ?)
search-results = Resultados
search-docs = A documentação de { $label } (F1)
search-empty = Nenhum resultado.
search-ask = Perguntar ao agente: “{ $text }”
search-ask-none = Nenhum agente está conectado: o painel do agente (⌘L) explica como conectar um.
search-kind-agent = Agente
search-kind-commands = Comandos
search-kind-entities = Entidades
search-kind-assets = Assets
search-kind-files = Arquivos
search-kind-settings = Configurações
search-kind-docs = Documentação
search-command-open = Buscar e perguntar
search-command-scene = Buscar as entidades da cena
search-command-window = Abrir a janela Busca

## A janela Busca. $count é um número de entidades; $text é uma busca salva; $field é o caminho de um campo e
## $entity o nome de uma entidade.

panel-search = Busca
search-window-label = Buscar no projeto
search-window-placeholder = c:light intensity>2, t:model, tag:madeira, > comandos, # assets
search-window-kind = Tipo de resultados
search-window-all = Todos os tipos
search-window-save = Salvar
search-window-saved = Buscas salvas
search-window-remove = Remover a busca salva “{ $text }”
search-window-hint = Digite uma busca. Uma comparação como intensity>2 adiciona uma coluna que você pode editar.
search-window-entities =
    { $count ->
        [one] { $count } entidade
       *[other] { $count } entidades
    }
search-window-select-all = Selecionar tudo
search-window-name = Nome
search-window-components = Componentes
search-window-cell = { $field } de { $entity }

## A folha de teclas e os comandos de ajuda.

keys-title = Teclas
keys-filter = Filtrar as teclas
keys-kind-held = segurar
keys-kind-modal = durante um arraste
keys-context-global = Em todo lugar
keys-context-scene = Vista da cena e painéis laterais
keys-context-hierarchy = Hierarquia
keys-context-dock = Painéis inferiores
keys-context-sequencer = Linha do tempo
keys-context-fly = Voo (o botão direito está pressionado)
keys-context-drag = Um arraste de gizmo
help-command-keys = Mostrar a folha de teclas
help-command-tour = Fazer o tour
help-command-context = Ajuda do painel ativo
menu-item-help-keys = Teclas
menu-item-help-context = Ajuda sobre isto

## O log de atividade.

panel-activity = Atividade
activity-lines = As execuções dos comandos, as mais recentes primeiro
activity-empty = Nenhum comando foi executado ainda.
activity-person = Você
activity-agent = Agente
activity-script = Script
activity-plugin = Plugin
activity-outcome-applied = aplicado
activity-outcome-proposed = aguarda você
activity-outcome-unchanged = nenhuma alteração
activity-outcome-ran = executado
activity-copy-script = Copiar como uma chamada de script
activity-copy-prompt = Copiar como um prompt
activity-prompt-batch = Execute estes comandos do editor como um passo “{ $title }”: { $steps }.
activity-prompt-command = Execute o comando do editor { $command } com { $args } ({ $title }).

panel-history = Histórico
history-steps = Os passos do histórico
history-start = A cena como foi aberta
history-person = Você
history-actor-agent = Um agente
history-actor-script = Um script
history-actor-plugin = Um plugin
history-turn = { $name }: turno { $turn }
command-history-go-to = Ir para um passo do histórico
history-go-to-none = Não há passo { $step } para onde ir.
history-group = Histórico
history-undo-step = Desfazer { $step }
history-redo-step = Refazer { $step }
history-undo-none = Nada para desfazer
history-redo-none = Nada para refazer
panel-console = Console
console-source = Origem
console-source-all = Todas as origens
console-source-page = Página
console-source-worker = Worker
console-source-server = Servidor
console-source-host = Host
console-source-plugin = Plugin
console-source-job = Job
console-source-agent = Agente
console-search = Buscar no log
console-clear = Limpar
console-lines = As linhas do log
console-empty = Nenhuma linha.
console-detail = A linha
console-detail-facts = { $source } · { $count ->
    [one] uma vez
   *[other] { $count } vezes
}
console-level-error = { $count } erros
console-level-warn = { $count } avisos
console-level-info = { $count } mensagens
console-level-name-error = Erro
console-level-name-warn = Aviso
console-level-name-info = Mensagem
console-server-error = O servidor de desenvolvimento retornou um erro.
console-job-failed = { $line } falhou (código de saída { $code })
console-rejection = Rejeição não tratada: { $reason }
