# SPDX-License-Identifier: Apache-2.0

### Os textos da aba de sequência da página da cena (scene/sequencer/; docks da cena). Os nomes e os IDs das
### entidades, os nomes e os tipos das trilhas, os caminhos das propriedades, os nomes e os tempos dos marcadores são
### valores de dados. $ms é um passo em milissegundos, e $time é um tempo da sequência em segundos (por exemplo 1.25 s).

## A barra de reprodução (SequencerPanel.vue).

sequencer-panel = Sequenciador
sequencer-timeline = Linha do tempo
sequencer-start = Ir para o início
sequencer-back = Voltar { $ms } ms
sequencer-back-title = Voltar um passo (vírgula; Shift: 250 ms)
sequencer-forward = Avançar { $ms } ms
sequencer-forward-title = Avançar um passo (ponto; Shift: 250 ms)
sequencer-pause = Pausar
sequencer-play = Reproduzir
sequencer-pause-title = Pausar (Space)
sequencer-play-title = Reproduzir (Space)
sequencer-loop-from-title = Loop a partir daqui ([)
sequencer-loop-to-title = Loop até aqui (])
sequencer-loop-clear = Limpar o loop
sequencer-loop-on-title = Loop ativo: limpar (\)
sequencer-loop-off-title = Sem loop
sequencer-record = Gravar
sequencer-record-title = Gravar: uma edição no tempo atual vira uma chave

## O formulário de uma nova trilha ou de um novo marcador.

sequencer-track-kind = Tipo da nova trilha
sequencer-track-entity = Entidade da nova trilha
sequencer-track-selected = (entidade selecionada)
sequencer-track-path = Caminho da propriedade
sequencer-add-track = Adicionar trilha
sequencer-marker-sample = nome do marcador
sequencer-marker-name = Nome do novo marcador
sequencer-add-marker = Adicionar marcador

## A lista de trilhas e a régua de tempo (SequencerTracks.vue). $name é um nome de marcador, $track o rótulo de uma trilha.

sequencer-tracks = Trilhas
sequencer-group-sequence = Sequência
sequencer-marker-title = { $name } em { $time }
sequencer-key-add = Adicionar uma chave no tempo atual
sequencer-track-remove = Remover a trilha
sequencer-key-title = { $track } em { $time }
sequencer-key-proposed = proposta de { $name }
sequencer-key = Chave em { $time }
sequencer-empty = Nenhuma trilha ainda. Adicione uma trilha, ou ative Gravar e mova uma entidade.

## O editor de curvas (SequencerCurve.vue). $min, $max e $value são números das chaves, $line o rótulo de uma linha.

sequencer-curve-range = { $min } a { $max }
sequencer-curve-point = { $line } { $value } em { $time }
# A linha de um eixo da posição de uma trilha de transformação. $axis é x, y ou z.
sequencer-curve-position = posição { $axis }

## Os comandos de página do mapa de teclas (useSequencer.ts). A paleta e as configurações de teclas mostram esses comandos.

sequencer-command-toggle = Reproduzir ou pausar a sequência
sequencer-command-loop-from = Loop a partir do tempo atual (A)
sequencer-command-loop-to = Loop até o tempo atual (B)
sequencer-command-delete-key = Excluir a chave selecionada

## O relógio na barra de ferramentas principal (sequencer/clockBar.ts). $speed é um número; $from e $to são segundos.

clock-group = Relógio
clock-time = O tempo do relógio (segundos)
clock-time-title = Digite um tempo em segundos e pressione Enter
clock-speed = A velocidade do relógio
clock-speed-value = { $speed }×
clock-loop-range = Loop de { $from } s a { $to } s
clock-command-seek = Ir para um tempo do relógio
clock-command-speed = Definir a velocidade do relógio
clock-arg-ms = O tempo (ms desde o início da sequência).
clock-arg-speed = A velocidade: ms do relógio para cada ms (0.25, 0.5, 1, 2 ou 4).
clock-play-mode = No modo de jogo, as teclas do relógio vão para o jogo.

## O zoom da linha do tempo.

sequencer-zoom-in = Aumentar o zoom (⌘ ou Ctrl e a roda do mouse)
sequencer-zoom-out = Diminuir o zoom
sequencer-zoom-fit = Mostrar a linha do tempo inteira
sequencer-zoom-fit-short = Ajustar

## O cabeçalho da linha do tempo e o formulário de uma chave. $field é um nome de campo de uma chave (dado).

sequencer-head = A sequência
sequencer-picker = A sequência a editar
sequencer-new = Nova sequência
sequencer-duration = Duração
sequencer-seconds = s
sequencer-loop = Loop
sequencer-initial = Estado inicial
sequencer-initial-apply = Aplicar o estado inicial
sequencer-key-form = A chave selecionada
sequencer-key-time = Tempo (ms)
sequencer-key-ease = Suavização
sequencer-key-apply = Aplicar
sequencer-key-json = O campo { $field } não é JSON.

