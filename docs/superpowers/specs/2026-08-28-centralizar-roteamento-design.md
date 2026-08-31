# Centralização do Roteamento — Design

**Data**: 2026-08-28
**Status**: aprovado em brainstorm, aguardando plano de implementação
**Rota**: `/settings/routing` (`src/pages/RoutingConfig.tsx`)

## 1. Contexto e objetivo

Existem hoje **quatro** decisores independentes de "quem atende este lead", nenhum deles governado pela página de Configuração de Roteamento. A página escreve `workspace_routing_config`, e nenhum código vivo lê essa tabela. O objetivo é fazer a página ser a fonte única das **regras** de distribuição — tanto de conversa quanto de agendamento — e corrigir os defeitos estruturais que hoje impedem o roteamento de conversa de funcionar.

### 1.1 Estado atual

| # | Onde | Dispara quando | Pool de candidatos | Regra | Config lida |
|---|---|---|---|---|---|
| 1 | `src/lib/routing/routeLeadToAgent.ts` | **nunca** — não é importado | `agent_availability` (`status='online'`) ∩ `category_agent_assignments` | `strategy` | `workspace_routing_config` |
| 2 | `supabase/functions/orchestrator/routing-handler.ts` → `handleHandoff` | IA passa para humano (`orchestrator/index.ts:464`) | idem | `least_loaded` / `round_robin` | `routing_config` — **tabela nunca escrita** |
| 3 | `supabase/functions/schedule-appointment/index.ts` | IA agenda pelo WhatsApp (tool call) | `crm_agent_calendars` → fallback `crm_google_calendar_integration` → filtro `agent_tools.config.allowed_attendants` | least-loaded, janela 7 dias, inclui `completed` | hardcoded |
| 4 | `supabase/functions/schedule-widget/index.ts` | agendamento pelo widget público | `scheduling_widget_members` (`is_active`) | least-loaded, janela 30 dias, exclui `completed`, empate por `Math.random()`, sticky owner | hardcoded |

### 1.2 Defeitos confirmados no código

Estes não são débito estético — são falhas que tornam o roteamento de conversa inoperante:

1. **`routing_config` nunca recebeu uma linha.** `routing-handler.ts:101` faz `.single()` numa tabela vazia, o erro é engolido e o roteador cai nos defaults hardcoded do próprio arquivo (`max_leads_per_agent: 5`, contra o default 10 da página). A configuração da página nunca chegou ao orchestrator.

2. **`current_leads_count` só sobe.** `routing-handler.ts:191-199` incrementa a cada atribuição. Nada no código vivo decrementa — `resolveLead.ts` faria, mas não é importado por nenhum componente. Como `getAvailableHumanAgents` filtra `current_leads_count < max_concurrent_leads`, **todo atendente cruza o teto e sai do roteamento em definitivo** (na 5ª atribuição, com o default do orchestrator).

3. **Ninguém fica online.** `agent_availability.status` só muda pelo botão manual em `AgentAvailability.tsx:186`, numa página que o atendente precisa visitar. Não há heartbeat, login ou atividade que altere o status. Como `getAvailableHumanAgents` filtra `.eq("status", "online")`, na prática **todo handoff encontra zero atendentes**.

4. **A fila é um ralo.** Sem atendente, o lead entra em `lead_queues` com `status='waiting'`. Não existe cron para `lead_queues` (o projeto tem 5 crons: zapi-health-check, anti-ban ×2, um de 2026-06 e o flow-worker). `processWaitingQueue.ts` existe e nunca é chamado. Nenhuma tela lista `waiting` — `AgentAvailability.tsx:119` filtra `assigned`/`in_progress`. O lead entra e não sai.

5. **A transferência manual falha sempre.** `transferLead.ts:29-31` retorna `Target agent is not online` quando o destino não está `online` — combinado com o defeito 3, isso rejeita toda transferência feita pelo `TransferDialog`.

6. **A janela de carga do widget conta errado.** `schedule-widget/index.ts:1470-1476` soma `crm_appointments` dos últimos 30 dias filtrando `status IN ('scheduled','confirmed')`. Reunião realizada vira `completed` e some da contagem, então o rodízio enxerga quase só reuniões futuras: quem atendeu muito no mês anterior aparece ocioso. O `schedule-appointment` inclui `completed` e acerta.

