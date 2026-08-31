# Análise de Atendimento por Playbook — Design

Data: 2026-08-05
Status: aprovado em brainstorm com o usuário

## Objetivo

Avaliar reuniões, demos e ligações (via transcrição) contra um playbook comercial da empresa, gerando:

- **Score 0–100** por atendimento (determinístico: soma ponderada calculada em código)
- **Feedback estruturado** para o vendedor: pontos fortes, pontos a ajustar, evidências citadas da transcrição
- **Memória de evolução**: pontos a melhorar são rastreados entre análises — ponto corrigido é celebrado; falha recorrente é alertada (sem alterar o score — indicador separado)
- **Gamificação individual** para o vendedor (conquistas, streaks — sem comparação entre colegas)
- **Gestão para admin**: visão da empresa, **ranking entre vendedores** e visão individual com orientação de coaching
- **Endpoint público de ranking** na API (`api-gateway`)

## Decisões tomadas (com o usuário)

| Tema | Decisão |
|---|---|
| Entidade central | "Análise" cadastrada pelo admin (ex.: "Apresentação", "Técnico") carrega o playbook. A subclassificação da reunião **é** a análise selecionada — sem classificação por IA |
| Tipos de atividade | Cada análise declara a quais tipos se aplica: `meeting`, `demo`, `phone_call` (ligações Api4com também têm transcrição) |
| Vinculação | Select manual na criação da atividade; default configurável por widget de agendamento e por workspace (reuniões criadas pelo agente no chat) |
| Atividade sem análise vinculada | Não é avaliada — segue o fluxo atual (`analyze-meeting` / `api4com-analyze-call`) |
| Playbook | Upload `.docx` na UI → conversão para **Markdown** (Heading1/2/3 → `#/##/###`, conteúdo canônico) → **admin aprova o MD** → IA extrai **rubrica estruturada** (rascunho) → **admin valida/edita** → ativação |
| Score | Puro: mede só a reunião. Recorrência **não** penaliza o score — vira alerta destacado (feedback do vendedor + painel do admin) |
| Recorrência | Escopo duplo: (a) critérios da rubrica, comparados dentro do mesmo tipo de análise; (b) hábitos comportamentais transversais em **vocabulário fixo** (catálogo em código), comparáveis entre todos os tipos |
| Gamificação | Vendedor: individual (conquistas, streaks, evolução própria). Admin: ranking entre vendedores é peça central |
| Convivência com análise atual | Com análise vinculada: um único job de IA gera resumo + avaliação; o **resumo** vai para `daily_recordings.ai_analysis` / `calls.ai_analysis` (UI atual intacta) e os dados ricos vão para modal dedicado. Sem análise: comportamento atual |
| Modelo IA | `google/gemini-3.1-pro-preview` como **default configurável** (padrão `workspace_meeting_settings.ai_model`). Via `_shared/geminiClient.ts` (`chatCompletionWithFallback`): chave Gemini da empresa → fallback Lovable AI Gateway. Se o gateway não aceitar 3.1, fallback rebaixa para `google/gemini-3-pro-preview` (ajuste no helper) |
| Visibilidade | Member vê só as próprias **análises** (`seller_id = auth.uid()`); admin/super_admin/owner veem todas. Já para **cards, atividades e reuniões** vale a regra do CRM: member **vê tudo** do workspace e **edita apenas** o que é seu (corrigido em `20260805190000`) |
| Localização UI | Área de análise: item no sidebar, seção **CRM**. Configuração: seção **EMPRESA** (`/settings/company`) |
| Diretrizes | Além do playbook: diretriz geral da empresa + diretriz por análise (texto livre incluído no prompt de avaliação) |

## Modelo de dados

### Novas tabelas — configuração (nível company)

**`analysis_playbooks`** — a entidade "Análise":
`id`, `company_id`, `name`, `description`, `activity_types text[]`, `playbook_md text`, `playbook_filename`, `guidelines text` (diretriz específica), `ai_model text` (default `google/gemini-3.1-pro-preview`), `status` (`draft`/`active`/`archived`), `created_by`, timestamps.

