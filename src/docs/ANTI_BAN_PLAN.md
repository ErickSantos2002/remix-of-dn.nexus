# Nexus AI — Protecoes Anti-Softban e Anti-Banimento

## Contexto

O Nexus AI usa **Z-API** (API nao-oficial do WhatsApp) para comunicacao via WhatsApp. A Meta intensificou em 2025/2026 a deteccao de APIs nao-oficiais e aplica **softban** (restricao temporaria — nao consegue iniciar novas conversas) e **banimento permanente** baseado em:

- Volume vs qualidade das mensagens
- Denuncias de spam e bloqueios por destinatarios
- Padroes roboticos de envio (delays identicos, volume constante)
- Ausencia de opt-in/opt-out
- Picos subitos de volume apos periodos inativos

**Situacao atual do Nexus**: **ZERO protecoes** contra banimento — sem rate limiting, sem opt-out, sem monitoramento de qualidade, sem warm-up, sem circuit breaker. Cada mensagem dispara chamada direta a Z-API sem nenhum controle.

**Escopo**: Todas as protecoes serao aplicadas para **ambos os tipos de conexao** (Z-API e WhatsApp Oficial). A API oficial tambem aplica restricoes por volume/spam e tem Quality Rating proprio — portanto rate limiting, opt-out, humanizacao e monitoramento protegem qualquer numero.

---

## Feature 1: Rate Limiter no Envio de Mensagens

### O que faz
Controla a velocidade de envio de mensagens para a Z-API, impedindo que o volume ultrapasse limites seguros. Funciona como um "semaforo" que segura mensagens quando o ritmo esta muito alto.

### Como funciona
- **Limite por conexao**: Maximo **20 mensagens/minuto** por instancia Z-API (sliding window de 60s)
- **Limite por lead**: Maximo **1 mensagem/segundo** por lead (evita "metralhar" um contato)
- **Comportamento quando limite atingido**: A funcao **aguarda** (sleep) ate o proximo slot disponivel, em vez de rejeitar a mensagem. Isso garante que nenhuma mensagem e perdida.
- **Contagem**: Usa tabela no banco para controlar timestamps dos ultimos envios

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/send-to-whatsapp-channel/index.ts` (ponto central) | Adicionar logica de rate limit ANTES de chamar `zapi-send` ou `whatsapp-send`. Consultar contagem recente, aguardar se necessario. Cobre ambos os canais. |
| `supabase/functions/zapi-send/index.ts` (backup) | Rate limit adicional por seguranca no nivel de envio direto (media messages que bypas send-to-whatsapp-channel) |
| Nova migration SQL | Criar tabela `whatsapp_send_log` com colunas: `id`, `connection_id`, `connection_type` (zapi/whatsapp_official), `lead_phone`, `sent_at` (timestamp). Index em `(connection_id, sent_at)` |

### Logica detalhada
```
ANTES de enviar para Z-API ou WhatsApp Oficial (no send-to-whatsapp-channel):
1. Consultar whatsapp_send_log WHERE connection_id = X AND sent_at > now() - 60s
2. Se count >= 20: calcular quanto tempo falta pro envio mais antigo sair da janela → sleep(tempo)
3. Consultar whatsapp_send_log WHERE lead_phone = Y AND sent_at > now() - 1s
4. Se count >= 1: sleep(1000 - diff_ms)
5. Enviar mensagem (via zapi-send OU whatsapp-send conforme canal)
6. INSERT em whatsapp_send_log (connection_id, connection_type, lead_phone, sent_at)
```

### Beneficio
- Previne picos de volume que ativam deteccao automatica da Meta
- Distribui envios de forma mais natural ao longo do tempo
- Impede que multiplas conversas simultaneas (IA respondendo varios leads) sobrecarreguem a instancia

### Como testar
1. Enviar mensagens manualmente no Inbox para 3+ leads diferentes em sequencia rapida
2. Verificar nos logs do edge function que delays estao sendo aplicados quando o ritmo excede 20/min
3. Verificar na tabela `whatsapp_send_log` que os registros estao sendo criados
4. Testar que mensagens nao sao perdidas — todas chegam, apenas com delay

---

## Feature 2: Monitoramento de Qualidade do Numero (Health Score)

### O que faz
Agrega metricas de entrega/leitura por conexao Z-API e mostra um **indicador visual de saude** na pagina de configuracoes. Permite ao admin ver rapidamente se um numero esta em risco de softban.

### Como funciona
- **Coleta diaria**: Edge function roda 1x/dia (via pg_cron) e agrega dados da tabela `messages`
- **Metricas calculadas**:
  - `messages_sent`: total de mensagens enviadas (sender_type = 'ai' ou 'human_agent')
  - `messages_delivered`: quantas tiveram delivery_status = 'delivered' ou 'read'
  - `messages_read`: quantas tiveram delivery_status = 'read'
  - `messages_failed`: quantas ficaram em 'pending' por mais de 1 hora (nunca viraram 'sent')
  - `delivery_rate`: messages_delivered / messages_sent (%)
  - `read_rate`: messages_read / messages_sent (%)
  - `unique_contacts`: contatos distintos que receberam mensagem
- **Semaforo visual**:
  - **Verde**: delivery_rate > 90% E read_rate > 40%
  - **Amarelo**: delivery_rate entre 70-90% OU read_rate entre 25-40%
  - **Vermelho**: delivery_rate < 70% OU read_rate < 25%

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| Nova migration SQL | Criar tabela `connection_health_daily` com: `id`, `connection_id`, `connection_type` (zapi/whatsapp_official), `date`, `messages_sent`, `messages_delivered`, `messages_read`, `messages_failed`, `delivery_rate`, `read_rate`, `unique_contacts`. UNIQUE em (connection_id, date) |
| Nova edge function `supabase/functions/connection-health-metrics/index.ts` | Agrega dados de `messages` + conversations dos ultimos 24h por connection_id para AMBOS os tipos de conexao. Insere/atualiza em `connection_health_daily` |
| Nova migration SQL para pg_cron | Agendar `connection-health-metrics` para rodar diariamente as 03:00 UTC |
| `src/components/settings/connections/` — novo componente `ConnectionHealthBadge.tsx` | Badge colorido (verde/amarelo/vermelho) com tooltip mostrando delivery_rate e read_rate. Funciona para Z-API e WhatsApp Oficial |
| Pagina de conexoes existente | Adicionar o badge ao lado de cada conexao na listagem |

### Logica da edge function
```sql
-- Para conexoes Z-API:
SELECT ... FROM messages m
JOIN zapi_conversations zc ON zc.lead_id = m.lead_id
WHERE zc.connection_id = :conn_id ...

