# SPDX-License-Identifier: Apache-2.0

### Os textos da aba de material da página da cena (scene/material/; docks da cena). Os nomes de materiais, as
### referências de assets, os caminhos de arquivos, os nomes de texturas, os tipos de material, os espaços de cor e os
### IDs de entidades são valores de dados. Os rótulos dos valores, dos grupos, dos slots de textura e das partes vêm de
### @scenity/editor-core e ficam em inglês.

## O material aberto (MaterialPanel.vue).

material-panel = Material
material-asset = Asset de material
material-open = Abrir um material…
# $count é a contagem das entidades que usam o material.
material-users =
    { $count ->
        [one] Usado por { $count } entidade
       *[other] Usado por { $count } entidades
    }
material-type = Tipo
material-type-label = Tipo de material
material-name = Nome
material-name-label = Nome do material
material-save = Salvar
material-new-name = Nome do novo material
material-new = Novo

## A atribuição a uma parte da entidade selecionada. $part é o rótulo de uma parte, $name o nome do material.

material-assign-section = Atribuir a uma parte
material-select-entity = Selecione uma entidade.
material-part = Parte
material-part-this = { $part } (este material)
material-no-parts = A entidade não tem modelo nem forma.
material-assign = Atribuir { $name }
material-assign-unnamed = Atribuir o material

## Um valor e um slot de textura (MaterialValue.vue, TextureSlot.vue). $label é o rótulo de um valor, $axis é U ou V.

material-hex = { $label } (hex)
# A amostra de uma cor hex em um campo de cor vazio.
material-hex-sample = #rrggbb
material-reset = Redefinir { $label } para o padrão
material-texture-none = nenhuma
material-colour-space = Espaço de cor
material-repeat = Repetição
material-repeat-axis = Repetição { $axis }
material-offset = Deslocamento
material-offset-axis = Deslocamento { $axis }

## A linha de status do painel. $entity é um ID de entidade, $ref uma referência de asset, $reason o motivo de uma recusa.

material-assigned = Atribuído a { $entity }.
material-assigned-part = Atribuído a { $entity } ({ $part }).
material-created = Novo material { $ref }.
material-saved = Salvo.
material-not-saved = Não salvo: { $reason }
material-not-saved-changed = Não salvo: o arquivo mudou no disco

## O editor de materiais da página (pageMaterials.ts). A linha de status mostra estes erros.

# $status é o código de status HTTP da requisição do índice de assets.
material-no-index = sem índice de assets ({ $status })
material-not-found = o projeto não tem o asset de material { $ref }
# $reason vem do servidor de desenvolvimento (em inglês).
material-import-failed = a importação falhou: { $reason }
material-no-changes = Nenhum material tem alterações.

## O título da atribuição no histórico. $part é o nome da parte do modelo.

material-assign-step = Atribuir um material a { $entity }
material-assign-step-part = Atribuir um material a { $entity } { $part }

## Os rótulos dos campos, dos grupos e dos mapas de textura de material de @scenity/editor-core, por chave.

material-field-colour = Cor
material-field-roughness = Rugosidade
material-field-metalness = Metalicidade
material-field-opacity = Opacidade
material-field-alpha-test = Teste alfa
material-field-side = Lado
material-field-flat-shading = Sombreamento plano
material-field-normal-scale = Escala da normal
material-field-emissive = Cor emissiva
material-field-emissive-intensity = Intensidade emissiva
material-field-clearcoat = Verniz
material-field-clearcoat-roughness = Rugosidade do verniz
material-field-sheen = Lustro
material-field-sheen-colour = Cor do lustro
material-field-sheen-roughness = Rugosidade do lustro
material-field-transmission = Transmissão
material-field-thickness = Espessura (m)
material-field-ior = IOR
material-field-iridescence = Iridescência
material-field-specular-intensity = Intensidade especular
material-field-specular-colour = Cor especular
material-field-specular = Cor especular
material-field-shininess = Brilho

material-group-surface = Superfície
material-group-emission = Emissão
material-group-physical = Físico
material-group-phong = Phong

material-map-colour = Mapa de cor
material-map-normal = Mapa de normais
material-map-roughness = Mapa de rugosidade
material-map-metalness = Mapa de metalicidade
material-map-emissive = Mapa emissivo
material-map-occlusion = Mapa de oclusão
material-map-alpha = Mapa alfa

## As predefinições do editor de materiais, e o soltar de uma textura em um slot.

material-presets = Predefinições
material-preset-plastic = Plástico
material-preset-metal = Metal
material-preset-wood = Madeira
material-preset-glass = Vidro
material-preset-rubber = Borracha
material-preset-ceramic = Cerâmica
material-texture-drop = Solte uma textura aqui, ou escolha uma