7. **Três das cinco estratégias não existem.** `skill_based`, `performance_based` e `category_based` caem no `default` de `selectBestAgent` (`routeLeadToAgent.ts:253-260`) e viram `least_loaded` silenciosamente. `skill_matching`, `require_approval` e `queue_timeout_minutes` são gravados e nunca lidos.

8. **Nada encerra um atendimento.** `lead_queues.status` nunca sai de `assigned`/`in_progress`; `lead_assignments.completed_at` nunca é preenchido. `resolveLead.ts` faria os dois, e não é chamado.

## 2. Decisões de produto (fixadas no brainstorm)

1. **Escopo: conversa + agendamento.** A página governa os dois, em seções separadas — as regras são diferentes por natureza e não devem ser fundidas num campo só.
2. **Pool de chat**: membros do workspace, filtrados por jornada de trabalho. É o que o card "Atendentes Humanos" exibe, e vale **somente para chat**.
3. **Pool de agendamento por widget**: `scheduling_widget_members`, como já é hoje. Widgets diferentes distribuem para times diferentes, e isso é requisito.
4. **Pool de agendamento por WhatsApp**: `agent_tools.config.allowed_attendants` do agente de IA, com fallback para `crm_agent_calendars`. Inalterado.
5. **Responsável do card sempre vence o rodízio**, nos quatro caminhos. Se o contato já tem card com responsável e ele está elegível, ele atende. Fallback para o rodízio quando não está.
6. **Disponibilidade de chat vem da jornada de trabalho** (`crm_agent_calendars`), não de presença manual. `is_accepting_leads` vira a pausa manual.
7. **A fila passa a ser esvaziada** e visível.
8. **Desabilitados na UI, preservados no banco**: `skill_based`, `performance_based`, `category_based`, `require_approval`, `queue_timeout_minutes`, `skill_matching`. Ficam visíveis com indicação de "em breve".

## 3. Fora de escopo

- Implementar `skill_based` (não há modelagem de habilidades) e `performance_based` (não há métrica de resolução por atendente).
- Fluxo de aceite/recusa de lead pelo atendente (`require_approval`).
- Alerta de "lead esperando há muito tempo" — é notificação, não regra de roteamento; `queue_timeout_minutes` fica desabilitado.
- Rodízio atômico via RPC no banco (avaliado como abordagem C, adiado — ver §11).
- Alteração na lógica de cálculo de slots livres (`getMemberSlotForTime`, `getAgentSlots`, Google Calendar busy). Permanece exatamente como está.

## 4. Modelo de dados

### 4.1 `workspace_routing_config` — a fonte única

Uma linha por workspace (constraint `UNIQUE(workspace_id)` já existe). Colunas atuais preservadas, três novas:

| Coluna | Escopo | Situação após esta mudança |
|---|---|---|
| `strategy` | chat | passa a ser lido; só `least_loaded` e `round_robin` selecionáveis |
| `fallback_strategy` | chat | passa a ser lido |
| `max_leads_per_agent` | chat | já funciona (via `agent_availability`) |
| `category_matching` | chat | já funciona |
| `auto_assign` | chat | passa a ter efeito |
| `respect_card_owner` | **transversal** | **novo** — boolean NOT NULL DEFAULT true |
| `scheduling_strategy` | agendamento | **novo** — text NOT NULL DEFAULT `'least_loaded'`, CHECK em (`least_loaded`,`round_robin`) |
| `scheduling_load_window_days` | agendamento | **novo** — integer NOT NULL DEFAULT 30, CHECK > 0 |
| `require_approval` | chat | mantida, desabilitada na UI |
| `queue_timeout_minutes` | chat | mantida, desabilitada na UI |
| `skill_matching` | chat | mantida, desabilitada na UI |

O CHECK de `strategy` **não** é restringido: os valores `skill_based`/`performance_based`/`category_based` continuam válidos no banco (workspaces podem tê-los salvos), mas a UI os desabilita e o seletor de estratégia trata qualquer valor não implementado como `least_loaded` — comportamento explícito, com log, em vez do `default` silencioso de hoje.

