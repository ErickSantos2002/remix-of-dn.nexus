# Corrigir o tempo na etapa (badge do pipeline e "Tempo por etapa")

## O que a investigação encontrou

O objetivo — medir há quanto tempo o card está na etapa atual — não está sendo cumprido. A suspeita está correta, e a causa foi confirmada nos dados.

**Como funciona hoje**

- Badge do card no pipeline: usa `crm_leads.moved_at`.
- Sessão "Tempo por etapa" no detalhe: usa a view `crm_lead_stage_durations`, montada a partir do histórico (`crm_lead_history`).

Ou seja, são duas fontes diferentes, e elas divergem.

**Problema 1 — `moved_at` é reescrito sem troca de etapa**

O gatilho do banco só atualiza `moved_at` quando a etapa realmente muda, mas vários fluxos da aplicação gravam `moved_at = agora` na mão, mesmo com o card parado na mesma etapa (reabertura de card perdido/excluído, reativação pela lista de contatos, fluxos do widget de agenda/agendamento, endpoint de etapa da API).

Verificação: **382 cards ativos** têm `moved_at` mais recente que a última mudança real de etapa registrada no histórico. Exemplo real (card "SPL Engenharia"): entrou em "SQL - Em negociação" em **29/07**, mas o `moved_at` foi reescrito em **06/08** — o badge mostra ~1 dia em vez de ~9 dias.

**Problema 2 — a linha do tempo do detalhe se fragmenta**

A view trata registros de `reopened` (33 no último mês, com etapa de origem igual à de destino) como início de um novo período na mesma etapa, reiniciando a contagem sem que o card tenha se movido.

**Problema 3 — cards sem histórico não mostram nada**

1311 cards não possuem nenhum registro de mudança de etapa (foram criados já na etapa inicial). Para eles a sessão "Tempo por etapa" fica vazia, quando deveria mostrar o tempo desde a criação na etapa inicial.

## O que será feito

1. **Tornar `moved_at` imutável fora de mudança de etapa**
   Ajustar o gatilho `track_lead_stage_change` para, quando `stage_id` não muda, restaurar `moved_at` para o valor anterior — ignorando qualquer valor enviado pela aplicação. Isso corrige todos os fluxos de uma vez (widget, API, reativação, agendamento), sem precisar caçar cada chamada.

2. **Corrigir os dados existentes (backfill)**
   Recalcular `moved_at` dos cards a partir do histórico: última entrada real na etapa atual; sem histórico, usar `created_at`. Aplicado apenas onde há divergência.

3. **Corrigir a view `crm_lead_stage_durations`**
   - Não iniciar um novo período quando o registro de histórico não muda de etapa (`reopened`/reentrada na mesma etapa) — o período continua.
   - Incluir um período inicial derivado de `created_at` + etapa inicial para cards sem histórico, para que o detalhe sempre mostre pelo menos a etapa atual.

4. **Alinhar as duas telas**
   Com (1) e (3), o badge do pipeline e o período "atual" da sessão "Tempo por etapa" passam a exibir o mesmo número. O badge usa `created_at` como fallback quando `moved_at` estiver nulo.

## Decisão adotada

Reabrir um card perdido/excluído **não** reinicia o relógio da etapa: o tempo continua contando desde a entrada real naquela etapa. Se preferir que a reabertura zere a contagem, é só avisar que ajusto o plano.

## Detalhes técnicos

- Migration 1: `track_lead_stage_change` — `IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN NEW.moved_at := OLD.moved_at; END IF;`
- Migration 2: backfill `crm_leads.moved_at` via `crm_lead_history` (último `to_stage_id = stage_id` com troca efetiva), fallback `created_at`.
- Migration 3: `CREATE OR REPLACE VIEW public.crm_lead_stage_durations` — filtrar segmentos onde `from_stage_id IS NOT DISTINCT FROM to_stage_id`, e `UNION` do período sintético inicial para cards sem histórico.
- Frontend: `src/pages/CRMPipeline.tsx` (fallback `moved_at ?? created_at` no `StageDurationBadge`). Nenhuma mudança na regra de cores/thresholds.
