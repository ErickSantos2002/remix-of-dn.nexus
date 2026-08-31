# Validação mais rígida do WhatsApp no widget de agendamento

## Objetivo
Impedir que números falsos (ex.: `(31) 99999-9999`, `(11) 91111-1111`, `(11) 912345678`) passem pelo formulário público de agendamento, mantendo a exigência do nono dígito.

## Regras de validação (celular BR, 11 dígitos)
1. DDD válido: precisa estar na lista oficial de DDDs do Brasil (11-19, 21, 22, 24, 27, 28, 31-35, 37, 38, 41-49, 51, 53-55, 61-69, 71, 73-75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91-99). Hoje aceita qualquer 11-99.
2. Nono dígito obrigatório: primeiro dígito após o DDD precisa ser `9` (já existe, mantido).
3. Bloquear dígitos repetidos: os 9 dígitos do número não podem ser todos iguais (`999999999`, `911111111` — quando os 8 finais são idênticos).
4. Bloquear sequências: sequência crescente ou decrescente contínua (`912345678`, `987654321`).
5. Bloquear padrões espelhados/repetidos comuns: números formados pela repetição do mesmo bloco de 4 dígitos após o `9` no formato `9XXXX-XXXX` com as duas metades idênticas (ex.: `1234-1234`).
6. Continuar rejeitando comprimento diferente de 11 dígitos.

## Mensagens de erro
Mensagem única e clara em pt-BR: "Informe um número de WhatsApp válido" e, quando o padrão é claramente fictício, "Este número parece inválido. Informe seu WhatsApp real."

## Onde aplicar
- `src/pages/PublicSchedule.tsx`: substituir a função local `isValidBRPhone` pela validação nova (usada no `onBlur`, no `handleSubmit` e no `disabled` do botão).
- Extrair a lógica para `src/lib/phone.ts` (nova função `isRealBrazilianMobile`) para reuso, sem alterar as funções existentes.
- `supabase/functions/schedule-widget/index.ts`: aplicar a mesma checagem no servidor ao receber `whatsapp` (ações `register-lead` e criação do agendamento), retornando 400 com mensagem amigável. Isso evita que chamadas diretas à função burlem a validação do frontend e criem contatos com telefones falsos (que hoje causam deduplicação errada por telefone).

## Detalhes técnicos
- Validação puramente local (sem chamada externa de operadora).
- A máscara de digitação (`maskBrazilianPhone`) permanece igual.
- Nenhuma migração de banco; dados existentes não são alterados.
