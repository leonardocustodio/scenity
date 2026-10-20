# SPDX-License-Identifier: Apache-2.0

### Os textos do núcleo genérico do lab (os arquivos de nível superior de core/, a página do lab; lab core). As
### mensagens da ajuda de teclas (core/LabHelp.vue) começam com lab-help- e estão no fim. Nomes de câmera, nomes de take,
### IDs de membro, nomes de métrica e números são valores de dados. Os nomes das teclas da ajuda são valores de dados e não estão aqui.

## A linha do tempo (LabTimeline.vue). $ms é um passo em milissegundos, $time um tempo do relógio (m:ss.ss).

lab-timeline = Linha do tempo
lab-timeline-start = Ir para o início
lab-timeline-back = Voltar { $ms } ms
lab-timeline-back-title = Voltar (vírgula; Shift: 250 ms)
lab-timeline-forward = Avançar { $ms } ms
lab-timeline-forward-title = Avançar (ponto; Shift: 250 ms)
lab-timeline-pause = Pausar
lab-timeline-play = Reproduzir
lab-timeline-pause-title = Pausar (Space)
lab-timeline-play-title = Reproduzir (Space)
lab-timeline-sim-time = Tempo da simulação
lab-timeline-take-time = { $time } do take
# Uma marca da trilha. $label é o tipo de evento com o membro ou o slot dele (valores de dados), ou um momento nomeado.
lab-timeline-mark = { $time } { $label }
# Um momento nomeado do take. $name é o nome do momento (um valor de dados).
lab-timeline-moment = momento { $name }
lab-timeline-track = Tempo
lab-timeline-speed = Velocidade
lab-timeline-loop-from = Início do loop aqui
lab-timeline-loop-from-title = Início do loop aqui ([)
lab-timeline-loop-to = Fim do loop aqui
lab-timeline-loop-to-title = Fim do loop aqui (])
lab-timeline-clear-loop = Limpar o loop
lab-timeline-loop-on = Loop ativo: limpar (\)
lab-timeline-no-loop = Sem loop
lab-timeline-whole = Take inteiro
lab-timeline-whole-title = Mostrar o take inteiro na linha do tempo

## A página do lab (Room3DLab.vue). $reason é o texto de falha da vista da cena (em inglês, de um pacote).

lab-failed = A sala 3D falhou: { $reason }
lab-retry = Tentar de novo
lab-show-panel = Mostrar painel

## O painel lateral (LabPanel.vue). O plugin fornece os rótulos das abas dele.

lab-panel-help-hint = Leia a ajuda para mais instruções
lab-panel-help = Teclas e controles
lab-panel-hide = Ocultar painel
lab-panel-tabs = Seções do lab
lab-tab-view = Vista

## Os níveis de qualidade (a aba Vista e as estatísticas de quadro).

lab-tier-ultra = Ultra
lab-tier-high = Alto
lab-tier-medium = Médio
lab-tier-low = Baixo

## As linhas das estatísticas de quadro (useLabStats.ts): o rótulo, o valor e a dica do rótulo. $ms, $update, $pose
## e $render são tempos em milissegundos com uma casa decimal. $mode é a thread do renderizador (um valor de dados).

