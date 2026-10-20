# SPDX-License-Identifier: Apache-2.0

### Os textos do painel do inspetor da página da cena (scene/inspector).
### Os nomes dos componentes, os nomes dos campos e os nomes dos grupos vêm dos esquemas dos componentes: são dados.

## O painel (InspectorPanel.vue).

inspector-panel = Inspetor
inspector-title-scene = Cena
inspector-title-none = Nenhuma entidade
# $count é o número de entidades selecionadas (sempre mais de uma).
inspector-title-many = { $count } entidades
inspector-scene = Cena
inspector-scene-title = Mostrar os valores da cena
inspector-name = Nome
inspector-prefab-entities = Entidades do prefab
inspector-prefab-instance = Instância
# $count é o número de substituições da instância ou da entidade.
inspector-overridden = Substituições: { $count }
inspector-prefab-actions = Ações do prefab
inspector-prefab-open = Abrir prefab
inspector-prefab-open-title = Abrir o arquivo do prefab com as ferramentas do editor (o modo de prefab)
inspector-prefab-apply = Aplicar ao prefab
inspector-prefab-apply-instance = Gravar as substituições da instância no prefab
inspector-prefab-apply-entity = Gravar as substituições da entidade no prefab
inspector-prefab-revert-all = Reverter tudo
inspector-prefab-revert-entity = Reverter entidade
inspector-prefab-revert-instance-title = Remover as substituições da instância
inspector-prefab-revert-entity-title = Remover as substituições da entidade
inspector-add-label = Adicionar um componente
inspector-add = Adicionar componente…
# O grupo dos componentes que não indicam um grupo.
inspector-add-other = Outros

## Um componente (ComponentSection.vue). $component é o nome do componente.

inspector-component-apply = Aplicar
inspector-component-apply-title = Aplicar as substituições de { $component } ao prefab
inspector-component-docs = A documentação de { $component }
inspector-component-revert = Reverter
inspector-component-revert-title = Reverter as substituições de { $component } para os valores do prefab
inspector-component-remove = Remover { $component }

## Um campo (FieldRow.vue).

inspector-field-overridden = substituído
inspector-field-overridden-title = Substituído nesta instância
inspector-field-mixed = (misto)
inspector-field-mixed-title = As entidades têm valores diferentes
inspector-field-revert = Reverter para o valor do prefab
inspector-field-reset = Redefinir para o padrão

## Os widgets. $label é o nome do campo.

inspector-drag = Arraste para alterar { $label }
inspector-drag-title = Arraste para alterar { $label } (Shift: ×10, Alt: ×0,1)
# $axis é o nome do eixo: X, Y ou Z.
inspector-angle = { $label } { $axis } (graus)
inspector-angle-title = Ângulos de Euler em graus (XYZ)
inspector-colour-hex = { $label } (hex)
inspector-colour-placeholder = #rrggbb
inspector-json-placeholder = JSON
inspector-form = { $label }: tipo
inspector-form-none = Nenhum
inspector-form-object = Objeto
inspector-form-vector = Ponto
inspector-form-entity = Entidade
inspector-form-asset = Asset
inspector-form-colour = Cor
inspector-form-number = Número
inspector-form-text = Texto
inspector-form-switch = Interruptor
inspector-form-list = Lista
inspector-form-map = Mapa
inspector-form-curve = Curva
inspector-asset-pick = Escolher um asset
inspector-asset-edit = Editar
inspector-asset-edit-title = Abrir o material no editor de materiais
inspector-entity-pick = Escolher uma entidade
inspector-entity-socket = { $label } (soquete)
inspector-entity-whole = Entidade inteira
inspector-list-mixed = As entidades diferem; uma edição grava este valor em cada uma.
# $key é o índice de um item da lista ou a chave de um item do mapa.
inspector-list-remove = Remover { $key }
inspector-list-key = Nova chave
inspector-list-key-label = { $label }: nova chave
inspector-list-add = Adicionar
inspector-curve-mixed = As entidades diferem; uma edição grava esta curva em cada uma.
# $count é o número de chaves ou de pontos da curva.
inspector-curve-keys = { $label }: { $count } chaves
inspector-curve-points = { $label }: { $count } pontos
# $index é o número da chave ou do ponto (o primeiro é 1).
inspector-curve-remove-key = Remover a chave { $index }
inspector-curve-remove-point = Remover o ponto { $index }
inspector-curve-add-key = Adicionar chave
inspector-curve-add-point = Adicionar ponto

## Os títulos das edições no histórico (inspectorState.ts). $component é o nome do componente e $path o
## caminho do campo nele.

inspector-edit-field = { $component }: { $path }
inspector-edit-value = { $component }: valor
inspector-edit-reset-field = Redefinir { $component }: { $path }
inspector-edit-reset-value = Redefinir { $component }: valor
inspector-edit-revert-field = Reverter { $component }: { $path }
inspector-edit-revert-value = Reverter { $component }: valor
inspector-edit-rename = Renomear
inspector-edit-add = Adicionar { $component }
inspector-edit-remove = Remover { $component }

## As recusas que o painel mostra (inspectorState.ts).

