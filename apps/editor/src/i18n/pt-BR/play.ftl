# SPDX-License-Identifier: Apache-2.0

### Os textos do controle de jogo da página da cena: Jogar, Parar, Manter,
### Repetir, Jogar em uma janela e a lista de manter.

## Os botões do controle de jogo na barra de arquivo.

play-start = Jogar
play-start-title = Jogar a partir de 0 ms; uma edição altera só o estado de jogo
play-stop = Parar
play-stop-title = Parar: o estado de edição volta
play-keep = Manter
play-keep-title = Escolher alterações do modo de jogo para manter
play-replay = Repetir
play-replay-title = Jogar de novo com a entrada da última partida (sem entrada ao vivo)
play-window-title = Jogar em uma janela (a vista de edição não muda)
play-command-running = O modo de jogo está em execução.
play-command-stopped = O modo de jogo não está em execução.
play-command-no-replay = Nenhuma entrada de uma última partida para jogar de novo.
play-command-no-clock = A cena não tem relógio (nenhuma sequência).
play-group = Jogar
play-pause = Pausar
play-pause-title = Pausar ou continuar (o relógio do modo de jogo)
play-step = Passo
play-step-title = Avançar um quadro (o relógio para)
play-time = { $seconds } s

## A lista de manter: as alterações do modo de jogo.

play-keep-list = Manter:
play-keep-none = Nenhuma alteração no modo de jogo
play-keep-apply = Manter as marcadas
play-keep-apply-title = Parar e manter as alterações marcadas (um passo de desfazer)
play-keep-cancel = Cancelar
play-keep-cancel-title = Fechar a lista; o modo de jogo continua
panel-game-view = Vista do jogo
game-camera = Câmera
game-camera-first = A primeira câmera
game-resolution = Resolução
game-resolution-free = Proporção livre
game-tier = Nível
game-backend = Backend
game-backend-auto = Melhor backend
game-worker = Worker
game-stats = Estatísticas
game-refresh = Atualizar
game-none = A página não oferece vista de jogo (o armazenamento do navegador recusa os documentos).
game-stats-line = { $fps } fps · { $draws } draw calls · { $triangles } triângulos · { $tier } · { $mode }

## As dicas e as gravações salvas do modo de jogo (play/playPanels.ts). $name é o nome de uma gravação
## (dados); $count é uma contagem de eventos; $component é um ID de componente (dados); $press é o texto de um
## pressionamento.

play-hints = As teclas do jogo
play-hints-title = Mostrar ou ocultar as teclas do jogo no modo de jogo
play-hints-close = Ocultar as teclas do jogo
play-hints-arg-show = True mostra as teclas do jogo no modo de jogo; false as oculta.
play-hint-click = Clique
play-hint-right-click = Clique direito
play-hint-on = { $press } em uma entidade com { $component }
play-recordings = Gravações
play-recordings-title = As gravações de entrada salvas do projeto
play-recordings-empty = Nenhuma gravação salva.
play-recording-save = Salvar a última partida
play-recording-save-title = Salvar a entrada da última partida com um nome
play-recording-replay-title = Jogar de novo com uma gravação salva
play-recording-delete = Excluir
play-recording-delete-title = Excluir uma gravação salva
play-recording-arg-name = O nome da gravação.
play-recording-count = { $count ->
    [one] { $count } evento
   *[other] { $count } eventos
}
play-recording-none = Nenhuma gravação salva "{ $name }".
play-recording-full = O armazenamento do navegador não guardou a gravação.
play-recording-arg-view = A vista em primeiro plano durante a repetição: game (o padrão) ou scene.
