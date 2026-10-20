# SPDX-License-Identifier: Apache-2.0

### Os textos das ferramentas de layout da página da cena (scene/layoutTools). As linhas do resultado
### de uma ferramenta e os motivos de uma ferramenta sem entrada vêm de @scenity/runtime-dev e ficam em inglês.

## O menu de ferramentas (startLayoutTools.ts): o nome de cada ferramenta e seu título com o que a ferramenta precisa.

layout-tool-bar = Ferramentas de layout
layout-tool-readout = Leitura
layout-tool-measure = Medir
layout-tool-measure-title = Medir: duas entidades selecionadas ou dois pontos escolhidos
layout-tool-reach = Alcance
layout-tool-reach-title = Alcance: uma entidade com um componente de personagem ou um ponto de apoio
layout-tool-clearance = Folga
layout-tool-clearance-title = Folga: uma ou mais entidades selecionadas com uma caixa
layout-tool-walk = Trajetos de caminhada
layout-tool-walk-title = Trajetos de caminhada: uma entidade com um componente de locomoção ou duas entidades
layout-tool-visibility = Visibilidade
layout-tool-visibility-title = Visibilidade: uma entidade alvo e uma entidade de olho ou a câmera
layout-tool-clear = Limpar

## A leitura. $index é o número do próximo ponto escolhido da medida (1 ou 2).

layout-tool-pick = Clique em um ponto da tela ({ $index } de 2).

## O comando de página da tecla Escape e o motivo pelo qual ele não pode ser executado agora.

layout-tool-command-measure-clear = Limpar os pontos da medida
layout-tool-refuse-no-points = A medida não tem pontos.
# Uma regra com o valor atual como limite.
layout-tool-save-rule = Salvar como regra
# A busca de layout.
layout-search = Encontrar um lugar
layout-search-title = Buscar um lugar perto da primeira entidade selecionada onde as regras da cena passam
layout-search-apply = Aplicar
layout-search-apply-title = Encontrar um lugar
layout-search-none = Nenhum lugar perto desta entidade passa nas regras.
layout-search-no-variant = A última busca não tem o lugar { $id }.