inspector-no-prefab-tools = A página não tem ferramentas de prefab.
inspector-edit-tags = Tags
inspector-edit-show = Mostrar
inspector-edit-hide = Ocultar
inspector-edit-paste = Colar os valores de { $component }
inspector-edit-json = Editar o JSON
inspector-json-one = O modo JSON mostra uma entidade.
inspector-json-object = O JSON de uma entidade é um objeto com o nome, as tags e os componentes dela.
inspector-json-no-ops = O JSON não traz nenhuma alteração da entidade.
inspector-id = ID
inspector-id-copy = Copiar o ID
inspector-id-copied = O ID está na área de transferência
inspector-hide = Ocultar a entidade
inspector-show = Mostrar a entidade
inspector-tags = Tags
inspector-tag-remove = Remover a tag { $tag }
inspector-tag-add = Adicionar uma tag
inspector-add-none = Nenhum componente corresponde.
inspector-json = O JSON da entidade
inspector-json-apply = Aplicar
inspector-card-menu = O menu de { $component }
inspector-card-reset = Redefinir para os padrões
inspector-card-copy = Copiar os valores
inspector-card-paste = Colar os valores
inspector-card-remove = Remover o componente
inspector-card-docs = Documentação
inspector-card-ask = Perguntar ao agente
inspector-card-ask-prompt = Sobre o componente { $component } da entidade { $entity }:
inspector-raw = O modo JSON bruto
inspector-lock = Travar o inspetor nestas entidades
inspector-unlock = Seguir a seleção de novo

## As prévias ao vivo das dicas de ambiente. $distance é uma distância em metros.

inspector-preview-fog = A neblina ao longo da distância: neblina total a { $distance } m
inspector-preview-no-fog = Sem neblina: a vista fica limpa em qualquer distância
inspector-preview-bloom = O bloom: as amostras mais claras que o limiar brilham
inspector-preview-ambientOcclusion = A oclusão ambiente: a sombra em um canto
inspector-preview-selectionOutline = O contorno de uma entidade selecionada
inspector-preview-off = O efeito está desligado

## Os widgets dos modelos. $level é o número de um nível de detalhe; $place é o lugar de uma substituição.

inspector-lod-none = O modelo mostra o nível do patamar de qualidade. Adicione um nível para escolher os níveis pelo tamanho na tela.
inspector-lod-bar = A fração dos tamanhos de tela de cada nível
inspector-lod-level = Nível { $level } abaixo de
inspector-lod-size = O tamanho na tela em que o nível { $level } começa
inspector-lod-hysteresis = Histerese
inspector-lod-add = Adicionar um nível
inspector-lod-remove = Remover o último nível
inspector-pick-part = Escolher uma parte na vista
inspector-pick-part-wait = Clique em uma parte na vista…
inspector-pick-part-title = O próximo clique na Vista da cena adiciona uma substituição da parte sob ele (Escape interrompe)
inspector-pick-part-none = O clique não encontrou nenhuma parte de um modelo.
inspector-clip-asset = O modelo dos clipes
inspector-clip-rig = O perfil de rig do esqueleto dos clipes
inspector-clip-rig-auto = Automático (pelos nomes dos ossos)
inspector-clip-rig-none = Nenhum perfil (só os próprios clipes)
inspector-clip-remove = Usar os clipes do modelo
inspector-clip-none = O animador reproduz os clipes do próprio modelo.
inspector-overrides-none = Nenhuma substituição: a instância mostra o prefab como ele é.
inspector-overrides-revert = Reverter
inspector-overrides-revert-one = Reverter a substituição de { $place }
inspector-overrides-revert-all = Reverter tudo
inspector-overrides-apply = Aplicar
inspector-overrides-apply-one = Aplicar a substituição de { $place } ao prefab
inspector-prefab-unpack = Desempacotar
inspector-prefab-unpack-title = As entidades do prefab viram entidades comuns da cena; o vínculo com o prefab é removido

## As predefinições da pessoa no menu do cartão. $name é o nome de uma predefinição (dado).

inspector-card-save-preset = Salvar como predefinição
inspector-card-apply-preset = Aplicar a predefinição { $name }

## As chaves do inspetor (com uma sequência aberta).

inspector-key-none = Adicionar uma trilha e uma chave deste campo no tempo do relógio
inspector-key-track = Adicionar uma chave deste campo no tempo do relógio
inspector-key-key = Uma chave no tempo do relógio: definir este valor nela
inspector-record = Gravar
inspector-record-title = Gravar: uma edição no tempo do relógio vira uma chave

## A prévia de um campo de som.

inspector-sound-play = Tocar o som uma vez
inspector-sound-stop = Parar o som

## A trava dos pés de um animador. $part é o nome de uma parte de uma perna; $leg é o número da perna.

inspector-foot-upper = Osso superior
inspector-foot-lower = Osso inferior
inspector-foot-end = Osso final
inspector-foot-follow = Osso que segue
inspector-foot-part = { $part } da perna { $leg }
inspector-foot-remove-leg = Remover
inspector-foot-contact = Contato
inspector-foot-contact-title = Um pé está em contato quando sua altura está nesta parte mais baixa da sua faixa no clipe
inspector-foot-fade = Transição
inspector-foot-fade-title = A parte de um contato em cada ponta em que a trava entra e sai aos poucos
inspector-foot-none = Sem trava dos pés: os pés se movem como o clipe os move.
inspector-foot-add = Adicionar a trava dos pés
inspector-foot-add-leg = Adicionar uma perna
inspector-foot-remove = Remover a trava dos pés

## Os objetivos de IK de um personagem. $goal é o nome de um objetivo.

inspector-ik-left-hand = Mão esquerda
inspector-ik-right-hand = Mão direita
inspector-ik-look = Olhar
inspector-ik-target = O alvo de { $goal }
inspector-ik-weight = Peso
inspector-ik-angle = Ângulo máximo (°)
inspector-ik-remove = Remover
