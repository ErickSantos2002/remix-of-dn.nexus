# Reunião cancelada na agenda, mas atividade continua "pendente" no card

## O que foi verificado no banco

Card `2b2510af-6ea6-4389-b96a-26cb2092c575`:

- Agendamento `0c4925f9…` — `status = cancelled`, `notes = "Reagendamento solicitado pelo cliente"`, alterado em 17/08 17:10 (Brasília). Evento do Google já havia sido criado (`google_event_id` preenchido).
- Atividade `90dba9b5…` (tipo `meeting`, mesma data 18/08 16:00 Brasília) — continua com `status = pending` e vinculada ao agendamento cancelado pelo campo `appointment_id`.
- Nenhum agendamento novo foi criado para esse contato depois do cancelamento: o reagendamento cancelou o horário antigo e não gerou o novo.

Não é um caso isolado: uma consulta cruzando `crm_lead_activities` com `crm_appointments` retornou **7 atividades ainda em aberto** apontando para agendamentos cancelados (incluindo 4 de reuniões de 18 e 19/08).

## Origem do cancelamento (confirmada)

Foi o **agente de IA**, pela ferramenta de reagendamento (`schedule-appointment`, ação RESCHEDULE). A conversa do lead comprova:

```text
17/08 17:10:05  lead: "Oi será que conseguimos antecipar a nossa reunião para as 15:30"
17/08 17:10:16  (banco) agendamento 0c4925f9 -> status = cancelled,
                notes = "Reagendamento solicitado pelo cliente", evento do Google apagado
17/08 17:10:19  IA: "Infelizmente amanhã às 15h30 não está disponível..."
17/08 17:21:50  IA: "sua reunião estratégica está mantida para amanhã, 18 de agosto, às 16:00"
```

A IA cancelou o horário original **antes** de garantir o novo. Como não havia slot às 15:30, nenhum agendamento novo foi criado — e ela ainda respondeu ao lead que a reunião de 16:00 estava mantida. A nota `"Reagendamento solicitado pelo cliente"` só é escrita por esse trecho de código, e hoje existem **12 agendamentos cancelados com essa mesma nota** (contra 3 por exclusão de atividade, 1 manual e 1 "Cancelado pelo cliente"), ou seja, é o caminho dominante de cancelamento indevido.

## Causa

Dois problemas somados:

1. **Cancelamento prematuro no reagendamento da IA** — `handleReschedule` cancela o agendamento antigo e apaga o evento do Google *antes* de tentar criar o novo. Se não houver disponibilidade, o lead fica sem reunião sem saber.
2. **Cancelamento não propaga para a atividade** — nem o fluxo da IA nem o cancelamento manual em `AppointmentDetailSheet` atualizam `crm_lead_activities`. Existe sincronização para "não compareceu", mas não para "cancelado".

Ou seja: a agenda mostra "Cancelado" e o card mostra a reunião como normal/pendente — exatamente a discrepância observada.


## Correção proposta

1. **Sincronizar cancelamento → atividade (banco).** Trigger em `crm_appointments`: quando `status` passa para `cancelled`, marcar as atividades com aquele `appointment_id` (ou mesmo lead + `scheduled_at`) que ainda estejam `pending` como `cancelled`, registrando a origem nas notas. Assim vale para todos os caminhos (IA, widget, UI, API) sem duplicar lógica.
2. **Reagendamento seguro na IA (prioridade).** Em `schedule-appointment/handleReschedule`, inverter a ordem: primeiro verificar disponibilidade e criar o novo agendamento; só então cancelar o antigo e remover o evento do Google. Sem slot disponível, nada é cancelado e a IA informa que o horário original segue valendo.
3. **Rastreabilidade da origem.** Padronizar a nota de cancelamento com a origem (`IA — reagendamento`, `Usuário — /crm/appointments`, `Atividade excluída`, `Widget`), para que a agenda mostre por que aquele horário foi cancelado.
4. **Cancelamento manual.** Ajustar `AppointmentDetailSheet` para invalidar também as queries de atividades do card, para a UI refletir na hora.
5. **Backfill.** Corrigir as 7 atividades já órfãs (marcar como canceladas), preservando histórico. Caso específico do Guilherme Rudniki (18/08 16:00): definir com você se reabrimos o agendamento ou mantemos cancelado.
6. **Validação.** Reconferir a consulta de divergência (deve voltar vazia) e testar cancelamento manual e reagendamento pela IA ponta a ponta.

## Detalhes técnicos

- Trigger `AFTER UPDATE OF status ON public.crm_appointments`, `SECURITY DEFINER`, atuando apenas em `OLD.status <> 'cancelled' AND NEW.status = 'cancelled'`, atualizando `crm_lead_activities` com `status = 'cancelled'` onde `appointment_id = NEW.id AND status = 'pending'`.
- As réguas já são canceladas pelo trigger existente `trg_cancel_cadence_on_activity_cancel`, que passará a disparar em cascata — comportamento desejado.
- Sem mudanças de schema (nenhuma coluna nova).
