# SPDX-License-Identifier: Apache-2.0

### Os textos do Hub do Scenity Studio (hub.html, src/hub).
### O nome do arquivo não é "hub.ftl": um nome de duas ou três letras minúsculas é uma tag de locale (@scenity/i18n resourcePath).

hub-title = Scenity Studio
hub-nav-label = Seções do studio
hub-nav-projects = Projetos
hub-nav-learn = Aprender
hub-nav-agents = Agentes
hub-nav-settings = Configurações
hub-new-project = Novo projeto
hub-open = Abrir…
hub-cancel = Cancelar
hub-close = Fechar
hub-safe = Modo seguro: cada projeto abre sem código de plugin.
hub-role-viewer = Só visualização: você olha os projetos. O dono do estúdio faz as alterações.
hub-role-editor = Editor: você altera as cenas. Só o dono do estúdio confia em um projeto ou o remove.
hub-agent-state-ok = Claude está pronto
hub-agent-state-warn = Claude precisa de uma verificação
hub-agent-state-missing = Nenhum agente configurado
hub-agent-state-checking = Verificando o agente…
# $error é a mensagem do host.
hub-error = { $error }
hub-state-error = O host do studio não respondeu: { $error }

## Os projetos.

hub-search = Buscar projetos
hub-sort = Ordenar
hub-sort-recent = Abertos por último
hub-sort-name = Nome
hub-view = Exibição
hub-view-cards = Cartões
hub-view-list = Lista
hub-projects-empty-title = Nenhum projeto ainda
hub-projects-empty-body = Crie um projeto a partir de um modelo ou abra uma pasta que contenha um projeto do Scenity.
hub-projects-none-found = Nenhum projeto corresponde à busca.
hub-project-missing = Pasta não encontrada
hub-project-locate = Localizar…
hub-project-remove = Remover da lista
hub-project-newer = Criado com um Scenity mais novo. Atualize o Scenity para abri-lo.
hub-project-pinned = Fixado
# $name é o nome do projeto.
hub-project-menu = Ações de { $name }
hub-project-open = Abrir
hub-project-open-window = Abrir em uma nova janela
hub-project-reveal = Mostrar no disco
hub-project-rename = Renomear…
hub-project-pin = Fixar
hub-project-unpin = Desafixar
hub-project-trust = Confiar neste projeto
hub-project-template = Salvar como modelo…
hub-template-save-title = Salvar como modelo
hub-template-save-body = O modelo é uma cópia da pasta do projeto sem as saídas de build e sem o estado local. O assistente de novo projeto o mostra depois dos modelos incluídos.
hub-template-save-name = Título
hub-template-save-about = Descrição
hub-template-save-go = Salvar o modelo
hub-template-saved = O modelo { $title } foi salvo. Novo projeto o mostra.
# $when é a data e a hora da última abertura.
hub-project-last = Aberto em { $when }
# $branch é a branch do Git; $changed é o número de arquivos alterados.
hub-project-git = { $branch } · { $changed } com alterações
# $version é a versão principal do formato do projeto.
hub-project-format = Formato { $version }
hub-project-scenes =
    { $count ->
        [one] { $count } cena
       *[other] { $count } cenas
    }
hub-project-restricted = Executa código: abre em modo restrito até você confiar nele.
hub-rename-title = Renomear o projeto
hub-rename-name = Nome
hub-rename-save = Renomear

## O assistente de novo projeto.