-- Para conexoes WhatsApp Oficial:
SELECT ... FROM messages m
JOIN whatsapp_conversations wc ON wc.lead_id = m.lead_id
WHERE wc.connection_id = :conn_id ...

-- Ambas as queries seguem a mesma logica:
SELECT
  COUNT(*) FILTER (WHERE sender_type IN ('ai','human_agent')) as sent,
  COUNT(*) FILTER (WHERE delivery_status IN ('delivered','read')) as delivered,
  COUNT(*) FILTER (WHERE delivery_status = 'read') as read,
  COUNT(*) FILTER (WHERE delivery_status = 'pending' AND created_at < now() - interval '1 hour') as failed,
  COUNT(DISTINCT lead_id) as unique_contacts
FROM messages m
JOIN [conversations_table] conv ON conv.lead_id = m.lead_id
WHERE conv.connection_id = :conn_id
  AND m.created_at >= :date_start AND m.created_at < :date_end
  AND m.sender_type IN ('ai', 'human_agent')
```

### Beneficio
- Admin tem visibilidade imediata quando um numero esta perdendo qualidade
- Permite agir ANTES do softban (reduzir volume, verificar conteudo)
- Historico diario permite identificar tendencias de queda

### Como testar
1. Chamar manualmente a edge function `connection-health-metrics` via Supabase dashboard
2. Verificar que registros foram criados em `connection_health_daily`
3. Verificar que o badge aparece na pagina de conexoes com a cor correta
4. Comparar metricas calculadas com contagem manual na tabela `messages`

---

## Feature 3: Opt-Out (STOP) Handler

### O que faz
Detecta quando um contato deseja parar de receber mensagens (envia "PARAR", "SAIR", etc.) e **bloqueia automaticamente** todos os envios futuros para aquele contato. Reduz drasticamente as denuncias de spam.

### Como funciona
- **Deteccao**: No webhook de mensagens recebidas, antes de processar, verifica se a mensagem contem palavras-chave de opt-out
- **Palavras-chave**: `PARAR`, `SAIR`, `STOP`, `CANCELAR`, `NAO QUERO MAIS`, `ME REMOVE`, `DESCADASTRAR`
- **Ao detectar opt-out**:
  1. Marca `crm_contacts.opted_out = true` e `opted_out_at = now()`
  2. Fecha o lead (status = 'closed')
  3. Envia mensagem de confirmacao: "Voce foi removido da nossa lista. Para voltar a conversar conosco, basta enviar uma nova mensagem a qualquer momento."
  4. NAO dispara o orchestrator (a mensagem nao gera resposta de IA)
- **Bloqueio de envio**: No `send-to-whatsapp-channel`, antes de enviar, consulta `crm_contacts` pelo telefone. Se `opted_out = true`, bloqueia o envio e loga.
- **Re-opt-in**: Se o contato envia QUALQUER mensagem depois de ter feito opt-out (que nao seja outra palavra de opt-out), automaticamente marca `opted_out = false` e reativa o fluxo normal.

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| Nova migration SQL | `ALTER TABLE crm_contacts ADD COLUMN opted_out BOOLEAN DEFAULT false, ADD COLUMN opted_out_at TIMESTAMPTZ` |
| `supabase/functions/zapi-webhook/index.ts` (apos linha 483, antes do processamento de conteudo) | Adicionar bloco de deteccao de opt-out. Se detectado: atualizar contato, fechar lead, enviar confirmacao, retornar early |
| `supabase/functions/send-to-whatsapp-channel/index.ts` (apos linha 37, antes de buscar conversas) | Adicionar check: buscar contato pelo telefone do lead, se opted_out = true → retornar sem enviar |
| `supabase/functions/zapi-webhook/index.ts` (no fluxo de mensagem recebida) | Apos encontrar contato existente, se `opted_out = true` e mensagem NAO e opt-out → marcar `opted_out = false` (re-opt-in) |

### Logica detalhada no webhook
```typescript
// Apos normalizar o telefone e ANTES de processar conteudo:
const OPT_OUT_KEYWORDS = ['parar', 'sair', 'stop', 'cancelar', 'nao quero mais', 'me remove', 'descadastrar'];
const normalizedMsg = normalizeText(messageContent);
const isOptOut = OPT_OUT_KEYWORDS.some(kw => normalizedMsg.includes(kw));