lab-stats-ms = { $ms } ms
lab-stats-none = n/d
lab-stats-frame = Quadro p95
lab-stats-frame-hint = O percentil 95 do tempo entre dois quadros
lab-stats-cpu = CPU p95
lab-stats-cpu-hint = O percentil 95 do tempo para atualizar a cena e enviar as draw calls dela
lab-stats-gpu = GPU p95
lab-stats-gpu-hint = O percentil 95 do tempo de GPU de um quadro (timer queries no WebGL, timestamp queries no WebGPU; n/d: o navegador não tem nenhum dos dois)
lab-stats-backend = Backend
lab-stats-backend-hint = O backend do renderizador que desenha, o motivo da escolha e a escolha
lab-stats-update = Atualização (poses) / renderização
lab-stats-update-value = { $update } ms ({ $pose } ms) / { $render } ms
lab-stats-update-hint = O percentil 95 da atualização da cena, da parte dela que posiciona os membros (poses, IK, clipes) e das chamadas de renderização
lab-stats-draws = Draw calls
lab-stats-draws-hint = As draw calls do último quadro, sombras incluídas
lab-stats-triangles = Triângulos
lab-stats-triangles-hint = Os triângulos do último quadro, sombras incluídas
lab-stats-tier = Nível
lab-stats-tier-value = { $tier } · { $mode }
lab-stats-tier-scaled = { $tier } · { $scale }× · { $mode }
lab-stats-tier-hint = O nível de qualidade, a escala de renderização e a thread do renderizador
lab-stats-memory = Memória
lab-stats-memory-value = { $geometries } geo · { $textures } tex · { $programs } prog
lab-stats-memory-heap = { $geometries } geo · { $textures } tex · { $programs } prog · { $heap } MB
lab-stats-memory-hint = As geometrias, as texturas e os programas de shader do renderizador, e o heap JS da thread dele

## O backend do renderizador (backendText.ts). $backend, $reason e $chosen são valores de dados ("webgpu", "url_override").

lab-backend-text = { $backend } ({ $reason })
lab-backend-text-chosen = { $backend } ({ $reason }; o seletor escolheu { $chosen })

## O indicador de taxa de quadros e o cartão das estatísticas de quadro (LabFrameStats.vue). $gpu é o nome da GPU da
## sondagem, $tier um ID de nível e $reason a falha da sondagem (valores de dados).

lab-frame-stats = Estatísticas de quadro
lab-fps = { $fps } fps
lab-fps-failures = { $count } falhas de assets
lab-probe = GPU
lab-probe-hint = A GPU da sondagem de capacidades e o resultado dela
lab-probe-unknown = desconhecida
lab-probe-ok = { $gpu } · primeiro nível { $tier }
lab-probe-failed = { $gpu } · { $reason }
lab-asset-failures = Falhas de assets

## A aba Vista (LabViewTab.vue). Os nomes de câmera, os nomes das camadas de depuração e os nomes de backend são valores de dados.

lab-view-camera = Câmera
lab-view-camera-reset = Redefinir câmera
lab-view-camera-named = Câmera nomeada
lab-view-camera-free = Vista livre
lab-view-camera-keys = As teclas 1 a 9 escolhem uma câmera. Arraste ou deslize na cena para girar a câmera; a roda do mouse ou o gesto de pinça a aproxima ou a afasta; W, A, S e D a movem sobre o piso, Q para baixo e E para cima; as teclas de seta a giram no lugar (Shift: mais rápido).
lab-view-debug = Camadas de depuração
lab-view-tier = Nível
lab-view-backend = Backend do renderizador
lab-backend-auto = Automático
# O texto do backend com o adaptador do seletor. $text é o texto do backend, $adapter o nome do adaptador (um valor de dados).
lab-backend-line = { $text } · { $adapter }
lab-flag-worker = Worker de renderização
lab-flag-reduced = Movimento reduzido
lab-flag-cards = Cartões dos membros
lab-flag-assets = Personagens glTF

## A aba Ajustes (LabTuneTab.vue; a aba está oculta por enquanto). $path é um caminho de ajuste (um valor de dados).

lab-tune-intro = Os números das poses e das posições dos props. Uma alteração aparece na hora; a URL a guarda. Copie as alterações para o código quando estiverem certas.
lab-tune-search = Buscar
lab-tune-search-placeholder = Buscar, por exemplo maskHand ou props.cart
lab-tune-copied = Copiado
lab-tune-copy = Copiar alterações ({ $count })
lab-tune-reset-all = Redefinir tudo
lab-tune-default = padrão { $value }
lab-tune-reset = Redefinir { $path }
lab-nudge = Ajuste fino do prop
lab-nudge-prop = Prop a mover
lab-nudge-none = Nenhum prop
# A posição do prop. $x, $y e $z são metros com três casas decimais, $turn são graus com uma casa decimal.
lab-nudge-place = x { $x } · y { $y } · z { $z } · giro { $turn }°
lab-nudge-keys = Com um prop selecionado: Alt e as teclas de seta o movem 1 cm sobre o piso, Alt e Q ou E o movem para baixo ou para cima, Alt e vírgula ou ponto o giram 1°. Shift: 10 vezes mais.