Diretriz **geral** da empresa: coluna `analysis_guidelines text` em `companies`.

**`analysis_rubric_versions`**:
`id`, `playbook_id`, `version int`, `status` (`draft`/`active`/`superseded`), `created_at`. Reenvio de playbook cria nova versão em rascunho; resultados antigos continuam apontando para a versão usada.

**`analysis_rubric_criteria`**:
`id`, `version_id`, `criterion_key` (slug estável entre versões — base do rastreio de recorrência), `stage` (etapa/agrupamento), `name`, `description`, `weight numeric`, `sort_order`, `is_active`.

### Nova tabela — resultados

**`activity_analysis_results`**:
`id`, `workspace_id`, `activity_id` → `crm_lead_activities`, `lead_id`, `seller_id` (o `assigned_to`), `source_type` (`daily_recording`/`call`), `source_id`, `playbook_id`, `rubric_version_id`, `score int` (0–100), `summary_md`, `criteria_results jsonb` (`[{criterion_key, verdict: met|partial|missed, evidence, feedback}]`), `strengths jsonb`, `improvements jsonb`, `habits jsonb`, `recurrences jsonb`, `corrected jsonb`, `model`, `status` (`processing`/`done`/`failed`), `error_message`, `created_at`.

### Novas tabelas — memória e gamificação do vendedor

**`seller_development_points`** — estado vivo por vendedor:
`id`, `company_id`, `seller_id`, `point_type` (`criterion`/`habit`), `point_key`, `playbook_id` (null para hábitos transversais), `status` (`open`/`recurrent`/`corrected`), `occurrences int`, `first_seen_at`, `last_seen_at`, `corrected_at`.

**`seller_achievements`**:
`id`, `company_id`, `seller_id`, `achievement_key`, `earned_at`, `meta jsonb`. Catálogo de conquistas definido em código.

**`seller_coaching_briefs`** — orientação de gestão cacheada:
`id`, `company_id`, `seller_id`, `brief_md`, `generated_at`, `generated_by`. Regenerada sob demanda (botão do admin).

### Alterações em tabelas existentes

- `crm_lead_activities.analysis_playbook_id` (nullable, FK → `analysis_playbooks`)
- `scheduling_widgets.analysis_playbook_id` (default do widget)
- `workspace_meeting_settings.default_analysis_playbook_id` (default para reuniões criadas pelo agente)
- `companies.analysis_guidelines text`

### RLS

Convenção do projeto: toda policy inclui `has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin')`.

| Tabela | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `analysis_playbooks`, `analysis_rubric_versions`, `analysis_rubric_criteria` | super_admin, admin, ou membro ativo de workspace da company (necessário para popular selects) | só super_admin/admin |
| `activity_analysis_results` | super_admin, admin, workspace owner, ou `seller_id = auth.uid()` (padrão `crm_leads`) | só service role (edge functions) |
| `seller_development_points`, `seller_achievements`, `seller_coaching_briefs` | idem acima | só service role |

**Regra de acesso do CRM** (corrigida em 2026-08-05, migration `20260805190000`): para `crm_leads`, `crm_lead_activities`, `crm_appointments` e `daily_recordings`, member **vê todos** os registros do workspace e **edita apenas** aqueles em que é `assigned_to`/`created_by`; admin, super_admin e dono do workspace veem e editam tudo.

A migration `20260805100002` havia restringido a *leitura* de `crm_appointments`/`daily_recordings` — restrição no lugar errado, revertida. O recorte por vendedor vale só para os **resultados de avaliação** (`activity_analysis_results`, `seller_development_points`, `seller_achievements`), onde comparar desempenho entre vendedores é matéria de gestão.

## Pipelines

### Pipeline A — Playbook (config, roda raramente)

1. Admin cria a Análise em EMPRESA → "Análises de Atendimento" (nome, descrição, tipos de atividade)
2. Upload `.docx` → edge function **`playbook-ingest`**: unzip OOXML (técnica do `parse-document`), `Heading1/2/3` → `#/##/###`, grava `playbook_md`
3. Admin revisa/edita e **aprova o Markdown**
4. Edge function **`playbook-extract-rubric`**: Gemini Pro lê o MD e propõe rubrica (critérios por etapa, pesos sugeridos, `criterion_key` estável) → `analysis_rubric_versions` em `draft`
5. Admin edita critérios e **ativa** → versão `active`, análise `active`