if (isOptOut) {
  // 1. Buscar contato
  // 2. UPDATE crm_contacts SET opted_out = true, opted_out_at = now()
  // 3. UPDATE leads SET status = 'closed' WHERE phone = normalizedPhone
  // 4. Chamar zapi-send com mensagem de confirmacao
  // 5. Return early (nao disparar orchestrator)
}
```

### Logica de bloqueio no envio
```typescript
// No send-to-whatsapp-channel, antes de enviar:
const { data: contact } = await supabase
  .from('crm_contacts')
  .select('opted_out')
  .eq('phone', leadPhone)
  .eq('workspace_id', workspaceId)
  .maybeSingle();

if (contact?.opted_out) {
  console.log('[send-to-whatsapp-channel] Blocked: contact opted out');
  return Response({ success: false, error: 'Contact opted out', blocked: true });
}
```

### Beneficio
- Reduz denuncias de spam (principal causa de softban/ban)
- Contatos insatisfeitos tem uma saida limpa em vez de bloquear/denunciar
- Conformidade com boas praticas de comunicacao
- Re-opt-in automatico nao perde contatos que mudam de ideia

### Como testar
1. Enviar "PARAR" de um numero de teste via WhatsApp
2. Verificar que `crm_contacts.opted_out = true` no banco
3. Verificar que o lead foi fechado
4. Verificar que a mensagem de confirmacao foi enviada
5. Tentar enviar mensagem da IA para esse contato — deve ser bloqueada
6. Enviar "Oi" do mesmo numero — deve reativar (opted_out = false)
7. Verificar que a IA volta a responder normalmente

---

## Feature 4: Humanizacao dos Padroes de Envio

### O que faz
Torna o comportamento de envio de mensagens mais "humano" — com delays variaveis, simulacao de digitacao, e variacao no tamanho dos chunks. Reduz a chance de deteccao por padroes roboticos.

### Como funciona atualmente (problematico)
- Delay fixo entre chunks: 1000-2000ms (previsivel)
- Tamanho maximo do chunk fixo: 300 chars
- Sem simulacao de "digitando..."
- Primeira resposta e imediata (sem delay de "leitura")

### Como vai funcionar (humanizado)
- **Delay variavel**: `base_delay + random(-500, +1500)ms` com range 1500-3500ms
- **Tamanho variavel do chunk**: Range aleatorio 220-380 chars (em vez de fixo 300)
- **Simulacao de "digitando"**: Antes de cada mensagem, chamar Z-API endpoint `/chat-state` com `composing` (mostra "digitando..." no WhatsApp do contato)
- **Delay de "leitura"**: Antes da PRIMEIRA resposta, delay de 500-1500ms (simula leitura da mensagem)
- **Delay noturno**: Entre 22h-7h, multiplicar delays por 1.5x (pessoas digitam mais devagar de madrugada)

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/orchestrator/message-splitter.ts` (linhas 7-10) | Alterar constantes: `MIN_DELAY_MS = 1500`, `MAX_DELAY_MS = 3500`, `MAX_CHUNK_LENGTH` aleatorio por chamada |
| `supabase/functions/orchestrator/message-splitter.ts` (funcao `calculateDelay`, linhas 86-91) | Adicionar randomizacao: `delay + Math.random() * 1500 - 500` + fator noturno |
| `supabase/functions/orchestrator/message-splitter.ts` (funcao `sendMessageChunks`, linhas 219-267) | Antes de cada INSERT, chamar funcao para enviar chat-state "composing" via Z-API |
| `supabase/functions/zapi-send/index.ts` | Adicionar funcao auxiliar `sendChatState(phone, "composing")` que chama `POST /chat-state` da Z-API |
| `supabase/functions/orchestrator/index.ts` | Antes de chamar `sendMessageChunks`, adicionar delay de "leitura" (500-1500ms) |

