# SPDX-License-Identifier: Apache-2.0
# O painel Revisão.
panel-review = Revisão
review-empty = Nenhuma alteração aguarda revisão.
review-turn = turno { $turn }
review-preview = Prévia
review-check-run = Verificar
review-checking = Verificando…
review-rules-pass = As regras passam
review-rules-fail = Uma regra falha
review-before = Antes
review-after = Depois
review-diff = O diff do conjunto
review-changes = As alterações do conjunto
review-document = A cena
review-check-entity = Escolher as alterações de { $name }
review-check-op = Escolher a alteração de { $field }
review-change-added = adicionado
review-change-removed = removido
review-change-changed = alterado
review-change-moved = movido
review-accept-entity = Aceitar as alterações de { $name }
review-reject-entity = Rejeitar as alterações de { $name }
review-accept-op = Aceitar esta alteração
review-reject-op = Rejeitar esta alteração
review-reject-all = Rejeitar todas
review-accept-checked = Aceitar { $count } marcadas
review-accept-all = Aceitar todas
review-status = { $count ->
    [one] { $count } alteração aguarda
   *[other] { $count } alterações aguardam
}
review-feedback = Turno { $turn }: a pessoa aceitou { $accepted } de { $total } alterações.
review-feedback-rejected = { " " }Rejeitadas: { $list }.
review-mark = { $by } alterou isto
review-mark-field = { $by } propõe { $after } (agora { $before }); aguarda revisão
review-stale = ⚠ não existe mais
review-conflict = ⚠ você alterou
review-conflict-title = Você alterou este valor depois do agente. O seu valor fica, a menos que você aceite a alteração do agente.
review-undo-turn = Desfazer o turno { $turn } de { $name }
review-undo-no-inverse = Um passo do turno não tem inverso.
review-no-checkpoint = Esta janela não tem checkpoint desse turno.
review-restore = Restaurar o checkpoint do turno { $turn }
review-change-working = em andamento
