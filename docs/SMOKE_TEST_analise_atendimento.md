# Smoke test — Análise de Atendimento por Playbook

Roteiro de validação da feature em produção, na ordem em que as peças dependem
umas das outras. Cada etapa traz **o que fazer**, **o que esperar** e **como
diagnosticar** se falhar.

Spec: `docs/superpowers/specs/2026-08-05-analise-atendimento-playbook-design.md`
Commit: `0681c60a`

---

## Pré-requisitos

Antes de começar, confirme no Lovable:

- [ ] As 3 migrations `20260805100000/01/02` foram aplicadas
- [ ] Deploy das functions novas: `playbook-ingest`, `playbook-extract-rubric`, `analyze-transcript-playbook`
- [ ] Redeploy das alteradas: `process-daily-recording`, `api4com-transcribe`, `schedule-widget`, `schedule-appointment`, `api-gateway`
- [ ] Frontend publicado (Share → Publish)
- [ ] Você está logado como **owner/admin** da empresa

> O redeploy das functions alteradas é obrigatório: elas passaram a importar de
> `supabase/functions/_shared/`, e cada function carrega sua própria cópia do
> bundle compartilhado.

**Verificação rápida (SQL Editor do Supabase):**

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'analysis_playbooks','analysis_rubric_versions','analysis_rubric_criteria',
    'activity_analysis_results','seller_development_points',
    'seller_achievements','seller_coaching_briefs'
  )
order by table_name;
-- Esperado: 7 linhas
```

```sql
select column_name, table_name
from information_schema.columns
where table_schema = 'public'
  and column_name in ('analysis_playbook_id','default_analysis_playbook_id','analysis_guidelines')
order by table_name;
-- Esperado: companies.analysis_guidelines, crm_appointments.analysis_playbook_id,
-- crm_lead_activities.analysis_playbook_id, scheduling_widgets.analysis_playbook_id,
-- workspace_meeting_settings.default_analysis_playbook_id
```

---

## 1. Cadastro da análise

**Fazer:** `/settings/company` → role até o card **Análises de Atendimento** →
*Nova análise*. Nome "Apresentação comercial", marque **Reunião** e **Demonstração**.

**Esperar:** a análise aparece na lista com badge *Rascunho* e o diálogo de
configuração abre automaticamente.

**Se falhar:** erro de permissão indica RLS — confirme que seu usuário é
owner/admin da empresa (`select * from company_members where user_id = auth.uid()`).

---

## 2. Upload do playbook

**Fazer:** no diálogo, aba **Playbook** → *Enviar .docx* → selecione
`docs/Playbook Comercial dn.ia.docx` (ou outro playbook real).

**Esperar:** toast "Playbook convertido" informando o número de seções, e o
Markdown preenchido no campo abaixo. Com o playbook da dn.ia: **~103 mil
caracteres e 371 seções**.

**Conferir a fidelidade:** o Markdown deve preservar a hierarquia —
`# CAPÍTULO 01`, `## Critério de Homologação`, listas com `-`. Se vier um bloco
de texto corrido sem `#`, o documento não usa estilos de título do Word e a
rubrica sairá pobre.

**Se falhar:**
- "O arquivo não parece ser um .docx válido" → arquivo é `.doc` antigo ou está corrompido
- 500 → veja os logs da function `playbook-ingest` no Supabase

---

## 3. Aprovação do Markdown

**Fazer:** revise o texto (pode editar direto no campo) → *Aprovar Markdown*.

**Esperar:** badge muda para **Aprovado**. É este passo que libera a aba Rubrica.

> Reenviar um arquivo novo zera a aprovação de propósito — conteúdo novo precisa
> ser revisado de novo.

---

## 4. Geração e ativação da rubrica

**Fazer:** aba **Rubrica** → *Gerar rubrica*. Aguarde (usa Gemini Pro sobre o
playbook inteiro; pode levar de 30 a 90 segundos).

**Esperar:** toast com a contagem de critérios (entre 5 e 40) e a lista
preenchida, agrupada por etapa, com pesos 1 a 3.

**Fazer:** ajuste o que quiser (texto, peso, ativar/desativar, adicionar critério
manual) → *Ativar rubrica*.

**Esperar:** versão marca **Em uso**, análise passa a **Ativa**. A partir daqui
ela aparece nos selects.