### 4.2 `routing_config` — dropada

Criada em `20251212025724`, referencia `agent_instances`, nunca recebeu escrita. `DROP TABLE public.routing_config`.

### 4.3 `agent_availability` — duas colunas removidas

| Coluna | Destino |
|---|---|
| `status` | **dropada** — a disponibilidade passa a ser derivada da jornada |
| `current_leads_count` | **dropada** — a carga passa a ser derivada por query |
| `is_accepting_leads` | mantida — vira a pausa manual (o antigo "Ocupado") |
| `max_concurrent_leads` | mantida |
| `last_activity_at` | mantida — passa a ser o critério de ordenação do `round_robin` (§6, passo 4). **Escrita exclusivamente pelo roteamento** na atribuição; nenhum outro código deve tocá-la, ou o rodízio perde o sentido |

Remover as duas colunas é deliberado: enquanto existirem, haverá duas fontes de verdade e a próxima escrita esquecida reintroduz o defeito 2. A ausência de linha em `agent_availability` para um membro é tratada como "aceitando leads, teto padrão de `max_leads_per_agent`" — nenhum membro fica invisível por falta de cadastro.

### 4.4 `crm_agent_calendars` e `crm_holidays` — leitura nova, sem alteração

Ambas passam a ser lidas também pelo roteamento de chat, para determinar a jornada. Nenhuma coluna muda.

- `crm_agent_calendars` é por atendente: `work_days`, `work_start_time`, `work_end_time`, `timezone`. Membro sem linha cai no mesmo default que o agendamento já aplica (`schedule-widget/index.ts:648-654`): `09:00`–`18:00`, `MON`–`FRI`, `America/Sao_Paulo`.
- `crm_holidays` é por workspace (`date`, `name`). Já é respeitada pelos dois agendadores (`schedule-widget/index.ts:572-601`, `schedule-appointment/index.ts:250-259`) e **passa a valer para o chat** — sem isso, um lead que chega num feriado seria atribuído a alguém que não está trabalhando.

### 4.5 `scheduling_widget_members` — sem alteração

Segue sendo o pool por widget.

### 4.6 Trigger de encerramento de atendimento

Substitui `resolveLead.ts`. Em `leads`, `AFTER UPDATE OF status`:

```
quando NEW.status = 'closed' e OLD.status <> 'closed':
  UPDATE lead_queues SET status='completed', completed_at=now()
    WHERE lead_id = NEW.id AND status IN ('assigned','in_progress')
  UPDATE lead_queues SET status='cancelled', completed_at=now()
    WHERE lead_id = NEW.id AND status = 'waiting'
  UPDATE lead_assignments SET completed_at=now(), result=COALESCE(result,'resolved')
    WHERE lead_id = NEW.id AND completed_at IS NULL
```

A linha `waiting` é cancelada, não completada: o lead saiu da fila sem ser atendido por ela (fechado no Inbox, perdido, resolvido pela IA). Sem esse ramo, a fila acumularia entradas de leads já encerrados e o worker tentaria atribuí-los.

No banco, e não no frontend, para que o encerramento não dependa de a UI lembrar de chamar — que é exatamente como o defeito 8 nasceu.

## 5. Arquitetura

### 5.1 Módulo compartilhado `_shared/routing/`

Segue o padrão já estabelecido no projeto para helpers cross-function (`_shared/dnmarketing.ts`, `_shared/googleCredentials.ts`, `_shared/onGuestJoinedMeeting.ts`).

```
supabase/functions/_shared/routing/
  types.ts     RoutingConfig, Candidate, ChatAssignment
  config.ts    loadRoutingConfig(supabase, workspaceId) — com defaults; 1 query
  workhours.ts isWithinWorkingHours(calendar, holidays, at) — jornada + fuso + feriados + default
  load.ts      getChatLoad(...) / getSchedulingLoad(..., windowDays)
  owner.ts     getCardOwner(supabase, contactId) — responsável do card aberto
  select.ts    selectAssignee(candidates, { strategy, ownerId, loads })
  chat.ts      resolveChatAssignee(...) — orquestra pool + owner + estratégia
  assign.ts    assignChatLead(...) — persiste a atribuição: lead_queues (atualiza a
               linha waiting quando existe, em vez de inserir outra), lead_assignments,
               leads.assigned_to_user_id, last_activity_at e user_notifications.
               Usada pelo handoff e pelo worker — um único escritor.
```