## O editor de curvas v2.

sequencer-curve-all = Todas as curvas
sequencer-curve-frame = Enquadrar tudo
sequencer-curve-ease = Suavização
sequencer-ease-step = Degrau
sequencer-ease-linear = Linear
sequencer-ease-in = Entrada
sequencer-ease-out = Saída
sequencer-ease-inOut = Entrada e saída
sequencer-ease-bezier = Bézier

## As propostas dos agentes na linha do tempo. $count é uma contagem de propostas.

sequencer-proposals = { $count ->
    [one] { $count } alteração de um agente aguarda (as chaves tracejadas)
   *[other] { $count } alterações de um agente aguardam (as chaves tracejadas)
}
sequencer-accept-all = Aceitar
sequencer-reject-all = Rejeitar

## O painel Simulação. $seconds é um tempo.

panel-simulation = Simulação
simulation-time = Em { $seconds } s
simulation-none = Nenhuma simulação é executada neste tempo (não há sequência, ou não há plugin de simulação).
simulation-id = ID
simulation-stream = Fluxo gravado
simulation-stream-none = Nenhum fluxo
simulation-live-none = A página não tem fonte ao vivo (um motor que envia os seus estados).

## A janela Animador. $name é o nome de um estado, de um parâmetro ou de uma camada (dado).

panel-animator = Animador
animator-no-layer = O animador não tem essa camada.
animator-no-state = A camada não tem o estado { $name }.
animator-state-exists = A camada já tem um estado { $name }.
animator-state-start = O estado { $name } é o início da camada: escolha outro início primeiro.
animator-state-used = Uma transição usa o estado { $name }: remova a transição primeiro.
animator-parameter-exists = O animador já tem um parâmetro { $name }.
animator-parameter-used = Uma condição ou uma mistura usa o parâmetro { $name }.
animator-layer-exists = O animador já tem uma camada { $name }.
animator-none = Nenhuma entidade da cena tem um animador.
animator-entity = A entidade do animador
animator-parameters = Parâmetros
animator-preview = O valor atual de { $name } (a vista o mostra)
animator-new-parameter = O nome de um novo parâmetro
animator-parameter-type = O tipo do novo parâmetro
animator-add = Adicionar
animator-layer = Camada
animator-states = Os estados da camada
animator-start = { $name } é o estado inicial
animator-new-state = Novo estado
animator-clip = O clipe do novo estado
animator-transitions = Transições
animator-conditions = As condições como JSON, por exemplo [{"{"}"parameter": "speed", "op": "gt", "value": 0.1{"}"}]
animator-conditions-json = As condições são uma lista JSON.
animator-any = Qualquer estado
animator-from = De
animator-to = Para
animator-type-number = Número
animator-type-bool = Sinalizador

## A janela Configuração do personagem. $bones é uma lista de nomes de ossos; $bone é um nome de osso (dado). $goal é
## o nome de um objetivo de IK; $name é um nome de entidade (dado).

panel-character = Configuração do personagem
character-none = Selecione uma entidade com um modelo com skinning.
character-rig-none = Nenhum
character-rig = Perfil do rig
character-detect = Detectar
character-missing = Ossos ausentes: { $bones }
character-complete = Cada osso obrigatório tem um nó.
character-bones = O mapa de ossos
character-node = O nó de { $bone }
character-node-profile = O nó do perfil
character-clip-source = Origem dos clipes
character-clip-own = Os clipes do modelo
character-variant = Variante do visual
character-variant-none = Nenhuma
character-ik-handles = Mover os alvos de IK na vista
character-ik-handles-title = Uma alça em cada entidade alvo de IK do personagem: arraste-a na vista da cena para mover o alvo
character-ik-handle = O alvo de IK de { $goal }: { $name }
character-ik-left-hand = Mão esquerda
character-ik-right-hand = Mão direita
character-ik-look = Olhar
character-ik-none = Nenhum objetivo de IK tem uma entidade alvo. Defina os alvos nos objetivos de IK do componente Personagem.
character-retarget = Prévia do retarget
character-retarget-clip = O clipe da prévia do retarget
character-retarget-title = Tocar o clipe da origem dos clipes no personagem na vista da cena (com uma sequência aberta)

## O navegador de clipes. $name é um nome de entidade e $clip um nome de clipe (dado).

panel-clips = Clipes
clips-none = Selecione uma entidade com um modelo.
clips-empty = O modelo de { $name } não tem clipes.
clips-no-sequence = Abra uma sequência: um clipe vai para a linha do tempo como uma chave de animação e toca na vista.
clips-list = Os clipes de { $name }
clips-drag = Arraste o clipe para a linha do tempo para adicionar uma chave de animação
clips-from-source = Origem dos clipes
clips-preview = Prévia
clips-preview-stop = Parar
clips-preview-name = Prévia de { $clip } na vista
clips-add = Adicionar no cursor de tempo
clips-add-name = Adicionar { $clip } no cursor de tempo