**Se falhar:**
- "Aprove o Markdown antes de gerar a rubrica" → etapa 3 não concluída
- "A IA retornou uma resposta em formato inesperado" → tente novamente; persistindo, veja os logs de `playbook-extract-rubric`
- Erro 429/402 → limite ou créditos de IA

**Conferir no banco:**

```sql
select p.name, v.version, v.status, count(c.id) as criterios
from analysis_playbooks p
join analysis_rubric_versions v on v.playbook_id = p.id
left join analysis_rubric_criteria c on c.version_id = v.id
group by p.name, v.version, v.status
order by p.name, v.version;
```

---

## 5. Diretrizes

**Fazer:** aba **Dados** → preencha "Diretrizes desta análise". No card
principal, preencha "Diretrizes gerais de avaliação" → *Salvar diretrizes*.

**Esperar:** ambos persistem após recarregar a página.

---

## 6. Vinculação

Teste ao menos dois dos quatro caminhos:

| Caminho | Onde | O que verificar |
|---|---|---|
| Atividade manual | Card do lead → Nova Atividade, tipo Reunião | Campo "Análise de atendimento" aparece depois de Duração |
| Agendamento | `/crm/appointments` → Novo | Campo aparece depois de Duração |
| Widget | `/widgets` → editar widget | Campo ao lado de "Janela de agendamento" |
| Agente (chat) | `/settings/assistente-reuniao` | "Análise padrão das reuniões agendadas pelo agente" |

**Esperar:** o select lista apenas análises **ativas** compatíveis com o tipo.
Se nenhuma análise ativa existir para aquele tipo, o campo **não aparece** — é o
comportamento correto, não um bug.

**Conferir:**

```sql
select id, title, type, analysis_playbook_id
from crm_lead_activities
where analysis_playbook_id is not null
order by created_at desc limit 5;
```

---

## 7. Avaliação automática

Dois caminhos. O (B) é mais rápido para testar.

### A) Reunião real de ponta a ponta

Faça uma reunião curta pelo Daily com a análise vinculada, fale algumas coisas
do playbook e outras fora dele, encerre e aguarde a transcrição (alguns minutos).

### B) Reaproveitar uma gravação existente

Pegue uma reunião que já tenha transcrição e vincule a análise via SQL — o
select de análise só existe na **criação** da atividade, não na edição:

```sql
-- 1. Achar uma gravação com transcrição
select r.id as recording_id, a.id as activity_id, a.title, a.assigned_to
from daily_recordings r
join crm_lead_activities a on a.appointment_id = r.appointment_id
where r.transcription_text is not null
order by r.created_at desc
limit 5;

-- 2. Vincular a análise à atividade (troque os UUIDs)
update crm_lead_activities
set analysis_playbook_id = '<id_da_analise>'
where id = '<activity_id>';
```

Depois abra o card do lead → a atividade → **Reanalisar transcrição**.

**Esperar:** toast "Atendimento avaliado: NN/100" e um botão novo
**Ver avaliação (NN/100)** ao lado.

**Conferir:**

```sql
select score, status, jsonb_array_length(criteria_results) as criterios,
       jsonb_array_length(recurrences) as recorrencias,
       jsonb_array_length(corrected) as corrigidos, model, error_message
from activity_analysis_results
order by created_at desc limit 3;
```

**Se `status = 'failed'`:** a coluna `error_message` diz o motivo. Falhas comuns:
sem rubrica ativa, limite de IA, transcrição vazia.

**Se nada acontecer:** confirme que a atividade tem `analysis_playbook_id` e que
a análise tem versão de rubrica **active**. Sem isso, a função responde
`skipped` e o sistema cai na análise genérica de sempre — que é o comportamento
esperado, não uma falha.

---

## 8. Modal de resultado

**Fazer:** clique em *Ver avaliação*.

**Esperar:**
- Score em destaque com a contagem de atendidos / parciais / não atendidos
- Critérios agrupados por etapa, cada um com veredicto e **citação literal da transcrição**
- Blocos de pontos fortes, o que ajustar e hábitos observados

**O ponto crítico a checar:** as evidências devem ser trechos que realmente
aparecem na transcrição. Se forem frases genéricas inventadas, o prompt não está
sendo respeitado — reporte.

---

## 9. Recorrência e correção

**Fazer:** avalie um **segundo** atendimento do mesmo vendedor, na mesma análise.

**Esperar:**
- Falha que se repetiu → aparece em **Falhas recorrentes** no modal, com contador `2x`
- Critério que passou a ser atendido → aparece em **Pontos corrigidos**
- **O score não muda por causa da recorrência** — é alerta, não punição