Alternativas descartadas:

- **Edge function `routing-engine` dedicada (HTTP)**: fonte única também para o frontend, mas soma um hop de rede ao `schedule-widget`, que já encadeia contato → lead → agendamento → Daily → Google Calendar → e-mail → WhatsApp. Não compensa num caminho público sensível a latência.
- **RPC plpgsql**: daria rodízio atômico e serviria frontend e backend com uma implementação só, mas a disponibilidade de agenda depende de consultar o Google Calendar por HTTP, que o Postgres não faz. A metade mais complexa ficaria de fora. Adiada (§11).

### 5.2 Divisão de responsabilidade nos consumidores

O módulo decide **quem**; cada função continua dona do **quem é elegível**, porque essa parte depende de contexto que só ela tem (slots, Google Calendar, widget).

| Consumidor | Monta o pool | Decide |
|---|---|---|
| `orchestrator/routing-handler.ts` | `_shared/routing/chat.ts` (completo) | módulo |
| `schedule-appointment` | próprio (allowed_attendants → calendários → slots livres) | `selectAssignee` |
| `schedule-widget` | próprio (`scheduling_widget_members` → slots livres) | `selectAssignee` |
| `src/lib/routing/transferLead.ts` (frontend) | próprio, para ordenar sugestões | replica a regra de elegibilidade |

O frontend não importa código Deno. `transferLead` e o `TransferDialog` replicam a leitura de `workspace_routing_config` + jornada para **ordenar e rotular** sugestões. Isso é aceitável porque a transferência é uma escolha humana explícita — o frontend não decide por conta própria, só apresenta.

**O bloqueio `Target agent is not online` (`transferLead.ts:29-31`) é removido** — é a correção do defeito 5. Disponibilidade vira rótulo e ordenação no diálogo ("Fora do horário", "Pausado", "Sem capacidade"), nunca impedimento: quem transfere está escolhendo uma pessoa de propósito, e o sistema avisa em vez de recusar. Se a duplicação incomodar depois, o `api-gateway` já tem endpoint de `workspace_routing_config` (`index.ts:5471`) e pode expor a lista de elegíveis.

## 6. Fluxo de chat

Handoff IA→humano (`handleHandoff`) e ordenação da transferência manual.

1. **Pool**: membros do workspace (owner + `workspace_members` ativos) onde:
   - está dentro da jornada (`crm_agent_calendars`, com default) e a data não é feriado (`crm_holidays`);
   - `is_accepting_leads` (ausência de linha = `true`);
   - carga derivada `< max_concurrent_leads` (ausência de linha = `max_leads_per_agent` da config).
2. **Categoria**: se `category_matching` e há categoria detectada, filtra por `category_agent_assignments`. **Se o filtro zerar o pool, o filtro é ignorado** — comportamento atual (`routing-handler.ts:41-45`) e correto: melhor alguém fora da categoria que ninguém.
3. **Responsável do card**: se `respect_card_owner` e o contato tem card aberto cujo `assigned_to` está no pool → ele atende, sem rodízio.
4. **Estratégia**: `least_loaded` (menor carga derivada) ou `round_robin` (menor `agent_availability.last_activity_at`, escrito a cada atribuição — determinístico, em vez de depender da ordem do `select` como hoje; `NULL` ordena primeiro: quem nunca recebeu é o próximo da vez).
5. **Pool vazio** → `fallback_strategy`:
   - `queue` → entra em `lead_queues` como hoje;
   - `least_loaded` / `round_robin` → **atribui mesmo assim**: refaz o pool ignorando jornada e pausa (mantendo só o teto de capacidade) e aplica a estratégia — para operações que preferem um lead atribuído fora do horário a um lead esperando. Se nem assim houver candidato (todos no teto), cai na fila. Sem essa definição, "fallback = least_loaded" sobre um pool vazio não significaria nada — que é o estado atual do campo. *(semântica definida na revisão; ver nota no fim)*