### Pipeline B — Avaliação (roda a cada transcrição)

1. Transcrição pronta: `process-daily-recording` (reunião/demo) ou fluxo Api4com (ligação)
2. Resolve a atividade vinculada:
   - Sem `analysis_playbook_id` → fluxo atual (`analyze-meeting` / `api4com-analyze-call`)
   - Com → edge function **`analyze-transcript-playbook`**:
     1. Carrega transcrição, rubrica ativa, diretrizes (geral + da análise), pontos abertos do vendedor (`seller_development_points`)
     2. **1 chamada** Gemini Pro, saída JSON estruturada: veredicto por critério (`met`/`partial`/`missed` + evidência + feedback), hábitos (vocabulário fixo), pontos fortes, resumo
     3. **Score em código**: soma ponderada dos veredictos × pesos (met=1, partial=0.5, missed=0), normalizada 0–100
     4. Recorrência/correção em código, comparando com pontos abertos → atualiza `seller_development_points`; avalia conquistas → `seller_achievements`
     5. Grava `activity_analysis_results`; resumo em `daily_recordings.ai_analysis` ou `calls.ai_analysis`; notifica o vendedor via `user_notifications` (padrão `NotificationBell`)
3. Reprocessamento manual: botão "Reanalisar" (padrão atual)

## UI

### Sidebar CRM → "Desempenho" (`/crm/performance`)

- **Member**: dashboard pessoal — score médio do período, gráfico de evolução por dia (recharts), últimas análises (clique → modal rico), blocos **em aberto** / **corrigidos** / **recorrentes**, conquistas + streak. Filtros por período e análise (`usePersistedFilters`).
- **Admin/super_admin**: três abas:
  - **Visão geral**: score médio da empresa, tendência, distribuição por análise, volume analisado
  - **Ranking**: vendedores por score médio (filtros: período, análise, workspace; nº de reuniões, tendência, recorrências ativas)
  - **Individual**: seleciona membro → dashboard dele + orientação de gestão (fortes/fracos agregados, recorrências ativas, brief de coaching IA sob demanda, cacheado)

### EMPRESA (`/settings/company`) → card "Análises de Atendimento"

Lista + fluxo em etapas: dados → upload .docx → aprovação do MD → editor da rubrica → ativação. Campo de diretriz da análise; diretriz geral da empresa no mesmo card.

### Modal rico

Aberto das Atividades do Lead e do painel Desempenho: score em destaque, quebra por etapa/critério com veredicto e evidência citada, fortes/ajustes, hábitos, badges "recorrente"/"corrigido". Design System: tokens semânticos, sem emoji, pt-BR.

### Pontos de seleção

Select "Análise" (filtrado por tipo de atividade) no diálogo de atividade; no cadastro do widget; default nas configurações do workspace (agente/chat).

## API pública

**`GET /crm/performance/ranking`** no `api-gateway`: params `period`, `analysis_id`, paginação padrão (`page`/`per_page`). Retorna ranking com score médio, nº de análises, tendência. Permissão: grupo `crm`. **Triple sync**: (1) `api-gateway/index.ts`, (2) `scripts/test-api.ts`, (3) `public/openapi.yaml` (+ `openapi.json`).

## Validação e deploy

- `npm run lint` + `tsc --noEmit --strict` (Vite não checa tipos)
- Endpoint testado via `scripts/test-api.ts`
- Edge functions e migrations **não deployam automaticamente** — entregar prompt de deploy para o Lovable ao final (com hash do commit)

## Fora de escopo (YAGNI)

- Classificação de tipo de reunião por IA
- Ranking visível para members / comparação entre colegas na visão do vendedor
- Penalização de score por recorrência
- Editor WYSIWYG do playbook (MD simples)
- Análise retroativa em massa de gravações antigas (pode ser feita manualmente pelo botão "Reanalisar")
