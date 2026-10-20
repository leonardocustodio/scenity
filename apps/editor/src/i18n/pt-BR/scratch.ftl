# SPDX-License-Identifier: Apache-2.0

### Os textos dos props provisórios da página do lab: a parte provisória do cartão de seleção, a lacuna de direitos
### e a promoção (src/core/scratch).

## A parte provisória do cartão de seleção (ScratchCard.vue).

scratch-intro = Prop provisório de { $name } (importação { $import }): uma entrada do lab, fora do build do aluno.
scratch-loading = carregando o modelo…
scratch-budget =
    { $pass ->
        [yes] { $triangles } triângulos, { $kb } KB · dentro do orçamento de prop
       *[no] { $triangles } triângulos, { $kb } KB · ACIMA do orçamento de prop
    }
scratch-field-source = fonte
scratch-field-licence = licença
scratch-not-given = não informada
scratch-rights = Direitos desconhecidos: { $gap }. Uma promoção aponta o asset para o registro de direitos das importações; o bloqueio de release a impede até que o proprietário registre os direitos dele.
scratch-duplicate = Duplicar
scratch-delete = Excluir

## Promover para a sala.

scratch-promote-dry = Promover para a sala (execução de teste)
scratch-promote-dry-title = Perguntar ao host o que a promoção escreve
scratch-promote-blocked = Promover: { $reason }.
scratch-promote-needs-host = a promoção precisa do host do workbench
scratch-promoting = Promovendo…
scratch-promote-changes = O que a promoção escreve (sem prompt do Claude):
scratch-promoted = Promovido: entidade { $entity }.
scratch-promote = Promover

## A lacuna dos direitos e os motivos que impedem uma promoção (scratchInfo.ts).

scratch-gap-no-record = nenhum registro de importação
scratch-gap-no-answers = sem fonte e sem licença
scratch-gap-no-source = sem fonte
scratch-gap-no-licence = sem licença
scratch-gap-not-checked = não verificado no registro de licenças: importe o arquivo de novo
scratch-gap-not-allowed = o registro de licenças não permite a fonte
scratch-block-budget = o modelo não está dentro do orçamento

## Os modelos dos props provisórios (scratchModels.ts).

scratch-model-none = nenhum modelo
scratch-model-needs-host = os modelos dos props provisórios vêm do host do workbench
scratch-model-timeout = nenhum modelo em { $seconds } s