hub-wizard-title = Novo projeto
hub-wizard-templates = Modelos
hub-wizard-name = Nome
hub-wizard-name-invalid = Use de 1 a 64 letras, dígitos, - e _.
hub-wizard-place = Local
hub-wizard-choose = Escolher…
hub-wizard-git = Criar um repositório Git
hub-wizard-packages = Pacotes do Scenity
hub-wizard-packages-linked = Vincular os pacotes deste checkout
hub-wizard-packages-npm = Os pacotes publicados (npm)
hub-wizard-packages-sample = Um exemplo vincula os pacotes deste checkout.
hub-wizard-make = Criar
hub-wizard-making = Criando o projeto…
hub-wizard-prompt = Descreva o que você quer fazer
hub-wizard-prompt-example = Uma pequena loja com três cadeiras e uma luz quente
hub-wizard-prompt-start = Começar pelo prompt
hub-wizard-prompt-about = O agente escolhe um modelo e um nome, cria o projeto e monta uma primeira cena que espera a sua revisão.
hub-wizard-choosing = O agente escolhe um modelo…
hub-wizard-prompt-chosen = O modelo { $template }, o nome { $name }
hub-wizard-failed = O projeto não foi criado.
hub-wizard-retry = Executar de novo
hub-wizard-log = Log
hub-wizard-checkout-only = Requer um checkout do Scenity
hub-template-empty = Vazio
hub-template-empty-about = Um piso, uma caixa, duas luzes e uma câmera.
hub-template-showroom = Showroom
hub-template-showroom-about = Seis modelos de móveis, um céu HDR e três cenas.
hub-template-characters = Personagens
hub-template-characters-about = Um robô com rig que anda, acena e pega uma xícara.
hub-template-walkthrough = Passeio
hub-template-walkthrough-about = Dois robôs e um manequim se encontram em uma praça.
hub-template-sim-road = Travessia de rua
hub-template-sim-road-about = Carros e pedestres com a simulação de trânsito.
hub-template-physics = Física
hub-template-physics-about = Caixotes, uma bola e uma rampa com corpos rígidos.
hub-template-spin = Plugin Spin
hub-template-spin-about = Um pequeno plugin de projeto: um componente, um sistema e entrada do modo de jogo.
hub-template-gltf-samples = Exemplos glTF
hub-template-gltf-samples-about = Modelos de teste da Khronos para materiais e extensões.

## O diálogo de pasta.

hub-folder-title = Escolher uma pasta
hub-open-title = Abrir um projeto
hub-folder-up = Acima
hub-folder-new = Nova pasta
hub-folder-new-name = Nome da pasta
hub-folder-make = Criar
hub-folder-choose = Escolher esta pasta
hub-folder-project = Projeto
hub-folder-open-project = Abrir este projeto
hub-folder-make-project = Tornar esta pasta um projeto
hub-folder-empty = Nenhuma pasta aqui.
hub-folder-list = As pastas de { $path }
hub-clone = Clonar do Git…
hub-clone-url = URL do repositório (HTTPS ou SSH)
hub-clone-folder = Nome da pasta
hub-clone-start = Clonar
hub-clone-running = Clonando…
hub-clone-failed = O clone falhou.

## Aprender.

hub-learn-samples = Exemplos
hub-learn-samples-body = Um exemplo abre como uma cópia em uma pasta que você escolhe; o exemplo em si nunca muda.
hub-learn-copy = Abrir uma cópia
hub-learn-docs = Documentação
hub-ask-title = Pergunte como fazer algo
hub-ask-placeholder = Por exemplo: como adiciono uma luz?
hub-ask-go = Perguntar
hub-ask-none = Nenhuma parte da documentação corresponde. Tente outras palavras ou abra uma das documentações abaixo.
hub-ask-tutorial = Tutorial: { $title }
hub-ask-tutorial-open = Abra um projeto e escolha Ajuda → Tutoriais.
hub-ask-start = Começar em { $project }
hub-doc-studio = Scenity Studio
hub-doc-quickstart = Início rápido
hub-doc-editor = O editor
hub-doc-formats = Formatos de documento
hub-doc-plugins = Plugins
hub-doc-cli = O comando scenity
hub-learn-tutorials = Tutoriais
hub-learn-tutorials-body = Abra um projeto e escolha Ajuda → Tutoriais: sua primeira cena, um prefab e uma sequência. Cada passo aponta para a parte da janela dele e avança quando você o faz. No painel Agente, peça "mostre como" para qualquer tarefa.
hub-learn-new = Novidades
hub-learn-new-body = O Scenity Studio reúne os projetos, os modelos, os jobs e os agentes em um só lugar: um agente trabalha no editor ao seu lado, e você revisa as alterações dele.

## Agentes.

