# Liberar Conexões para Membros (somente Google Calendar)

Hoje o item "Conexões" está marcado como `adminOnly`, então Membros não veem o menu. A página em si não tem guarda de rota, e as permissões de banco para a integração de agenda já permitem que um membro do workspace crie/edite/apague a própria conexão do Google Calendar.

## O que muda

1. **Menu lateral** (`Sidebar.tsx` e `CollapsedSidebar.tsx`): o item "Conexões" deixa de ser `adminOnly` e passa a aparecer para Membros também.

2. **Página Conexões** (`Connections.tsx`):
   - Para Membros: apenas a aba **Google Calendar** é exibida, e ela vira a aba padrão (inclusive quando a URL vier com `#official` ou `#zapi`, que serão redirecionados para `#google-calendar`).
   - Para Admin/Owner/Super admin: nada muda (três abas como hoje).
   - Subtítulo da página ajustado para Membros ("Conecte sua agenda do Google").

3. **Bloqueio de conteúdo restrito**: as consultas e blocos de WhatsApp Oficial e Z-API não são renderizados nem executados para Membros, evitando chamadas desnecessárias e exposição de dados de conexões.

## Detalhes técnicos

- Usar `useUserRole()` (já importado em `Connections.tsx`) para derivar `canManageChannels = isAdmin` (admin ou super admin) e também considerar dono do workspace, caso já exista essa informação no contexto; sem isso, admins/owner continuam via `isAdmin`.
- `TabsList` passa de `grid-cols-3` fixo para colunas condicionais; abas `official`/`zapi` só montam quando `canManageChannels`.
- Ajustar o `useEffect`/handler de hash que resolve a aba ativa para forçar `google-calendar` quando o usuário não pode gerenciar canais.
- Nenhuma migration é necessária: as políticas de `crm_google_calendar_integration` já permitem INSERT/UPDATE/DELETE para membros do workspace e SELECT do próprio registro.
- Nenhuma mudança em edge function: `google-calendar-auth` não exige papel de admin.
