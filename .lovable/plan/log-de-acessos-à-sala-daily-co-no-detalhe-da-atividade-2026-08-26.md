# Log de acessos à sala Daily.co no detalhe da atividade

Quando a atividade tiver uma reunião Daily.co vinculada, o detalhe passa a mostrar quem entrou na sala: anfitriões (usuários) e convidados (lead), com o horário de entrada.

## O que aparece

Novo bloco "Acessos à sala" dentro do detalhe da atividade, exibido apenas quando o tipo da reunião é Daily.co:

- Lista ordenada por horário de entrada (mais antigo primeiro)
- Por participante: nome exibido, marcação de Anfitrião ou Convidado, e data/hora de entrada em Brasília
- Resumo no topo: total de participantes, se o anfitrião entrou e se o convidado entrou
- Estado vazio: "Nenhum acesso registrado nesta sala"

## Detalhes técnicos

- Fonte: tabela `daily_meeting_participants` (`appointment_id`, `user_name`, `joined_at`, `is_owner`, `participant_id`), preenchida pelo `daily-webhook`
- Nova query no `ActivityDetailDialog` de `src/components/crm/LeadActivities.tsx`, habilitada quando existir `appointment?.id` e `meeting_type === "daily"`
- Somente leitura; nenhuma migration nem edge function nova. A RLS atual já permite leitura por membros do workspace (via `crm_appointments`)
- Estilo seguindo o design system (glass-card, tokens semânticos, badges), sem emojis
