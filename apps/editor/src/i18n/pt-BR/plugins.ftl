# SPDX-License-Identifier: Apache-2.0
# As faces do studio dos plugins.

plugin-error-title = { $name } do plugin { $plugin } parou com um erro.
plugin-error-off = { $name } do plugin { $plugin } está desligado: parou com um erro { $count } vezes seguidas.
plugin-error-on = Ligar
plugin-reloaded = As faces de studio dos plugins carregaram de novo ({ $count }) após uma mudança no código delas.
plugin-error-again = Tentar de novo
plugin-not-face = Uma face do studio de um plugin não é um objeto de defineStudioPlugin.
plugin-bad-id = O ID de uma face do studio não é uma palavra em minúsculas.
plugin-no-version = A face do studio de { $id } não tem apiVersion.
plugin-version-unknown = A face do studio de { $id } tem apiVersion { $version }; este editor aceita { $current } e a anterior. O editor não a carrega.
plugin-version-old = A face do studio de { $id } tem a apiVersion antiga { $version }. Ela funciona; mude-a para { $current } (docs/plugins.md, "The studio face").
plugin-not-prefixed = O plugin { $id } tem a contribuição { $name }: o ID dela deve começar com "{ $prefix }".
plugin-load-failed = As faces do studio dos plugins de { $project } não carregaram.
plugin-contribution-failed = { $name } do plugin { $plugin } parou com um erro.

## A janela Plugins.

plugins-restart = Os plugins do projeto mudaram. A janela os carrega depois de recarregar.
plugins-reload = Recarregar
plugins-none = O projeto não tem plugins.
plugins-remove = Remover
plugins-add = Adicionar um plugin
plugins-checkout = Os plugins do checkout
plugins-add-button = Adicionar
plugins-entry = Um nome de pacote ou um caminho de pasta
plugins-docs = A documentação dos plugins
plugins-face-runtime = Runtime
plugins-face-host = Host
plugins-face-dev = Dev
plugins-face-studio = Studio
plugins-face-editor = Editor do lab
plugins-face-cli = Comandos

## O assistente de novo plugin.

plugins-new = Um novo plugin
plugins-new-id = O ID do plugin (uma palavra em minúsculas)
plugins-new-component = O nome do componente
plugins-new-field = O nome do campo
plugins-new-kind = O tipo do campo
plugins-new-kind-number = Número
plugins-new-kind-boolean = Sinalizador
plugins-new-kind-text = Texto
plugins-new-add-field = Adicionar um campo
plugins-new-part-system = Um sistema
plugins-new-part-presenter = Um presenter (um objeto three.js)
plugins-new-part-simulation = Uma simulação (as chaves de ação de uma sequência)
plugins-new-part-metric = Uma métrica das regras
plugins-new-part-studio = Um painel do studio
plugins-new-make = Criar o plugin
plugins-new-ask = Pedir ao agente que o escreva
plugins-new-prompt = Escreva a lógica do novo plugin { $id } em plugins/{ $id }/: o sistema do componente { $component } (campos: { $fields }). Mantenha os arquivos do plugin; adicione testes; execute scenity check.

## O painel Tomadas de uma face de laboratório no estúdio
lab-takes-title = Tomadas
lab-takes-take = Tomada
lab-takes-time = Tempo
lab-takes-ms = { $time } ms
lab-takes-members = Os membros neste momento
lab-takes-marks = As marcas até este momento
lab-takes-none = Nenhum
lab-takes-note = Reproduzir uma tomada na vista precisa da página de laboratório do plugin.
