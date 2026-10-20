# SPDX-License-Identifier: Apache-2.0

### Os textos das configurações da página da cena (scene/settings). Os rótulos das configurações e
### os motivos de um valor recusado vêm de @scenity/editor-core e ficam em inglês.

## A aba de configurações do dock inferior (settingsTab.ts, SettingsPanel.vue).

settings-tab = Configurações
settings-panel = Configurações
settings-editor = Configurações do editor
# $file é o caminho do arquivo de configurações do projeto.
settings-intro = Os valores do projeto vão para { $file }; os outros valores ficam neste navegador.

## A origem do valor de uma configuração, o escopo de uma configuração e o botão de redefinir.

settings-source-project = arquivo do projeto
settings-source-user = este navegador
settings-source-default = padrão
settings-scope-project = Escopo: o arquivo do projeto prevalece
settings-scope-user = Escopo: este navegador prevalece
settings-reset-value = Voltar ao padrão

## O layout do projeto.

settings-layout = O layout da janela do editor
settings-layout-left = Painel de hierarquia
settings-layout-right = Painel do inspetor
settings-layout-reset = Redefinir o layout
settings-resize-title = Arraste para mudar o tamanho; clique duas vezes para abrir ou fechar

## O mapa de teclas. $id é o ID de um comando, e $commands é uma lista de IDs de comandos.

settings-keys = Teclas
settings-keys-search = Buscar um comando
settings-keys-capture = Pressione a nova tecla de { $id } (Escape: cancelar).
settings-keys-clash = A tecla de { $id } também é a tecla de { $commands }.
settings-keys-none = sem tecla
settings-keys-change = Alterar
settings-keys-add = Adicionar
settings-keys-clear = Limpar
settings-keys-reset = Redefinir

## Os comandos de página da barra de arquivo (startEditorSettings.ts).

settings-command-save = Salvar a cena
settings-command-undo = Desfazer
settings-command-redo = Refazer
settings-command-play = Iniciar ou parar o modo de jogo

## Os motivos pelos quais a página não pode gravar o arquivo de configurações. $file é o caminho do arquivo.

settings-refuse-no-file = A página não tem arquivo de projeto para gravar.
settings-refuse-changed = { $file } mudou no disco.

## Os rótulos dos campos de configuração de @scenity/editor-core (SETTING_FIELDS), pelo caminho do campo.

settings-field-title = Configuração { $path }
settings-field-snaps-grid = Encaixe na grade
settings-field-snaps-angle-degrees = Encaixe de ângulo
settings-field-snaps-scale = Encaixe de escala
settings-field-view-mode = Modo de visualização
settings-field-view-grid = Grade
settings-field-camera-fly-speed = Velocidade de voo
settings-field-camera-fly-fast-speed = Velocidade de voo (Shift)
settings-field-camera-look-speed = Velocidade de giro
settings-field-camera-look-fast-speed = Velocidade de giro (Shift)
settings-field-camera-orbit-speed = Velocidade de órbita
settings-field-camera-zoom-speed = Velocidade de zoom
settings-field-dock-tab = Painel inferior padrão
settings-field-dock-height = Altura inferior padrão
settings-field-layout-workspace = Espaço de trabalho padrão
settings-field-recent-count = Cenas recentes

## Os títulos dos comandos de @scenity/editor-core no mapa de teclas, pelo ID do comando.

settings-command-entity-duplicate = Duplicar as entidades
settings-command-entity-delete = Excluir as entidades (com os seus filhos)
settings-command-entity-copy = Copiar as entidades (com os seus filhos)
settings-command-entity-paste = Colar as entidades da área de transferência
settings-command-entity-hide = Ocultar ou mostrar as entidades
settings-command-entity-solo = Isolar as entidades
settings-command-view-show-all = Mostrar todas as entidades (sem isolamento)
# $id é o ID de um comando.
settings-command-none = Nenhum comando { $id }.
settings-keys-fixed = Fixa (uma tecla de um gesto)

## O tema da janela do editor.

settings-theme = Tema
settings-theme-name = Tema
settings-theme-dark = Escuro
settings-theme-light = Claro
settings-theme-navy = Azul-marinho
settings-contrast = Alto contraste
# Os comandos do tema (a caixa de busca e o mapa de teclas).
theme-use = Usar o tema { $name }
theme-contrast = Ativar ou desativar o alto contraste
settings-field-render-tier = Nível de qualidade (na próxima abertura)
settings-field-render-backend = Backend (na próxima abertura)
settings-field-render-worker = Worker de renderização (na próxima abertura)
settings-field-render-gpu-timer = Timer da GPU (na próxima abertura)
settings-field-render-assets = Assets: o build, as fontes ou ambos (na próxima abertura)
settings-field-render-audio = Áudio (na próxima abertura)
settings-field-autosave-enabled = Salvamento automático da cena aberta
settings-field-autosave-seconds = Salvar automaticamente após (sem edição por este tempo)

## O pool de cenas em Preferências → Avançado.

settings-advanced = Avançado
pool = Pool de cenas
pool-hint = Um pool de páginas de navegador pré-aquecidas para os comandos shot, sheet e clip. O pool fica em execução até você pará-lo.
pool-no-server = Os controles do pool precisam do servidor de desenvolvimento.
pool-running = O pool está em execução: { $pages } páginas, { $warm } pré-aquecidas, { $leases } em uso.
pool-starting = O pool está iniciando…
pool-stopped = O pool não está em execução.
pool-pages = Páginas
pool-start = Iniciar
pool-stop = Parar
pool-refresh = Atualizar

## A busca, os grupos das configurações e as preferências do host do studio.

settings-search = Buscar nas preferências
settings-group-snaps = Encaixes
settings-group-view = Visualização
settings-group-camera = Câmera
settings-group-dock = Dock
settings-group-layout = Espaço de trabalho
settings-group-recent = Recentes
settings-group-render = Renderização (na próxima abertura)
settings-group-autosave = Salvamento automático do projeto
settings-host = Studio
settings-host-none = O host do studio guarda o idioma, o salvamento automático e os padrões do agente. Abra o editor pelo studio para alterá-los.
settings-autosave = Salvamento automático
settings-agent-model = Modelo do agente
settings-agent-effort = Esforço do agente
settings-host-failed = O host do studio não aceitou a alteração.

## O log de uso de um estudo de usabilidade.

settings-group-notes = Notas
settings-field-notes-author = Seu nome nas notas (a equipe o vê nas suas notas e respostas)
settings-group-usage = Uso
settings-field-usage-log = Log de uso (para um estudo de usabilidade; fica neste navegador)
usage-title = Log de uso
usage-hint = Com a configuração "Log de uso" ativada, o editor guarda uma linha para cada comando neste navegador. Nada sai da máquina; baixe o log para um estudo.
usage-count = { $count } linhas
usage-download = Baixar
usage-clear = Limpar