6. **`auto_assign` desligado** → o lead vira `needs_human` e o time é notificado, sem atribuição. Quem pegar no Inbox, pega.

### 6.1 Carga derivada

```sql
SELECT assigned_to_user_id, count(DISTINCT lead_id)
FROM lead_queues
WHERE workspace_id = $1
  AND assigned_to_user_id = ANY($2)
  AND status IN ('assigned','in_progress')
GROUP BY assigned_to_user_id
```

`DISTINCT lead_id` porque o histórico pode ter mais de uma linha aberta por lead (handoffs repetidos antes do trigger de encerramento existir); um lead é uma unidade de carga, não uma linha.

PostgREST tem agregações desabilitadas nesta instância (`PGRST123`, ver CLAUDE.md), então a contagem sai de uma **RPC `stable` / `security invoker`** — `public.chat_load_by_user(workspace_id, user_ids[])`, uma linha por candidato. `security invoker` é deliberado: a mesma RPC serve o frontend (`TransferDialog`, card da página) sob as RLS de `lead_queues` e o service_role das edge functions. Contar no cliente seria possível pelo volume pequeno, mas repete a regra em três consumidores e reintroduz o risco de divergência que esta mudança existe para eliminar.

## 7. Fluxo de agendamento

Widget e WhatsApp compartilham tudo exceto o pool.

1. **Pool**: widget → `scheduling_widget_members` (`is_active`); WhatsApp → `allowed_attendants` do agente, fallback `crm_agent_calendars`.
2. **Elegibilidade**: quem tem slot livre no horário pedido — `crm_agent_calendars` + `crm_appointments` + Google Calendar busy. **Inalterado**, e continua sendo restrição dura. Disponibilidade de chat não entra aqui: um vendedor pausado no chat com agenda livre deve receber a reunião.
3. **Responsável do card**: se `respect_card_owner` e o dono tem slot → ele atende. O widget já faz (`index.ts:1774-1802`); o `schedule-appointment` passa a fazer.
4. **Estratégia**: `scheduling_strategy` sobre a carga da janela `scheduling_load_window_days`.
5. **Desempate**: ordem estável (`user_id` ascendente) no lugar do `Math.random()` do widget.

### 7.1 Correção da janela de carga

A contagem passa a incluir `completed` e `no_show`, unificada nos dois agendadores:

```
status IN ('scheduled','confirmed','completed','no_show')
start_time >= now() - scheduling_load_window_days
```

Reunião distribuída é carga, tenha acontecido ou não. Sem isso (defeito 6), quem atendeu no mês anterior é lido como ocioso e recebe mais.

## 8. Presença derivada da jornada

```
Dentro da jornada = hoje ∈ work_days (fuso do atendente)
                    E work_start_time <= agora < work_end_time
                    E hoje ∉ crm_holidays do workspace
                    ("hoje" sempre calculado no fuso do atendente,
                     inclusive para comparar com crm_holidays.date)

Disponível        = dentro da jornada
                    E is_accepting_leads
                    E carga derivada < max_concurrent_leads
```

O triplo estado atual (`online`/`busy`/`offline` + `is_accepting_leads`) colapsa em dois eixos: **a jornada diz quando**, `is_accepting_leads` é a pausa manual.

Essa é exatamente a mesma definição de jornada que os dois agendadores já aplicam — é o que permite dizer que "horário de trabalho" passa a significar uma coisa só no produto inteiro.

**O que a jornada não cobre hoje**, e fica registrado como limitação conhecida em vez de ser resolvido aqui:

- **Intervalo de almoço**: `crm_agent_calendars` tem um único par início/fim. Um atendente das 9h às 18h é considerado disponível ao meio-dia.
- **Ausência individual** (férias, folga, atestado): não existe tabela. `crm_holidays` é por workspace, não por pessoa. A saída manual é a pausa (`is_accepting_leads`), que o atendente ou o admin desliga.

Ambas afetam agendamento e chat da mesma forma, hoje e depois desta mudança — não são regressões introduzidas aqui.