**Conferir:**

```sql
select point_type, point_key, status, occurrences, first_seen_at, corrected_at
from seller_development_points
where seller_id = '<uuid_do_vendedor>'
order by last_seen_at desc;
```

**Teste de idempotência:** clique em *Reanalisar* na mesma reunião e rode a query
de novo — `occurrences` **não pode** aumentar.

---

## 10. Painel do vendedor

**Fazer:** menu lateral → CRM → **Desempenho**.

**Esperar:** score médio, atendimentos avaliados, pontos corrigidos e recorrentes;
gráfico de evolução (aparece a partir de 2 dias com avaliação); blocos Em aberto /
Recorrentes / Corrigidos; conquistas; lista das últimas avaliações clicável.

---

## 11. Painel do gestor

**Fazer:** na mesma página, como admin, use as abas.

- **Visão geral:** média da empresa, evolução do time, desempenho por tipo de análise
- **Ranking:** vendedores ordenados por score médio, com tendência em pontos e contagem de recorrentes. *Ver detalhe* leva à aba Individual
- **Individual:** selecione o vendedor → *Gerar orientação* → brief de coaching em markdown, com data de geração; recarregue a página e confirme que veio do cache
- **Meu desempenho:** o mesmo painel do vendedor

---

## 12. Permissões (RLS)

**Fazer:** entre com um usuário **member**.

**Esperar:**
- `/crm/desempenho` mostra apenas o painel individual, **sem** abas de gestão
- Ele vê somente as próprias avaliações
- Em Inbox/Atividades/Pipeline, o member continua **vendo todos** os cards, atividades e reuniões do workspace, mas só consegue **editar** aqueles em que é o responsável ou criador

**Conferir logado como member:**

```sql
select count(*) from activity_analysis_results;  -- só as próprias
select count(*) from seller_coaching_briefs;     -- 0: brief é material de gestão
```

---

## 13. API

Precisa de um token JWT ou de uma API key com permissão `crm`.

```bash
npx tsx scripts/test-api.ts SEU_TOKEN_JWT
```

A **Fase 22c — Performance** cobre o endpoint novo. Ou chame direto:

```bash
curl -s "https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/api-gateway/crm/performance/ranking?period=30d" \
  -H "X-API-Key: SUA_CHAVE" \
  -H "X-Workspace-Id: SEU_WORKSPACE_UUID"
```

**Esperar:** `{"success":true,"data":[...],"meta":{"total":N,"page":1,"per_page":50,"period":{...}}}`,
com `seller_id`, `seller_name`, `avg_score`, `analyses_count`, `trend` e
`recurrent_points` em cada linha.

Confira também `/api-docs` na aplicação: o endpoint deve aparecer sob **CRM Performance**.

---

## Onde olhar quando algo falha

| Sintoma | Onde investigar |
|---|---|
| Upload não converte | Logs da function `playbook-ingest` |
| Rubrica não gera | Logs de `playbook-extract-rubric`; cheque `md_approved_at` |
| Reunião não avalia | Logs de `process-daily-recording` (procure "playbook analysis") |
| Ligação não avalia | Logs de `api4com-transcribe`; confirme `calls.activity_id` preenchido |
| Avaliação com `status=failed` | Coluna `error_message` em `activity_analysis_results` |
| Modelo indisponível | Logs com `[gemini-client]` — há rebaixamento automático de 3.1 → 3 Pro |
| Painel vazio | Confirme `status='done'` e `seller_id` preenchido nos resultados |

**Sobre `seller_id`:** vem estritamente de `crm_lead_activities.assigned_to`.
O `assigned_to` do appointment (e, em ligações, `calls.user_id`) só é usado
quando não existe atividade vinculada. Nem o dono do card nem quem conduziu a
reunião interferem: o card pode ser reatribuído depois, e a atividade é o
registro daquele atendimento.

Atividade sem responsável gera avaliação **sem vendedor** — o resultado é
gravado, mas não alimenta painel, ranking nem memória de evolução.

As três origens preenchem esse campo, e todas convergem para a continuidade do
atendimento:

| Origem | Responsável da atividade |
|---|---|
| Manual (card do lead) | Responsável do card; sem dono, quem criou |
| Widget de agendamento | Responsável do card; contato novo entra por distribuição de carga |
| Agente (WhatsApp) | Responsável do card; sem dono, o atendente resolvido pela disponibilidade |
