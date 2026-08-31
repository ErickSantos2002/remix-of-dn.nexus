# Padronizar slots de agendamento

Unificar os dois motores de agendamento (Widget Público e IA/Orquestrador) usando as regras do Widget Público como padrão, e criar uma configuração geral do tamanho do passo entre slots.

## O que muda

1. **Passo entre candidatos configurável (padrão 15 min)**
   - Nova configuração por workspace: "Tamanho do slot (passo entre horários)" com opções 5, 10, 15, 20, 30 e 60 minutos. Default 15.
   - Os dois motores passam a ler esse valor em vez de usar 15 fixo (widget) ou "duração + intervalo" (IA).

2. **Motor da IA passa a seguir as regras do widget**
   - Respeita feriados do workspace (`crm_holidays`) — hoje ignora.
   - Avança candidatos pelo passo configurado, e não pela duração do compromisso.
   - Ao encontrar conflito, salta para o fim do conflito + intervalo mínimo, arredondado para o próximo múltiplo do passo (mesma lógica do widget).
   - Mantém: buffer de 10 min, fuso do agente, checagem local + Google Calendar, round-robin entre agentes.

3. **Nova UI em /crm/settings/agent-calendars**
   - Card "Configurações gerais de agendamento" no topo da página (acima do seletor de agente), aplicável a todo o workspace.
   - Campo: Tamanho do slot (select). Salva imediatamente com toast de confirmação.
   - O restante da página (configurações por agente) continua igual.

## O que não muda

- Duração do compromisso continua vindo do widget (`duration_minutes`) no widget público e do calendário do agente (`default_appointment_duration`) na IA.
- Janela de reserva: widget usa `booking_window_days`; IA continua olhando 7 dias.

## Detalhes técnicos

- Migration: `ALTER TABLE public.workspace_meeting_settings ADD COLUMN IF NOT EXISTS slot_step_minutes integer NOT NULL DEFAULT 15;` (tabela já é workspace-scoped, com RLS e grants existentes).
- Novo hook `src/hooks/useWorkspaceSchedulingSettings.ts` (React Query: leitura + upsert por `workspace_id`).
- `supabase/functions/schedule-widget/index.ts`: substituir `const slotStepMinutes = 15` pelo valor lido de `workspace_meeting_settings` (fallback 15).
- `supabase/functions/schedule-appointment/index.ts`: buscar feriados do workspace e o `slot_step_minutes`; alterar os loops de geração de slots (linhas ~312 e ~648) para avançar pelo passo e pular dias de feriado.
- Ambas as funções serão reimplantadas.
