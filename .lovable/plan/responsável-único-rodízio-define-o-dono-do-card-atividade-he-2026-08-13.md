# Responsável único: rodízio define o dono do card, atividade herda

Faz sentido sim. Hoje o card nasce com dono fixo (hardcode no banco) antes do rodízio rodar, e o agendamento/atividade vão para quem realmente tinha horário livre — por isso os responsáveis divergem.

## O que muda

1. **Card nasce sem dono**
   O gatilho de banco que cria o card quando o contato é cadastrado deixa de carimbar um responsável fixo. O card entra na primeira etapa sem responsável, aguardando a distribuição.

2. **Rodízio decide antes do vínculo**
   No widget de agendamento, a escolha do atendente (por carga + horário livre) continua acontecendo antes de gravar o card. Como o card agora chega sem dono, o vencedor do rodízio é gravado como responsável do card.

3. **Atividade e reunião herdam o card**
   O agendamento (`crm_appointments`) e a atividade "Reunião" passam a usar o responsável final do card — nunca um valor calculado à parte. Assim card, reunião e atividade ficam sempre com a mesma pessoa.

4. **Contato recorrente continua com o dono atual**
   Se o card já tem responsável (contato que volta a agendar), a regra atual é mantida: prioriza o dono do card. Se ele não tiver horário livre no slot escolhido, a reunião vai para quem tem agenda **e o card é realinhado para essa pessoa**, evitando de novo a divergência de hoje.

## Detalhes técnicos

- Migração: `CREATE OR REPLACE FUNCTION public.auto_create_pipeline_lead()` removendo a variável `alexsandra_id` e os `created_by`/`assigned_to` fixos (passam a `NULL`).
- `supabase/functions/schedule-widget/index.ts`:
  - manter o cálculo de `selectedMemberId` (rodízio por carga entre membros com slot livre) antes do insert/lookup do card;
  - substituir a condição `if (!cardOwnerId)` por gravação do responsável sempre que o card estiver sem dono **ou** quando o dono não tiver disponibilidade e o rodízio tiver escolhido outra pessoa;
  - usar o mesmo `selectedMemberId` final para `crm_appointments.assigned_to`, para a atividade em `crm_lead_activities` e para a notificação.
- Cards antigos criados com o dono fixo não são alterados retroativamente.