`AgentAvailability.tsx` perde o seletor de status (`updateStatus`, linhas 186-215) e passa a mostrar a jornada vigente, o toggle de pausa e a lista de atendimentos.

## 9. Fila de espera

**Worker**: edge function `routing-queue-worker`, acionada por `pg_cron` a cada 5 minutos, versionada em migration — mesmo padrão do `flow-worker` (`20260813122000_crm_flows_worker_cron.sql`).

A cada execução, por workspace com leads em `lead_queues.status='waiting'`:
1. monta o pool de chat (§6);
2. percorre a fila por `priority` desc, depois `created_at` asc;
3. **revalida cada lead antes de atribuir**: se `leads.status` não é mais `needs_human` (alguém pegou no Inbox, a IA resolveu, o lead fechou), a linha vira `cancelled` e o worker segue — o trigger de §4.6 cobre o fechamento, mas não as outras transições;
4. atribui via `assignChatLead` (§5.1), que atualiza a própria linha `waiting`;
5. para quando o pool esgota.

Um cron único cobre os três eventos que liberam capacidade — atendente entra na jornada, despausa, ou encerra um atendimento — sem precisar de três triggers. A latência máxima de 5 minutos é aceitável e substitui a espera infinita de hoje.

`processWaitingQueue.ts`, `resolveLead.ts` e `routeLeadToAgent.ts` são removidos do frontend: o primeiro vira o worker, o segundo vira o trigger de §4.6, o terceiro é código morto substituído pelo módulo Deno.

## 10. UI — `/settings/routing`

Segue o Design System DN.IA V3 (`docs/DESIGN-SYSTEM-NEXUS.md`): `Pill` de `src/components/dn/` para estado, tokens semânticos, sem cor crua, ícones só `lucide-react`.

### 10.1 Card "Atendentes Humanos" — escopo chat

O card ganha um subtítulo explicitando que vale só para chat, e cada atendente mostra o estado com o motivo:

| Estado | Condição | Exibição |
|---|---|---|
| **Disponível** | jornada + aceitando + capacidade | `Pill` de sucesso |
| **Fora do horário** | fora da jornada | `Pill` neutro + a janela (`09:00–18:00`) |
| **Pausado** | dentro da jornada, `is_accepting_leads` off | `Pill` de atenção |
| **Sem capacidade** | no teto | `Pill` de atenção + `n/n` |

A barra de carga passa a usar a carga derivada. Quando **nenhum** atendente está disponível, o card exibe um aviso dizendo qual dos quatro motivos está barrando — o estado que hoje é permanente e silencioso (defeitos 2, 3).

### 10.2 Fila de espera

Bloco novo no card: contador de leads em `waiting`, lista com nome/telefone, tempo de espera e prioridade, e link para o Inbox. Vazio usa `EmptyState` de `src/components/dn/`.

### 10.3 Seção "Distribuição de agendamentos"

Nova, com `scheduling_strategy`, `scheduling_load_window_days` e um texto explicando que o **time** de cada widget é configurado em `/settings/scheduling-widgets` e o de WhatsApp no agente de IA — com links. A página governa as regras; o pool continua onde já é editado.

### 10.4 Campos desabilitados

`skill_based`, `performance_based`, `category_based`, `require_approval`, `queue_timeout_minutes` e `skill_matching` ficam visíveis, desabilitados, com rótulo "em breve". Não são removidos: sinalizam intenção sem prometer comportamento.

## 11. Migração e compatibilidade

Ordem das migrations:

1. `workspace_routing_config`: adicionar `respect_card_owner`, `scheduling_strategy`, `scheduling_load_window_days`.
2. Trigger de encerramento em `leads` (§4.6).
3. Backfill: fechar `lead_queues`/`lead_assignments` órfãos de leads já `closed` — sem isso, a carga derivada nasce inflada pelos registros que nunca foram encerrados.
4. `DROP TABLE routing_config`.
5. `ALTER TABLE agent_availability DROP COLUMN status, DROP COLUMN current_leads_count` — **depois** do deploy do código que parou de lê-las.
6. Cron do `routing-queue-worker`.

Nenhum backfill de configuração é necessário: `routing_config` está vazia, e as colunas novas têm default que reproduz o comportamento atual (`respect_card_owner=true` mantém o widget; `scheduling_load_window_days=30` mantém a janela do widget, e muda a do `schedule-appointment` de 7 para 30, o que é a unificação pretendida).

**Ordem de deploy**: passos 1–3 e o código dos consumidores primeiro; 4–6 depois. Como o Lovable faz build e deploy a cada push na `main` (trunk-based, sem branch de feature), os passos 5 e 6 vão num segundo push, depois de confirmar que o primeiro está no ar.

**Riscos:**

- **Corrida no rodízio.** Dois agendamentos simultâneos podem ler a mesma carga e escolher o mesmo responsável. O desempate estável não resolve isso — só o `Math.random()` mascarava, mal. A colisão é benigna (ambos têm slot livre, o segundo apenas desequilibra a distribuição), e a solução real é o RPC atômico da abordagem C. **Fica registrado como dívida conhecida, não resolvida nesta rodada.**
- **`agent_availability.status` some.** Qualquer consumidor não mapeado quebra. O levantamento encontrou quatro: `RoutingConfig.tsx`, `AgentAvailability.tsx`, `TransferDialog.tsx`, `transferLead.ts`. Confirmar com grep antes do passo 5.
- **`types.ts` é regenerado pelo Lovable** — não editar à mão (CLAUDE.md).
- **Triple sync do api-gateway** (CLAUDE.md): `GET/PUT /settings/routing` já expõe `workspace_routing_config` (`api-gateway/index.ts:5471-5484`) e o PUT repassa o body inteiro, então as colunas novas passam sem código novo — mas `public/openapi.yaml` e `scripts/test-api.ts` precisam refletir `respect_card_owner`, `scheduling_strategy` e `scheduling_load_window_days`.

## 12. Testes

O projeto não tem framework de teste; a convenção são scripts de fumaça (`scripts/test-api.ts`, `scripts/test-flows.ts`). Criar `scripts/test-routing.ts` no mesmo padrão, cobrindo:

1. jornada: dentro, fora, sem calendário (default), fuso não-BRT, data em `crm_holidays`;
2. pausa (`is_accepting_leads=false`) exclui do pool de chat e **não** exclui do agendamento;
3. teto de capacidade exclui, e volta a incluir após o trigger de encerramento;
4. `respect_card_owner`: dono elegível vence o rodízio; dono inelegível cai no rodízio;
5. carga derivada bate com `lead_queues` após atribuir e encerrar;
6. janela de agendamento conta `completed` (regressão do defeito 6);
7. fila: lead entra sem pool, sai quando o worker roda com pool disponível;
8. estratégia não implementada (`skill_based` salvo no banco) cai em `least_loaded` com log.

Ponto de atenção: não há service key disponível localmente (memória do projeto) — a validação end-to-end é feita por SQL no Lovable, como nas Fases do Fluxos v2.

## 13. Resumo das decisões

| Decisão | |
|---|---|
| Escopo | conversa + agendamento na mesma página |
| Arquitetura | módulo `_shared/routing/`, sem hop de rede |
| Pool de chat | membros do workspace, por jornada de trabalho |
| Pool de agendamento | time do widget; no WhatsApp, o time do agente de IA |
| Responsável do card | sempre vence o rodízio, nos quatro caminhos |
| Presença | derivada de `crm_agent_calendars` + `crm_holidays` + pausa manual |
| Carga | derivada por query |
| Fila | esvaziada por cron de 5 min, visível no card |
| Desabilitados | `skill_based`, `performance_based`, `category_based`, `require_approval`, `queue_timeout_minutes`, `skill_matching` |
| Dropados | tabela `routing_config`; colunas `agent_availability.status` e `.current_leads_count` |
| Dívida aceita | rodízio não-atômico (RPC fica para depois) |

---

**Nota da revisão de 2026-08-28**: a semântica do `fallback_strategy` para `least_loaded`/`round_robin` (§6, passo 5 — atribuir ignorando jornada e pausa quando o pool regular está vazio) foi definida nesta revisão, não no brainstorm. Se a operação preferir que fora do horário **sempre** vá para a fila, basta manter `fallback_strategy = 'queue'` (o default atual da página).
