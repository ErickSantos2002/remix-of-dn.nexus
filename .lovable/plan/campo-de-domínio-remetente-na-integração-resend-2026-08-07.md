# Campo de domínio remetente na Integração Resend

Hoje o card "Integração Resend" em /settings/company não permite editar o remetente. A coluna `resend_from_email` existe no banco, mas está nula em todas as empresas (inclusive na dn.ia, que tem chave ativa) e só é preenchida automaticamente pela validação da chave. Por isso os envios caem no valor fixo do código: `noreply@notifications.dnia.ai` (convites e e-mails de reunião) e `notificacoes@notifications.dnia.ai` (réguas).

## O que será feito

1. **Novo campo no card Resend**: "Domínio de envio" (aceita domínio, ex. `notifications.dnia.ai`, ou e-mail completo, ex. `noreply@notifications.dnia.ai`), editável e salvo em `resend_from_email`, com validação simples de formato e dica de que o domínio precisa estar verificado na Resend.
   - O valor deixa de ser sobrescrito silenciosamente pela validação da chave: a validação só sugere o domínio quando o campo ainda estiver vazio.
   - Exibição do remetente efetivo atual abaixo do campo.
2. **Uso do campo em todos os pontos de envio**:
   - `send-invite-email` e `send-appointment-email`: já usam `resolveFromAddress`, passam a não ter domínio fixo — se o campo estiver vazio, o envio falha com mensagem clara ("Configure o domínio de envio em Configurações > Empresa") em vez de usar um domínio de outra empresa.
   - `cadence-dispatcher`: remove o remetente fixo `notificacoes@notifications.dnia.ai` e passa a usar o mesmo resolvedor a partir de `resend_from_email`.
   - O resolvedor de remetente vira um helper único em `_shared/resendCredentials.ts`, usado pelas três funções.
3. **Backfill**: preencher `resend_from_email = 'notifications.dnia.ai'` nas empresas que hoje dependem do valor fixo (empresas com chave Resend salva — atualmente apenas dn.ia), preservando o comportamento atual de envio.

## Detalhes técnicos

- Migration de dados: `UPDATE companies SET resend_from_email = 'notifications.dnia.ai' WHERE resend_api_key IS NOT NULL AND resend_from_email IS NULL`.
- `resolveFromAddress(rawFromEmail, companyName)` movido para `_shared/resendCredentials.ts`; retorna `null` quando não há valor configurado, e cada função retorna erro com código `resend_from_not_configured`.
- Deploy das edge functions `send-invite-email`, `send-appointment-email` e `cadence-dispatcher`.
- Nenhuma alteração de schema (a coluna já existe); apenas dados + frontend + funções.