### Logica de delay humanizado
```typescript
function calculateDelay(chunkLength: number): number {
  const baseDelay = (chunkLength / 45) * 1000; // ~45 chars/s (mais lento que antes)
  const randomJitter = Math.random() * 1500 - 500; // -500ms a +1500ms
  let delay = Math.max(1500, Math.min(3500, baseDelay + randomJitter));

  // Fator noturno (22h-7h local): delays 50% maiores
  const hour = new Date().getUTCHours() - 3; // UTC-3 para Brasil
  if (hour < 7 || hour >= 22) {
    delay *= 1.5;
  }

  return Math.round(delay);
}
```

### Logica de chat-state
```typescript
async function sendTypingIndicator(zapiBaseUrl: string, headers: Record<string, string>, phone: string) {
  await fetch(`${zapiBaseUrl}/chat-state`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone, state: "composing" }),
  }).catch(() => {}); // Fire-and-forget, nao bloqueia se falhar
}
```

### Beneficio
- Padroes de envio ficam indistinguiveis de um humano digitando
- O contato ve "digitando..." antes de receber a mensagem (UX mais natural)
- Delays variaveis dificultam deteccao estatistica pela Meta
- Fator noturno adiciona mais realismo

### Como testar
1. Enviar mensagem longa (que sera splitada em 3+ chunks) de um lead de teste
2. Verificar nos logs que delays entre chunks variam (nao sao identicos)
3. No WhatsApp do lead de teste, verificar que aparece "digitando..." antes de cada mensagem
4. Testar em horarios diferentes e verificar que delays noturnos sao maiores
5. Repetir envio varias vezes e confirmar que delays nunca sao exatamente iguais

---

## Feature 5: Circuit Breaker para Z-API

