# SPDX-License-Identifier: Apache-2.0

### Os rótulos dos componentes internos, dos grupos deles e dos campos deles. A fonte é
### en-US/components.ftl: `bun tools/component-texts.ts` grava esse arquivo a partir dos esquemas de @scenity/scene.

## Os grupos

component-group-place = Posicionamento
component-group-render = Renderização
component-group-shadow = Sombra
component-group-detail = Detalhe
component-group-clip = Recorte
component-group-scene = Cena
component-group-effects = Efeitos
component-group-general = Geral
component-group-navigation = Navegação
component-group-animation = Animação
component-group-root-motion = Movimento raiz
component-group-audio = Áudio
component-group-spatial = Espacial
component-group-rig = Rig
component-group-look = Aparência
component-group-ik = IK

## transform

component-transform = Transformação
component-field-transform-position = Posição
component-field-transform-rotation = Rotação
component-field-transform-scale = Escala

## model

component-model = Modelo
component-field-model-asset = Modelo
component-field-model-materials = Substituições de material
component-field-model-cast-shadow = Projetar sombra
component-field-model-receive-shadow = Receber sombra
component-field-model-lod = Níveis de detalhe
component-field-model-lod-screen = Tela
component-field-model-lod-hysteresis = Histerese

## shape

component-shape = Forma
component-field-shape-kind = Tipo
component-field-shape-size = Tamanho
component-field-shape-colour = Cor
component-field-shape-roughness = Rugosidade
component-field-shape-metalness = Metalicidade
component-field-shape-material = Material
component-field-shape-cast-shadow = Projetar sombra
component-field-shape-receive-shadow = Receber sombra

## light

component-light = Luz
component-field-light-type = Tipo
component-field-light-colour = Cor
component-field-light-ground-colour = Cor do chão
component-field-light-intensity = Intensidade
component-field-light-range = Alcance
component-field-light-angle = Ângulo
component-field-light-penumbra = Penumbra
component-field-light-shadow = Sombra
component-field-light-target = Alvo
component-field-light-shadow-camera = Câmera da sombra
component-field-light-shadow-camera-left = Esquerda
component-field-light-shadow-camera-right = Direita
component-field-light-shadow-camera-top = Superior
component-field-light-shadow-camera-bottom = Inferior
component-field-light-shadow-camera-near = Perto
component-field-light-shadow-camera-far = Longe
component-field-light-shadow-bias = Viés da sombra
component-field-light-shadow-normal-bias = Viés normal da sombra

## camera

component-camera = Câmera
component-field-camera-fov = Campo de visão
component-field-camera-near = Perto
component-field-camera-far = Longe
component-field-camera-target = Alvo
component-field-camera-safe-frame = Quadro seguro
component-field-camera-safe-frame-entities = Entidades
component-field-camera-safe-frame-min = Mínimo
component-field-camera-safe-frame-max = Máximo
component-field-camera-safe-frame-margin = Margem
component-field-camera-safe-frame-max-fov = Campo de visão máximo

## environment

component-environment = Ambiente
component-field-environment-background = Fundo
component-field-environment-tone-mapping = Mapeamento de tons
component-field-environment-exposure = Exposição
component-field-environment-map = Mapa de ambiente
component-field-environment-map-intensity = Intensidade do mapa
component-field-environment-fog = Neblina
component-field-environment-ao = Oclusão ambiente
component-field-environment-ao-on = Ligado
component-field-environment-ao-radius = Raio
component-field-environment-ao-intensity = Intensidade
component-field-environment-bloom = Bloom
component-field-environment-bloom-on = Ligado
component-field-environment-bloom-threshold = Limiar
component-field-environment-bloom-strength = Força
component-field-environment-bloom-radius = Raio
component-field-environment-antialias = Antisserrilhamento
component-field-environment-outline = Contorno da seleção
component-field-environment-outline-on = Ligado
component-field-environment-outline-colour = Cor
component-field-environment-outline-thickness = Espessura
component-field-environment-outline-strength = Força

## socket

component-socket = Soquetes
component-field-socket-points = Pontos

## tags

component-tags = Tags

## visibility

component-visibility = Visibilidade
component-field-visibility-visible = Visível

## pickable

component-pickable = Selecionável
component-field-pickable-enabled = Ativado
component-field-pickable-priority = Prioridade
component-field-pickable-mode = Teste de acerto
component-field-pickable-layers = Camadas

## obstacle

component-obstacle = Obstáculo
component-field-obstacle-footprint = Área ocupada
component-field-obstacle-height = Altura

## standPoint

component-stand-point = Ponto de parada
component-field-stand-point-facing = Direção
component-field-stand-point-role = Papel

## path

component-path = Caminho
component-field-path-points = Pontos
component-field-path-closed = Fechado
component-field-path-width = Largura

## annotation

component-annotation = Anotação
component-field-annotation-text = Texto
component-field-annotation-colour = Cor
component-field-annotation-status = Status
component-field-annotation-task = Tarefa do agente

## prefab

component-prefab = Prefab
component-field-prefab-source = Prefab
component-field-prefab-overrides = Substituições

## animator

component-animator = Animador
component-field-animator-controller = Controlador
component-field-animator-controller-parameters = Parâmetros
component-field-animator-controller-layers = Camadas
component-field-animator-controller-step-ms = Passo em ms
component-field-animator-parameters = Parâmetros
component-field-animator-speed = Velocidade
component-field-animator-root-bone = Osso raiz
component-field-animator-root-motion = Movimento raiz
component-field-animator-foot-lock = Trava dos pés
component-field-animator-foot-lock-legs = Pernas
component-field-animator-foot-lock-contact = Contato
component-field-animator-foot-lock-fade = Esmaecimento
component-field-animator-clip-source = Origem dos clipes
component-field-animator-clip-source-asset = Asset
component-field-animator-clip-source-rig = Rig

## locomotion

component-locomotion = Locomoção
component-field-locomotion-speed = Velocidade de caminhada
component-field-locomotion-turn-speed = Velocidade de giro
component-field-locomotion-parameter = Parâmetro de velocidade
component-field-locomotion-walks = Caminhadas

## audioSource

component-audio-source = Fonte de áudio
component-field-audio-source-asset = Som
component-field-audio-source-volume = Volume
component-field-audio-source-loop = Repetir
component-field-audio-source-autoplay = Reprodução automática
component-field-audio-source-spatial = Espacial
component-field-audio-source-ref-distance = Distância de referência
component-field-audio-source-rolloff = Atenuação
component-field-audio-source-max-distance = Distância máxima
component-field-audio-source-distance-model = Modelo de distância

## character

component-character = Personagem
component-field-character-rig = Perfil do rig
component-field-character-bones = Ossos
component-field-character-variant = Variante
component-field-character-variants = Variantes
component-field-character-ik = Objetivos de IK
component-field-character-ik-left-hand = Mão esquerda
component-field-character-ik-left-hand-target = Alvo
component-field-character-ik-left-hand-weight = Peso
component-field-character-ik-left-hand-pole = Polo
component-field-character-ik-right-hand = Mão direita
component-field-character-ik-right-hand-target = Alvo
component-field-character-ik-right-hand-weight = Peso
component-field-character-ik-right-hand-pole = Polo
component-field-character-ik-look = Olhar
component-field-character-ik-look-target = Alvo
component-field-character-ik-look-weight = Peso
component-field-character-ik-look-max-angle = Ângulo máximo
