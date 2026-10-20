# SPDX-License-Identifier: Apache-2.0

### Os textos da importação por soltar na cena da página do lab: a dica, o formulário, a lista dos modelos e as
### recusas (src/core/importDrop).

## A camada sobre a cena (ImportDropLayer.vue).

import-hint = Solte um arquivo .glb, .gltf, .obj, .fbx ou .blend para colocá-lo aqui
import-title = Importar { $name }
import-no-point = sem ponto de destino
import-point = em { $point } m
import-source = Origem (uma URL, um fornecedor ou "feito por mim")
import-licence = Licença (por exemplo CC0-1.0, ou uma licença de loja)
import-send = Importar no host
import-cancel = Cancelar
import-model-title = { $name } em { $point } m
import-remove = Remover { $name }

## Os modelos na cena (previewStore.ts).

import-quick-label = prévia, não otimizada
import-no-preview = Sem prévia de { $name }: { $error }

## O estado e as recusas de um soltar (useImportDrop.ts).

import-refused-format = { $name }: o lab importa arquivos { $formats }
import-refused-size = { $name }: { $mb } MB, acima do limite de 200 MB
import-refused-blender = { $name }: um arquivo do Blender precisa do host do workbench (Blender 5.2); a página do lab sozinha mostra arquivos .glb, .gltf, .obj e .fbx
import-refused-app = { $name }: soltar um arquivo no app precisa do workbench
import-sent = { $name }: enviado ao host para a importação