### O que faz
Protege o sistema quando a Z-API esta com problemas (rate limit 429, indisponivel 503, timeout). Em vez de continuar enviando e acumular erros, o circuit breaker **pausa envios** temporariamente e tenta novamente de forma controlada.

### Como funciona
Tres estados:

| Estado | Comportamento |
|--------|---------------|
| **CLOSED** (normal) | Mensagens sao enviadas normalmente. Contador de falhas e monitorado. |
| **OPEN** (pausado) | Todas as mensagens sao bloqueadas e retornam erro "circuit open". Dura 60 segundos. |
| **HALF-OPEN** (testando) | Apos 60s, permite 1 unico envio de teste. Se sucesso → volta a CLOSED. Se falha → volta a OPEN por mais 60s. |

**Transicoes**:
- CLOSED → OPEN: **5 falhas consecutivas** (status 429, 503, timeout, ou erro de rede)
- OPEN → HALF-OPEN: apos **60 segundos** desde a abertura
- HALF-OPEN → CLOSED: envio de teste bem-sucedido
- HALF-OPEN → OPEN: envio de teste falhou

**Retry com backoff** (dentro do estado CLOSED):
- 1a falha: retry apos 1s
- 2a falha: retry apos 2s
- 3a falha: retry apos 4s
- Maximo 3 retries por mensagem

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| Nova migration SQL | `ALTER TABLE zapi_connections ADD COLUMN circuit_state TEXT DEFAULT 'closed', ADD COLUMN circuit_opened_at TIMESTAMPTZ, ADD COLUMN circuit_failure_count INTEGER DEFAULT 0`. Mesma alteracao em `whatsapp_connections` (se existir) ou criar tabela generica `connection_circuit_state` |
| `supabase/functions/send-to-whatsapp-channel/index.ts` | Verificar circuit state da conexao ANTES de chamar zapi-send ou whatsapp-send. Cobre ambos os canais. |
| `supabase/functions/zapi-send/index.ts` | Circuit breaker + retry com backoff exponencial (1s, 2s, 4s) para erros 429/503 |
| `supabase/functions/whatsapp-send/index.ts` (se existir) | Mesma logica de circuit breaker + retry |

### Logica detalhada
```typescript
// ANTES do fetch:
const { circuit_state, circuit_opened_at, circuit_failure_count } = connection;

if (circuit_state === 'open') {
  const elapsed = Date.now() - new Date(circuit_opened_at).getTime();
  if (elapsed < 60000) {
    // Circuit still open
    return Response({ error: 'Circuit breaker open', retry_after_ms: 60000 - elapsed });
  }
  // Transition to half-open
  await supabase.from('zapi_connections').update({ circuit_state: 'half_open' }).eq('id', connection.id);
}

// APOS o fetch:
if (zapiResponse.ok) {
  if (circuit_state !== 'closed') {
    await supabase.from('zapi_connections').update({
      circuit_state: 'closed', circuit_failure_count: 0
    }).eq('id', connection.id);
  }
} else if ([429, 503].includes(zapiResponse.status)) {
  const newCount = (circuit_failure_count || 0) + 1;
  if (newCount >= 5) {
    await supabase.from('zapi_connections').update({
      circuit_state: 'open', circuit_opened_at: new Date().toISOString(), circuit_failure_count: newCount
    }).eq('id', connection.id);
  } else {
    await supabase.from('zapi_connections').update({ circuit_failure_count: newCount }).eq('id', connection.id);
  }
}
```

### Beneficio
- Evita "efeito avalanche" quando Z-API esta com problemas
- Retry automatico recupera falhas transientes sem intervencao humana
- Quando Z-API retorna 429 (rate limit), o sistema para de enviar em vez de piorar a situacao
- Reducao de mensagens perdidas em momentos de instabilidade

### Como testar
1. Simular falha: temporariamente alterar URL da Z-API para um endpoint invalido
2. Enviar 5+ mensagens e verificar que apos 5 falhas o circuit abre (logs: "Circuit breaker open")
3. Esperar 60s e verificar que uma mensagem e tentada (half-open)
4. Restaurar URL correta e verificar que o circuit fecha apos sucesso
5. Verificar na tabela `zapi_connections` que `circuit_state`, `circuit_opened_at` e `circuit_failure_count` sao atualizados