## A faixa de visão geral da linha do tempo (LabOverview.vue; oculta por enquanto). $checks é uma lista de nomes de verificações (valores de dados).

lab-overview = Visão geral do take: { $frames } quadros, { $failing } tempos com falha (Enter: o primeiro tempo com falha)
lab-overview-fail = { $seconds } s: { $checks }
lab-overview-stale = desatualizado
lab-overview-stale-title = Quadros do código anterior à última edição: o indexador os desenha de novo

## A prévia ao passar o mouse na linha do tempo (LabIndexPreview.vue). Ela usa lab-overview-stale para a marca dela.

lab-preview-stale-title = Um quadro do código anterior à última edição: o indexador o desenha de novo

## Os problemas de um novo nome de câmera e de uma nova linha de documentação (cameraNames.ts). O formulário para salvar
## a câmera e a CLI do lab os mostram. $name é um nome de câmera (um valor de dados), $max uma contagem de caracteres.

lab-camera-name-length = Um nome de câmera tem de 1 a { $max } caracteres.
lab-camera-name-bad = "{ $name }" não é um nome de câmera: use letras minúsculas e dígitos, com um hífen entre as partes (side-right).
lab-camera-name-fixed = "{ $name }" é o enquadramento do kit da sala: dê outro nome.
lab-camera-doc-empty = A linha de documentação de uma câmera é um texto curto.
lab-camera-doc-length = A linha de documentação de uma câmera tem no máximo { $max } caracteres.
lab-camera-doc-bad = A linha de documentação de uma câmera não tem quebra de linha, nem */, nem nenhum dos caracteres ; | & $ ` < > \ ".

## O diálogo de confirmação antes do primeiro destaque de um painel (follow/detach.ts), apenas na página do lab.

lab-detach-confirm =
    Um painel destacado é uma segunda janela com o próprio contexto 3D e a própria cópia dos assets da sala: cerca de 1 GB a mais de memória (medido no app labs).

    Destacar o painel?

## O quadro oculto do lab das páginas de grafo e de comparação (views/shadowLab.ts): o título do iframe dele.

lab-shadow-frame = Quadro oculto do lab

## A ajuda de teclas (LabHelp.vue): o diálogo.

lab-help-title = Teclas e controles
lab-help-description = As teclas funcionam quando o foco não está em um campo do painel. A aba Equipe seleciona o membro de P e K.

## Os controles de mouse e de toque na coluna das teclas.

lab-help-control-drag = Arrastar
lab-help-control-wheel = Roda do mouse
lab-help-control-click = Clique
lab-help-control-grip = Alça
lab-help-control-fold = Recolher
lab-help-control-place = Posicionar
lab-help-control-drop = Soltar

## As linhas da seção de ajuda "Câmera".

lab-help-camera = Câmera
lab-help-camera-1 = Mover para a frente e para trás ao longo da vista
lab-help-camera-2 = Mover para a esquerda e para a direita
lab-help-camera-3 = Mover para baixo até o piso e para cima até o teto
lab-help-camera-4 = Girar a câmera para a esquerda e para a direita no lugar
lab-help-camera-5 = Inclinar a câmera para cima e para baixo no lugar
lab-help-camera-6 = Segure com uma tecla de mover ou girar: mover ou girar mais rápido
lab-help-camera-7 = Mouse ou um dedo na cena: girar a câmera em torno do ponto para onde ela olha
lab-help-camera-8 = Rolar ou fazer pinça com dois dedos: aproximar ou afastar
lab-help-camera-9 = Uma câmera nomeada (a aba Vista as lista; 1 é a vista do aluno)

## As linhas da seção de ajuda "Linha do tempo".

lab-help-time = Linha do tempo
lab-help-time-1 = Reproduzir ou pausar o relógio
lab-help-time-2 = Voltar ou avançar 50 ms (Shift: 250 ms)
lab-help-time-3 = Definir o início (A) ou o fim (B) de um loop no tempo do relógio
lab-help-time-4 = Limpar o loop

## As linhas da seção de ajuda "Navegador de conteúdo (o dock sob a cena)".

lab-help-browser = Navegador de conteúdo (o dock sob a cena)
lab-help-browser-1 = Mostrar ou ocultar o navegador (as pastas, a grade, o inspetor); a linha do tempo permanece
lab-help-browser-2 = Fechar ou abrir o dock inteiro (o cabeçalho dele permanece)
lab-help-browser-3 = Uma borda do dock, da linha do tempo ou de um painel lateral: redimensioná-la (pressionar duas vezes: padrão)
lab-help-browser-4 = Buscar em todos os itens: um ID de clipe, uma palavra do texto dele, um status (none) ou uma prioridade (P0)
lab-help-browser-5 = Um bloco ou uma pasta da árvore tem o foco: ir para o próximo
lab-help-browser-6 = Abrir o bloco: uma pasta mostra os itens dela, um item reproduz a cena dele em loop
lab-help-browser-7 = Subir um nível (Escape também); no campo de busca, Escape o limpa

## As linhas da seção de ajuda "Animações".

lab-help-animations = Animações
lab-help-animations-1 = Repetir a animação do membro selecionado desde o início
lab-help-animations-2 = Devolver o membro selecionado ao estado ocioso na primeira posição dele
lab-help-animations-3 = Um membro na cena: selecioná-lo (a aba Equipe)

## As linhas da seção de ajuda "Props (aba Ajustes, um prop selecionado)".

lab-help-props = Props (aba Ajustes, um prop selecionado)
lab-help-props-1 = Mover o prop 1 cm sobre o piso (Shift: 10 cm)
lab-help-props-2 = Mover o prop 1 cm para baixo ou para cima
lab-help-props-3 = Girar o prop 1° para a esquerda ou para a direita (Shift: 10°)

## As linhas da seção de ajuda "Editor de cena".

lab-help-editor = Editor de cena
lab-help-editor-1 = A paleta de comandos: buscar todos os comandos do editor (Ctrl+P em outros sistemas)
lab-help-editor-2 = Um item da cena (um prop, um dispositivo, um membro): selecioná-lo (o cartão o mostra)
lab-help-editor-3 = Limpar a seleção
lab-help-editor-4 = Um prop selecionado: movê-lo em uma grade de 1 cm (Shift: 10 cm); Alt ao pressionar o ergue
lab-help-editor-5 = Girar o prop selecionado 15° (Shift+R: sentido oposto; Alt+R: 1°)
lab-help-editor-6 = Segure ⌘ ao pressionar: o arrasto vira uma proposta (um fantasma) que você aceita ou rejeita no cartão dela
lab-help-editor-7 = Desfazer uma edição (⇧⌘Z: refazer); um arrasto é um passo
lab-help-editor-8 = Arraste o cabeçalho do cartão para mover os cartões (teclas de seta nele: 20 px; Home ou um clique duplo: de volta)
lab-help-editor-9 = O botão de recolher do cartão mostra apenas o cabeçalho dele; pressione-o de novo para abrir o cartão

## As linhas da seção de ajuda "Encaixe e medição (a cena)".

lab-help-snap = Encaixe e medição (a cena)
lab-help-snap-1 = Um prop selecionado: ele se encaixa no topo de um prop, em uma parede, em um soquete ou em uma âncora perto do ponteiro
lab-help-snap-2 = Segure durante um movimento: sem encaixe (apenas a grade); Alt ao pressionar ergue o prop
lab-help-snap-3 = Medir: clique em dois pontos; a distância fica no quadro (M de novo encerra a escolha dos pontos)
lab-help-snap-4 = Encerrar a escolha dos pontos de uma medição; sem seleção, limpar as medições

## As linhas da seção de ajuda "Posições da equipe (a cena)".

lab-help-places = Posições da equipe (a cena)
lab-help-places-1 = Mostrar ou ocultar os anéis de posição da equipe (eles aparecem enquanto um membro está selecionado)
lab-help-places-2 = Um membro ou o anel dele: mover a posição dele para a âncora mais próxima (um evento de posição; ⌘ ao pressionar: uma proposta)

## As linhas da seção de ajuda "Cabos e alvos de mão (a cena)".

lab-help-cables = Cabos e alvos de mão (a cena)
lab-help-cables-1 = Um cabo selecionado: arraste um ponto branco (5 mm, Shift 5 cm; Alt ao pressionar: para cima e para baixo; ⌘: uma proposta)
lab-help-cables-2 = Um membro em ação: arraste o alvo da mão dele; o rótulo mostra ik.reachError e o contato

## As linhas da seção de ajuda "Luz, posições temporizadas, anexar (a cena)".

lab-help-light = Luz, posições temporizadas, anexar (a cena)
lab-help-light-1 = A alça da luz principal: arraste o ponto dela para girar a luz (⌘: uma proposta); a seção Luz da aba Ajustes
lab-help-light-2 = Modo de posição temporizada: arrastar um prop o posiciona a partir do tempo do relógio (um evento do take, uma marca na linha)
lab-help-light-3 = Um prop solto na mão de um membro: uma alteração preparada do Claude para o prop segurado (o arrasto é desfeito)

## As linhas da seção de ajuda "Alcance e folga (a cena)".

lab-help-reach = Alcance e folga (a cena)
lab-help-reach-1 = A esfera de alcance do membro selecionado; clique em um prop: 'ao alcance: 12 cm de sobra' (G de novo a oculta)
lab-help-reach-2 = Os caminhos de caminhada da equipe com os comprimentos deles, uma caminhada bloqueada em vermelho (eles também aparecem por 4 s após um movimento)

## As linhas da seção de ajuda "Descrever e posicionar, papel de cebola (a cena)".

lab-help-describe = Descrever e posicionar, papel de cebola (a cena)
lab-help-describe-1 = O cartão de um prop: 'on the cart', 'left of the cart' gera uma proposta com o fantasma dela
lab-help-describe-2 = Papel de cebola: o membro selecionado (senão, a equipe) 250 e 500 ms antes (azul) e depois (laranja)

## As linhas da seção de ajuda "Solo, ocultar e grupos (a cena)".

lab-help-solo = Solo, ocultar e grupos (a cena)
lab-help-solo-1 = Ocultar os itens selecionados no painel em foco (uma flag da vista: as capturas os mostram)
lab-help-solo-2 = Mostrar apenas os itens selecionados no painel em foco (de novo: mostrar todos os itens)
lab-help-solo-3 = Mostrar todos os itens de novo no painel em foco
lab-help-solo-4 = Adicionar um item à seleção ou retirá-lo; um arrasto move os props selecionados
lab-help-solo-5 = Selecionar o grupo nomeado do prop selecionado (um carrinho com os props sobre ele)

## As linhas da seção de ajuda "Cena".

lab-help-scene = Cena
lab-help-scene-1 = Um bloco do navegador de conteúdo: abrir uma pasta ou reproduzir um item
lab-help-scene-2 = A taxa de quadros no canto superior esquerdo: mostrar as estatísticas de quadro
lab-help-scene-3 = O botão do painel no canto superior direito: mostrar ou ocultar o painel

## A página do lab de um projeto sem plugin de editor (NoPluginPage.vue). Os comandos e os nomes das variáveis
## são valores de dados.

lab-no-plugin-title = Nenhum plugin de editor
lab-no-plugin-body = O projeto deste editor não tem plugin de editor. A página do lab precisa da face de editor de um plugin: os takes, o navegador de conteúdo e os comandos dele.
lab-no-plugin-scene = Para editar as cenas do projeto, abra a página de cena dele:
lab-no-plugin-project = Para abrir o lab de um plugin, inicie o editor no projeto dele com a variável:
# O studio tem o Hub, todos os projetos e os agentes.
lab-no-plugin-studio = Para abrir o Hub com todos os projetos, execute:
