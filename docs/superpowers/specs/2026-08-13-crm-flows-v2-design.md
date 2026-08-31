# Fluxos de CRM (Réguas v2) — Design

**Data**: 2026-08-13
**Status**: aprovado em brainstorm, aguardando plano de implementação
**Rota da v1**: `/crm/settings/cadences?tab=stage` (permanece intocada)
**Rotas da v2**: `/crm/settings/flows` (lista) e `/crm/settings/flows/:id` (builder)

## 1. Contexto e objetivo

As réguas por etapa da v1 (`cadence_rules` + `cadence_templates` + `cadence_scheduled_messages` + `cadence-dispatcher`) têm defeitos estruturais documentados na análise de 2026-08-13: pausar não interrompe mensagens já agendadas, falhas viram `skipped` e somem das estatísticas, mensagens fora da janela de envio são descartadas, não há estado por lead. A v2 substitui esse modelo por um motor de fluxos com máquina de estados por lead, builder visual e novos blocos (condição, e-mail WYSIWYG, ação de fechamento) — inspirado no motor de journeys do projeto ai-fastlane (`journeys` / `journey_runs` / `journey_step_log` / `journey-worker`), que já resolveu concorrência, pausa e reentrada em produção.

### Decisões de produto (fixadas no brainstorm)

1. **Funcionalidade nova, convivendo com a v1.** Nada da v1 é alterado. Migração das réguas existentes e desativação da v1 acontecem numa fase futura, após validação da v2.
2. **Saída da etapa é configurável por fluxo**: `exit_on_stage_change` (padrão `true`, comportamento da v1).
3. **Bloco WhatsApp com paridade total com a v1** (mídia, agente IA, reescrita por IA, período do dia, variáveis) **mais áudio** (upload MP3/OGG, enviado como mensagem de voz).
4. **Um fluxo ativo por etapa** (como a v1).
5. **Reentrada configurável por fluxo**: `once` (uma vez por lead) ou `allowed` com cooldown em horas.

### Fora de escopo desta v2

- Gatilhos que não sejam entrada em etapa (atividade, tag, evento de mensagem). A estrutura permite (`stage_id` pode virar `entry_type`/`entry_config` no futuro), mas não nasce agora.
- Vários fluxos por etapa, testes A/B, ramificação por evento de e-mail (abriu/clicou).
- Migração automática das réguas v1 (fase 5, spec próprio).
- Aba Atividade das réguas (permanece v1).

## 2. Modelo de dados

Três tabelas novas. Nenhuma tabela da v1 é alterada.

### 2.1 `crm_flows`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid NOT NULL → workspaces | Fluxo pertence ao workspace (corrige o escopo misto da v1) |
| `company_id` | uuid NOT NULL → companies | Desnormalizado para RLS e janela de envio |
| `stage_id` | uuid NOT NULL → crm_pipeline_stages ON DELETE CASCADE | Gatilho |
| `name` | text NOT NULL | |
| `status` | text | `draft` / `active` / `paused` / `archived` (default `draft`) |
| `exit_on_stage_change` | boolean NOT NULL DEFAULT true | Decisão 2 |
| `reentry` | text | `once` / `allowed` (default `once`) |
| `reentry_cooldown_hours` | integer NOT NULL DEFAULT 168, CHECK > 0 | Só usado com `allowed` |
| `entry_node_id` | text | id do primeiro nó |
| `nodes` | jsonb NOT NULL DEFAULT '[]' | O grafo |
| `created_by`, `created_at`, `updated_at` | | |

- Índice único parcial: `UNIQUE (workspace_id, stage_id) WHERE status = 'active'` — um fluxo **ativo** por etapa; rascunhos/pausados da mesma etapa são permitidos.
- **Validação do grafo por trigger** em INSERT/UPDATE (porte do `validate_journey_graph` do ai-fastlane): ids únicos, `entry_node_id` e todos os ponteiros `next`/`next_false` apontam para nós existentes, config obrigatória por tipo (ver §4), **detecção de ciclo**. A UI valida por conveniência; o banco é a fronteira.

Formato do nó no JSONB:

```jsonc
{
  "id": "n1a2b3c",          // gerado no cliente
  "type": "delay",           // delay | branch | send_whatsapp | send_email | close_lead
  "config": { /* por tipo, ver §4 */ },
  "next": "n4d5e6f",        // próximo nó (null = fim do fluxo)
  "next_false": null         // apenas branch: ramo "Não"
}
```

### 2.2 `crm_flow_runs`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `flow_id` | uuid NOT NULL → crm_flows ON DELETE CASCADE | |
| `lead_id` | uuid NOT NULL → crm_leads ON DELETE CASCADE | |
| `workspace_id` | uuid NOT NULL | Desnormalizado p/ RLS |
| `current_node_id` | text | |
| `state` | text NOT NULL DEFAULT 'active' | `active` / `waiting` / `done` / `failed` / `exited` |
| `wakeup_at` | timestamptz NOT NULL DEFAULT now() | NOT NULL: run sem wakeup nunca seria colhido |
| `exit_reason` | text | `stage_change` / `won` / `lost` / `opted_out` / `flow_archived` / `node_deleted` — preenchido quando `state` termina |
| `context` | jsonb NOT NULL DEFAULT '{}' | retentativas do nó atual, etc. |
| `lock_token` | uuid | fencing token |
| `locked_until` | timestamptz | lease |
| `entered_at` | timestamptz NOT NULL DEFAULT now() | base da condição "respondeu desde a entrada" |
| `updated_at` | timestamptz | |

- Índice único parcial: `UNIQUE (flow_id, lead_id) WHERE state IN ('active','waiting')` — no máximo um run aberto por (fluxo, lead); elimina corrida entre inscrição por trigger e reentrada.
- Índices: `(wakeup_at) WHERE state IN ('active','waiting')` (claim); `(flow_id, state)`; `(lead_id) WHERE state IN ('active','waiting')` (encerramentos por trigger).

### 2.3 `crm_flow_step_log`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `run_id` | uuid NOT NULL → crm_flow_runs ON DELETE CASCADE | |
| `flow_id` | uuid NOT NULL → crm_flows ON DELETE CASCADE | |
| `lead_id` | uuid → crm_leads ON DELETE SET NULL | |
| `node_id` | text NOT NULL | |
| `node_type` | text NOT NULL | |
| `result` | text NOT NULL | `entered` / `sent` / `skipped` / `branch_true` / `branch_false` / `failed` / `rescheduled` |
| `detail` | jsonb DEFAULT '{}' | erro, motivo do skip, message_id gerado, etc. |
| `occurred_at` | timestamptz NOT NULL DEFAULT now() | |

- Índice `(flow_id, node_id, result)` — métricas por nó do builder.
- Fonte única das estatísticas. Substitui o papel de `CadenceStatsDialog`/`CadenceOverviewDialog` na v2.

### 2.4 RLS

- `crm_flows`: SELECT para membros do workspace (+ admins/super_admin da empresa, convenção do CLAUDE.md); INSERT/UPDATE/DELETE para owner/admin/super_admin.
- `crm_flow_runs` e `crm_flow_step_log`: SELECT para membros; escrita **somente** `service_role` (worker e triggers SECURITY DEFINER).

### 2.5 O que deliberadamente não existe

- **Tabela de mensagens agendadas.** O agendamento é o próprio run parado com `wakeup_at` futuro. Editar o conteúdo de um nó vale imediatamente para todos os runs que ainda não passaram por ele — sem dessincronização fila×template (problema 8 da v1).
- **Snapshot do grafo por run.** O run executa sempre a versão salva atual do fluxo (mesma decisão do ai-fastlane). A UI protege edições destrutivas em fluxo ativo (ver §5.3).

## 3. Motor de execução

### 3.1 Inscrição e saída (triggers no banco)

Trigger novo em `crm_leads`, separado e independente do `trg_lead_stage_cadence_sync` da v1:

- **AFTER INSERT OR UPDATE OF `stage_id`**:
  1. Encerra runs abertos do lead cujos fluxos tenham `exit_on_stage_change = true` e `stage_id` ≠ nova etapa → `state='exited'`, `exit_reason='stage_change'`.
  2. Se a nova etapa tem fluxo `active` no workspace do lead: cria run (`current_node_id = entry_node_id`, `wakeup_at = now()`), respeitando:
     - `reentry='once'`: não cria se já existe **qualquer** run desse (flow, lead), aberto ou terminado.
     - `reentry='allowed'`: não cria se existe run aberto, nem se o último run terminado tem `updated_at > now() - reentry_cooldown_hours`.
- **AFTER UPDATE OF `status`**: `won`/`lost` encerra todos os runs abertos do lead (`exit_reason = 'won'|'lost'`).

Opt-out do contato: verificado no momento de cada envio (encerra o run com `exit_reason='opted_out'`), não por trigger — o campo vive em `crm_contacts` e o custo de um trigger lá não compensa.

### 3.2 Ciclo do worker

`flow-worker` (edge function Deno) disparado por pg_cron **a cada minuto, registrado em migration** (a v1 não versionava o cron — problema 9).

1. `flow_claim_due_runs(p_limit=50, p_lease_seconds=300)` — RPC SECURITY DEFINER, porte do `journey_claim_due_runs`: seleciona runs `active|waiting` com `wakeup_at <= now()` e lease expirado, de fluxos `status='active'`, com `FOR UPDATE SKIP LOCKED`; carimba `lock_token` novo e `locked_until`. **Fluxo pausado congela runs** (não são colhidos); despausar retoma naturalmente.
2. Para cada run, executa nós em sequência (loop interno) até: espera futura (`state='waiting'`, `wakeup_at` = alvo), fim (`next=null` → `done`), encerramento (`close_lead`, opt-out) ou **cap de 20 nós por tick** (defesa em profundidade além da validação de ciclo; run é reagendado para `now()` e continua no próximo tick).
3. Toda escrita do worker carrega `.eq('lock_token', token)` — worker com lease expirado não sobrescreve quem assumiu.
4. Cada nó executado gera linha em `crm_flow_step_log`.

### 3.3 Janela de envio e período do dia

Antes de executar `send_whatsapp`/`send_email`, o worker verifica `company_sending_window` e o `day_period` do nó. Fora da janela → **reagenda o run para o próximo horário válido** (cálculo direto do próximo slot: próximo dia útil da janela + início do período), registra `rescheduled` no log. Nada é descartado (resolve o problema 3 da v1).

### 3.4 Falhas de envio e retentativas

- Falha transitória (Z-API/Resend erro HTTP, timeout): retentativa com backoff — 5 min, 15 min, 1 h (máx. 3 tentativas, contador em `runs.context`). Esgotadas: nó marcado `failed` no log **e o run continua para o `next`** — uma mensagem perdida não mata a sequência. A falha fica visível nas métricas do nó (resolve o problema 2).
- Conexão Z-API inexistente/desconectada/inadimplente: reagenda +15 min por até 24 h contadas do primeiro alvo; depois `failed` no log e segue (mantém a lógica atual do dispatcher).
- Lead sem telefone (WhatsApp) ou sem e-mail (e-mail): `skipped` no log com motivo, segue para o `next`.
- Resend não configurada para a empresa: `failed` com mensagem clara no `detail`.

### 3.5 Ordem das operações no envio WhatsApp

Igual ao dispatcher atual (comprovadamente correta): validações (telefone → conexão → saúde → janela) → **só então** reescrita por IA (resolve o problema 7) → INSERT em `messages` com `delivery_status='sending'` (suprime o trigger de envio assíncrono) → `zapi-send` síncrono → grava `external_message_id` + `delivery_status='sent'` → reatribuição do agente IA se configurada. O `message_id` gerado vai no `detail` do log (rastreio de entrega).

### 3.6 Edição de fluxo ativo

- Editar config de nó: vale para execuções futuras imediatamente.
- Excluir nó com runs parados nele: runs são movidos para o `next` do nó excluído (`wakeup_at=now()`); se não houver `next`, encerram com `exit_reason='node_deleted'`. A UI avisa antes de salvar (§5.3).

## 4. Blocos (tipos de nó)

### 4.1 `delay` — Espera

`config: { minutes: number }` (mín. 1). A UI expõe dias/horas/minutos e converte. Jitter de ±3 min aplicado no reagendamento quando a espera ≥ 60 min (anti-ban, herdado da v1).

### 4.2 `branch` — Condição (saídas Sim/Não)

`config: { logic: 'and'|'or', rules: [{ field, operator, value }] }` (mín. 1 regra). Avaliada **no momento em que o run chega ao nó** — dados frescos, nunca do momento da inscrição.

Campos disponíveis (o worker resolve cada um com queries dedicadas):

| Grupo | Campo | Fonte | Operadores |
|---|---|---|---|
| Card | valor | `crm_leads.value` | =, ≠, >, <, vazio/preenchido |
| Card | produto | `crm_leads.product_id` | =, ≠, vazio/preenchido |
| Card | segmento | `crm_leads.segment_id` | =, ≠, vazio/preenchido |
| Card | atendente | `crm_leads.assigned_to` | =, ≠, vazio/preenchido |
| Card | status | `crm_leads.status` | =, ≠ |
| Card | tempo na etapa (dias) | `now() - crm_leads.moved_at` | >, < |
| Card | idade do lead (dias) | `now() - crm_leads.created_at` | >, < |
| Card | canal | `crm_leads.utm_source` | =, ≠, contém, vazio/preenchido |
| Card | campanha / medium / content / term | `crm_leads.utm_*` | =, ≠, contém, vazio/preenchido |
| Contato | origem | `crm_contacts.source` | =, ≠ |
| Contato | empresa | `crm_contacts.company` | =, ≠, contém, vazio/preenchido |
| Contato | tem telefone / tem e-mail | `crm_contacts.phone/email` | preenchido/vazio |
| Contato | tags | `crm_contacts.tags` (JSONB) | contém / não contém |
| DNIA | propensity / risk / opportunity score | `crm_lead_psychology` | >, <, vazio/preenchido |
| Catálogo | dor | `crm_lead_pains` | contém / não contém |
| Catálogo | objeção | `crm_lead_objections` | contém / não contém |
| Engajamento | respondeu desde a entrada no fluxo | última `messages` inbound do lead do inbox vinculado > `runs.entered_at` | sim/não |

Regra sem dado (ex.: lead sem registro em `crm_lead_psychology`) avalia como **falso** (vai pro ramo Não), nunca erro.

### 4.3 `send_whatsapp` — Mensagem WhatsApp

```jsonc
config: {
  content: string,               // variáveis: {nome_lead} {primeiro_nome} {empresa} {atendente}
  media_url: string | null,      // bucket widget-assets, pasta cadence/{company_id}/
  media_type: 'image'|'video'|'audio'|null,  // imagem ≤5MB; vídeo MP4 ≤16MB; áudio MP3/OGG ≤16MB
  audio_duration: number | null, // segundos, capturado no upload (para delayTyping do zapi-send)
  day_period: 'manha'|'tarde'|'noite'|'qualquer',
  agent_id: string | null,       // assume o chat após envio
  agent_source: 'agents'|'agent_instances'|null,
  ai_rewrite_enabled: boolean
}
```

Áudio usa o caminho já existente do `zapi-send` (`media_type:'audio'` → endpoint `/send-audio` da Z-API, `waveform:true`, `delayTyping` proporcional à duração) — mesmo mecanismo do chat ao vivo. O envio segue §3.5. Restrição da v1 mantida: agente IA deve pertencer ao workspace do lead; na v2 o select da UI **só lista agentes do workspace do fluxo** (a v1 listava de toda a empresa e falhava em silêncio).

### 4.4 `send_email` — E-mail

`config: { subject: string, from_name: string | null, html: string }` — todas as partes aceitam as variáveis. `html` é produzido pelo editor WYSIWYG (§5.4). Envio via Resend da empresa (`resendCredentials.ts`, `resolveFromAddress`); registro no chat do inbox como log (`media_type='email'`), igual ao dispatcher atual.

### 4.5 `close_lead` — Fechar lead (terminal)

`config: { outcome: 'won'|'lost', loss_reason_id: string | null }` — `loss_reason_id` obrigatório quando `lost` (validado no banco), da lista `crm_loss_reasons` do workspace. Executa exatamente o que o pipeline faz: `UPDATE crm_leads SET status, closed_at, loss_reason_id` — disparando os efeitos existentes (histórico, dn.marketing via caminhos atuais). O trigger de `status` (§3.1) encerra o run (`exit_reason = outcome`). Nó terminal: `next` sempre null (validado no banco).

### 4.6 Fim implícito

Run chega a `next=null` → `state='done'`. Não há bloco visual de fim.

## 5. UI

### 5.1 Lista — `/crm/settings/flows`

Tabela: nome, etapa-gatilho, status (badge), leads com run aberto agora, atualizado em, ações (abrir, duplicar, arquivar). "Novo fluxo": diálogo nome + etapa (etapas sem fluxo ativo). Entrada no menu lateral do CRM junto de Réguas. Aviso na etapa que tiver régua v1 **e** fluxo v2 ativos: recomendar desativar a régua v1 daquela etapa (durante a convivência os dois motores disparariam).

### 5.2 Builder — `/crm/settings/flows/:id`

Porte do layout do `JourneyBuilder` do ai-fastlane, adaptado ao design system do Nexus (glass-card, tokens semânticos, fontes do projeto, sem emojis):

- Card de entrada no topo: etapa, reentrada (+cooldown em dias na UI), `exit_on_stage_change`. Editável em diálogo próprio.
- Coluna vertical de cards de nó; botão "+" entre passos abre menu com os 5 blocos; `branch` renderiza em duas colunas "Sim"/"Não" (render recursivo, referência "→ continua em..." para reconvergência).
- Card de nó: ícone do tipo, resumo da config, métricas quando ativo (§5.5), ações editar/excluir.
- Cabeçalho: Salvar / Ativar / Pausar / Arquivar.

### 5.3 Guardas de edição (portadas do ai-fastlane)

- `dirty` bloqueia **Ativar** com alterações não salvas (ativar ativaria o grafo salvo, não o da tela).
- Excluir nó que deixaria passos órfãos: AlertDialog lista o que será removido junto.
- Salvar fluxo **ativo** com nós excluídos: AlertDialog avisa que runs parados nesses nós serão movidos adiante (§3.6).
- Ativar: AlertDialog informa que leads que **entrarem** na etapa a partir de agora serão inscritos (a ativação não inscreve retroativamente quem já está na etapa — mesmo comportamento da v1).
- Erro de validação do banco no salvamento é exibido ao usuário tal como veio (nunca mascarado).
- Excluir régua/fluxo usa AlertDialog do design system (não `confirm()` nativo).

### 5.4 Editor WYSIWYG (e-mail)

**TipTap** (`@tiptap/react` + `@tiptap/starter-kit` + extensões Link e Image) — dependência nova (~100 kB), carregada lazy apenas no builder. Toolbar enxuta: negrito, itálico, título, lista, link, imagem (URL — upload no bucket `widget-assets` reutilizando o fluxo de mídia), botão de variáveis. Saída: HTML inline-friendly para e-mail. Preview do e-mail renderizado em diálogo (ação "olho" no card do nó).

### 5.5 Observabilidade na UI

- Métricas por nó nos cards do builder (de `crm_flow_step_log`, agregadas por `(node_id, result)`): passaram / enviados / falhas / pulados; polling de 60 s enquanto ativo.
- Drawer "Leads no fluxo": runs do fluxo (lead, nó atual, estado, `wakeup_at`, `exit_reason`), com link para o card do lead. Substitui `CadenceStatsDialog`/`CadenceOverviewDialog` nesta versão.

## 6. Testes e validação

Sem framework de testes no projeto — a verificação é por script + checklist.

**`scripts/test-flows.ts`** (padrão do `test-api.ts`), contra um workspace de teste:
1. Validação do grafo: fluxo com ciclo → rejeitado; ponteiro quebrado → rejeitado; `close_lead` com `next` → rejeitado; `lost` sem `loss_reason_id` → rejeitado; grafo válido → aceito.
2. Unicidade: segundo fluxo ativo na mesma etapa → rejeitado.
3. Inscrição: mover lead para a etapa → run criado; `reentry='once'` não recria; cooldown respeitado/expirado.
4. Saída: mover lead para outra etapa → `exited/stage_change` (com `exit_on_stage_change=true`) e run intacto (com `false`); marcar `won` → run encerrado.
5. Pausa: fluxo pausado → claim não retorna o run; reativado → retorna.
6. Claim concorrente: duas chamadas simultâneas nunca devolvem o mesmo run.

**Checklist manual** (dependências externas reais): envio de texto/imagem/vídeo/**áudio** via Z-API; reescrita por IA; reatribuição de agente; e-mail WYSIWYG renderizado (Gmail/Outlook); janela de envio reagendando; retentativa após queda de conexão; `close_lead` disparando efeitos do pipeline.

## 7. Fases de entrega

Cada fase vai para `main` (push → prompt para o editor Lovable, deploy não é automático) e funciona sozinha:

1. **Motor** — migrations (tabelas, validação, triggers, RPCs, cron do worker) + `flow-worker`. Invisível ao usuário; validado pelo script.
2. **Builder** — lista + builder + nós `delay`/`branch`/`send_whatsapp`/`close_lead`. Fluxo completo criável e ativável (sem e-mail).
3. **E-mail** — TipTap + nó `send_email` + preview.
4. **Observabilidade** — métricas por nó + drawer "Leads no fluxo".
5. **(Futuro, spec próprio)** — migração assistida das réguas v1 → fluxos e desativação da v1.

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Etapa com régua v1 e fluxo v2 ativos dispara os dois | Aviso na lista/builder recomendando desativar a régua v1 daquela etapa |
| Lovable duplica migrations | Nomes/timestamps no padrão do projeto; conferir no editor após o push |
| TipTap aumenta o bundle | Lazy import só na rota do builder |
| Worker excede tempo da edge function em lote grande | Lote de 50 runs + cap de 20 nós/run/tick; reescrita por IA só após validações |
| Trigger novo em `crm_leads` adiciona latência ao mover card | Trigger só faz SELECT do fluxo ativo (indexado) + INSERT/UPDATE pontuais; sem chamadas HTTP |
| Dois workers concorrentes | `FOR UPDATE SKIP LOCKED` + lease + fencing token em toda escrita |

## 9. Defeitos da v1 endereçados

| # | Defeito v1 | Resolução v2 |
|---|---|---|
| 1 | Desativar régua não para o agendado | Pausa congela runs no claim; arquivar encerra com `exit_reason` |
| 2 | Falha vira `skipped` invisível | Retentativa com backoff; `failed` visível nas métricas |
| 3 | Fora da janela = descartada | Reagendamento para o próximo horário válido |
| 4 | Escopo company×workspace misto | `crm_flows.workspace_id`; agentes filtrados por workspace |
| 5 | Erros de escrita silenciosos na UI | Toasts com o erro real; AlertDialog do design system |
| 6 | Ordem visual ≠ ordem de envio | O grafo é a ordem de execução |
| 7 | Reescrita IA antes das validações | Reescrita após todas as validações |
| 8 | Fila×template dessincronizados | Sem fila de mensagens; run + grafo são a verdade |
| 9 | Cron não versionado | pg_cron do worker em migration |
| 10 | Lead do inbox `ai_talking` sem agente | Status definido conforme agente configurado ou não |