---

## Feature 6: Guia de Warm-Up para Novas Conexoes

### O que faz
Quando uma nova conexao Z-API e adicionada, aplica **limites de envio progressivos** durante os primeiros 7 dias, evitando que um numero novo seja identificado como spammer. Mostra orientacoes visuais para o admin.

### Como funciona
- **Deteccao automatica**: Quando `zapi_connections.created_at` tem menos de 7 dias, a conexao esta em "modo warm-up"
- **Limites progressivos** (aplicados no rate limiter):

| Periodo | Limite |
|---------|--------|
| Dia 1-2 | 5 msgs/hora (maximo absoluto) |
| Dia 3-4 | 15 msgs/hora |
| Dia 5-6 | 30 msgs/hora |
| Dia 7+ | Limite normal (20/min = 1200/hora) |

- **Banner informativo**: Na pagina de conexoes, conexoes em warm-up mostram banner com:
  - Dias restantes de warm-up
  - Limite atual
  - Checklist de boas praticas:
    - "Use o numero pessoalmente por 24h antes de conectar"
    - "Configure foto de perfil e descricao"
    - "Comece respondendo contatos que ja te conhecem"
    - "Evite enviar a mesma mensagem para muitas pessoas"

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/zapi-send/index.ts` | No bloco de rate limiting (Feature 1), verificar `connection.created_at`. Se < 7 dias, usar limites reduzidos conforme tabela acima |
| Novo componente `src/components/settings/connections/WarmUpBanner.tsx` | Banner com progresso, limite atual, e checklist. Usa dados de `zapi_connections.created_at` |
| Pagina de conexoes existente | Renderizar `WarmUpBanner` para conexoes com created_at < 7 dias |

### Logica de limite no zapi-send
```typescript
function getHourlyLimit(connectionCreatedAt: string): number {
  const daysSinceCreation = (Date.now() - new Date(connectionCreatedAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 2) return 5;    // Dia 1-2
  if (daysSinceCreation < 4) return 15;   // Dia 3-4
  if (daysSinceCreation < 6) return 30;   // Dia 5-6
  return 1200;                             // Dia 7+: normal
}

// No rate limiter:
const hourlyLimit = getHourlyLimit(connection.created_at);
const recentCount = await countMessagesSentInLastHour(connection.id);
if (recentCount >= hourlyLimit) {
  // Aguardar ou retornar erro
}
```

### Beneficio
- Numeros novos nao sao "queimados" por volume prematuro
- Admin recebe orientacoes claras de como proteger o numero
- Ramp-up gradual e a pratica recomendada pela Z-API e pela propria Meta
- Transparente: admin sabe exatamente em que fase esta e quando os limites aumentam

### Como testar
1. Criar nova conexao Z-API (ou alterar `created_at` de uma existente para hoje)
2. Verificar que o banner de warm-up aparece na pagina de conexoes
3. Enviar mais de 5 mensagens em 1 hora e verificar que sao throttled
4. Alterar `created_at` para 3 dias atras e verificar que limite sobe para 15/hora
5. Alterar para 7+ dias e verificar que limite e normal

---

## Feature 7: Dashboard de Analytics de Entrega

### O que faz
Adiciona uma nova aba **"Saude do WhatsApp"** na pagina de Analytics com graficos de taxa de entrega, taxa de leitura, e volume de mensagens ao longo do tempo, por conexao Z-API.

### Como funciona
- **Dados**: Usa a tabela `connection_health_daily` (criada na Feature 2) como fonte
- **Graficos**:
  1. **Linha do tempo**: delivery_rate e read_rate por dia (ultimos 30 dias) com linha de threshold (70% delivery, 40% read)
  2. **Volume diario**: barras empilhadas de msgs enviadas vs entregues vs lidas
  3. **KPI Cards**: delivery_rate atual, read_rate atual, tendencia (subindo/descendo), msgs/dia medio
- **Filtros**: Por conexao Z-API, por periodo (7d, 15d, 30d)
- **Alertas**: Se delivery_rate < 70% nos ultimos 3 dias, mostra alerta vermelho no topo

### Onde sera implementado
| Arquivo | Alteracao |
|---------|-----------|
| `src/pages/Analytics.tsx` | Adicionar nova aba "Saude WhatsApp" usando Tabs do shadcn |
| Novo hook `src/hooks/useDeliveryAnalytics.ts` | Query para `connection_health_daily` com filtros de conexao e periodo |
| Novo componente `src/components/analytics/WhatsAppHealthTab.tsx` | Container com KPI cards + graficos |
| Novo componente `src/components/analytics/DeliveryRateChart.tsx` | Grafico de linha (recharts) com delivery_rate e read_rate |
| Novo componente `src/components/analytics/MessageVolumeChart.tsx` | Grafico de barras empilhadas (recharts) com sent/delivered/read |

### Dados do hook
```typescript
const useDeliveryAnalytics = (connectionId?: string, days: number = 30) => {
  return useQuery({
    queryKey: ['delivery-analytics', connectionId, days],
    queryFn: async () => {
      let query = supabase
        .from('connection_health_daily')
        .select('*')
        .gte('date', subDays(new Date(), days).toISOString())
        .order('date', { ascending: true });

      if (connectionId) query = query.eq('connection_id', connectionId);

      return query;
    }
  });
};
```

### Beneficio
- Visao historica da saude do numero — permite identificar queda gradual antes do softban
- Correlacao entre volume e qualidade — admin pode ajustar estrategia
- Alertas proativos — nao precisa esperar o softban para agir
- Dados concretos para tomada de decisao (ex: "devemos reduzir volume?" "este numero esta ficando vermelho?")

### Como testar
1. Garantir que Feature 2 (Health Metrics) esta rodando e populando `connection_health_daily`
2. Acessar Analytics → aba "Saude WhatsApp"
3. Verificar que graficos renderizam com dados corretos
4. Testar filtros de conexao e periodo
5. Simular queda de delivery_rate (alterar dados no banco) e verificar que alerta vermelho aparece
6. Comparar numeros do dashboard com consulta direta ao banco

---

## Resumo de Impacto

| # | Feature | Prioridade | Reducao de Risco | Complexidade |
|---|---------|-----------|-----------------|-------------|
| 1 | Rate Limiter | ALTA | Previne deteccao por volume | Media |
| 2 | Health Score | ALTA | Visibilidade de risco | Media |
| 3 | Opt-Out Handler | ALTA | Reduz denuncias de spam | Baixa |
| 4 | Humanizacao | MEDIA | Evita deteccao por padrao | Baixa |
| 5 | Circuit Breaker | MEDIA | Resiliencia a falhas | Media |
| 6 | Warm-Up Guide | BAIXA | Protege numeros novos | Baixa |
| 7 | Analytics Dashboard | BAIXA | Visao historica | Media |

### Dependencias entre features
- Feature 7 depende de Feature 2 (usa a tabela de metricas)
- Feature 6 reutiliza a infraestrutura de Feature 1 (rate limiter)
- Demais features sao independentes

### Arquivos criticos (existentes) que serao modificados
- `supabase/functions/send-to-whatsapp-channel/index.ts` — Features 1, 3, 5 (ponto central, cobre ambos os canais)
- `supabase/functions/zapi-send/index.ts` — Features 1, 4, 5, 6
- `supabase/functions/orchestrator/message-splitter.ts` — Feature 4
- `supabase/functions/orchestrator/index.ts` — Feature 4 (delay de leitura)
- `supabase/functions/zapi-webhook/index.ts` — Feature 3
- `src/pages/Analytics.tsx` — Feature 7

### Novos arquivos
- 3-4 migrations SQL (tabelas + colunas + pg_cron)
- 1 edge function (`connection-health-metrics`)
- 4-5 componentes React (badges, banners, graficos)
- 1-2 hooks React (analytics queries)

### Nota sobre ambos os canais
O `send-to-whatsapp-channel` ja e o dispatcher central que roteia para Z-API ou WhatsApp Oficial. As protecoes (rate limit, opt-out check, circuit breaker) aplicadas NELE automaticamente cobrem ambos os canais. Protecoes adicionais no `zapi-send` servem como segunda camada para envios diretos de media.