hub-agents-claude = Claude nesta máquina
hub-agents-claude-body = O agente integrado usa o login do Claude Code desta máquina ou uma chave de API.
hub-agents-external = Agentes externos
hub-agents-external-body = Claude Code, Codex, Cursor e Claude Desktop se conectam ao studio por MCP: adicione a linha do seu app uma vez. Na primeira chamada, o studio pede que você o permita (o painel do agente do projeto); depois disso, as alterações dele aguardam revisão como as alterações de qualquer agente.
hub-agents-setup-claude-code = Claude Code (em um terminal)
hub-agents-setup-codex = Codex (em um terminal)
hub-agents-setup-cursor = Cursor (.cursor/mcp.json)
hub-agents-setup-claude-desktop = Claude Desktop (claude_desktop_config.json)
hub-agents-copy = Copiar
hub-agents-copied = Copiado
hub-clients-title = Conexões
hub-clients-none = Nenhum agente externo pediu para se conectar ainda.
hub-clients-pending = pede para se conectar
hub-clients-allowed = conectado
hub-clients-denied = negado
hub-clients-project = Projeto
hub-clients-allow = Permitir
hub-clients-deny = Negar
hub-clients-revoke = Revogar
hub-clients-name = O nome do app
hub-clients-http = Conectar por HTTP
hub-clients-token-once = O token de { $name } só aparece agora. Copie a linha para o app; Revogar retira o token.
hub-agents-defaults = Padrões das novas sessões
hub-agents-mode = Modo de permissão
hub-mode-ask = Perguntar: o agente lê e responde
hub-mode-review = Revisão: as edições aguardam você
hub-mode-auto = Automático: as edições se aplicam na hora; o desfazer continua
hub-agents-budget = Orçamento de uma sessão (dólares americanos)
hub-agents-none = Todos os recursos funcionam sem agente.
hub-agents-usage = Hoje: US${ $cost } e { $tokens } tokens dos agentes.
hub-agents-recipes = Receitas
hub-agents-recipes-body = Prompts salvos com parâmetros: execute um pela caixa de busca (⌘K), pelo menu Agente ou com / no painel do agente. Suas receitas ficam em recipes.json da pasta do studio; um projeto guarda as próprias em .scenity/recipes.
hub-recipe-project = Projeto de uma execução
hub-recipe-run = Executar no projeto
hub-recipe-edit = Alterar
hub-recipe-remove = Remover
hub-recipe-new = Nova receita
hub-recipe-title = Título
hub-recipe-prompt = Prompt
hub-recipe-prompt-hint = Cada {"{"}nome{"}"} do prompt é um campo que a execução pede.
hub-recipe-save = Salvar a receita
hub-agents-recipe-studio = do studio
hub-agents-recipe-user = suas
hub-agents-recipe-project = do projeto
hub-agents-kinds = Cada tipo de ação
hub-agents-kinds-body = Um valor aqui restringe o modo de cada sessão: vence o valor mais estrito. O Git é sempre exclusivo do dono.
hub-agents-kind-default = Como o modo
hub-agents-kind-allow = Permitir
hub-agents-kind-ask = Perguntar
hub-agents-kind-deny = Negar
hub-agents-kind-name-scene = Edições da cena
hub-agents-kind-name-files = Gravações de arquivos
hub-agents-kind-name-runs = Execuções e jobs
hub-agents-kind-name-imports = Importações e downloads
hub-agents-kind-name-network = Rede

## Configurações e o diagnóstico.

hub-settings-theme = Tema
hub-theme-dark = Escuro
hub-theme-light = Claro
hub-theme-navy = Azul-marinho
hub-settings-contrast = Alto contraste
hub-settings-language = Idioma
hub-settings-recent = Projetos recentes a manter
hub-doctor-title = Esta máquina
hub-doctor-ok = Pronto
hub-doctor-warn = Verificar
hub-doctor-missing = Ausente
# $what é a lista das partes que precisam da ferramenta.
hub-doctor-needed = Necessário para: { $what }
hub-doctor-running = Executando…
hub-doctor-webgpu = WebGPU neste navegador
hub-doctor-webgpu-ok = O WebGPU funciona: o editor desenha com ele.
hub-doctor-webgpu-no = Sem WebGPU: o editor desenha com WebGL.
hub-doctor-check-bun = Bun
hub-doctor-check-git = Git
hub-doctor-check-blender = Blender
hub-doctor-check-chromium = Chromium para imagens
hub-doctor-check-claude = Claude

## A primeira execução.

hub-first-title = Boas-vindas ao Scenity Studio
hub-first-body = Crie cenas 3D, verifique-as e publique um pequeno player web, com agentes que trabalham ao seu lado.
# $n é o número do passo; $total é o número de passos.
hub-first-step = Passo { $n } de { $total }
hub-first-look = Aparência e idioma
hub-first-agent = Conectar um agente
hub-first-agent-claude = O login do Claude desta máquina
hub-first-agent-key = Uma chave de API
hub-first-agent-later = Você configura o agente em Agentes depois do último passo.
hub-first-agent-external = Um agente externo por MCP
hub-first-agent-none = Nenhum agente por enquanto
hub-first-doctor = Verificar esta máquina
hub-first-next = Próximo
hub-first-back = Voltar
hub-first-skip = Pular
hub-first-done = Começar
