# Membros com acesso à aba Z-API (somente leitura + QR Code)

## Objetivo
Além do Google Calendar, membros comuns passam a ver a aba **Z-API** em /connections, apenas para acompanhar o status das instâncias e gerar o QR Code para reconectar o WhatsApp quando a instância cair.

## O que o membro poderá fazer
- Ver a lista de conexões Z-API do workspace com nome da instância, telefone, status (Ativo/Inativo, Conectado/Desconectado), saúde da conexão, pagamento e expiração.
- Abrir o modal de **QR Code** para reconectar uma instância desconectada.
- Abrir o modal de estatísticas da conexão (já disponível hoje sem restrição).

## O que continua restrito a admin/dono/super admin
- Adicionar, editar, excluir conexão.
- Ativar/desativar a conexão (switch permanece desabilitado).
- Editar credenciais, perfil da instância e reconfigurar webhooks.
- Aba WhatsApp Oficial permanece oculta para membros.

## Detalhes técnicos (src/pages/Connections.tsx)
- Introduzir `canViewZapi` (todos os usuários do workspace) separado de `canManageChannels` (admin/dono) e `canManageConnections` (dono/super admin).
- `TabsList`: exibir os gatilhos `zapi` e `google-calendar` para membros (grid de 2 colunas); `official` continua condicionado a `canManageChannels`.
- Ajustar o `useEffect` de redirecionamento de aba: hoje força `google-calendar` quando `!canManageChannels`; passar a permitir também `zapi`, redirecionando apenas quando a aba for `official`.
- Liberar o fetch de conexões Z-API (`canManageChannels` nas dependências/guards das linhas ~352 e ~365) para quando `canViewZapi` for verdadeiro, mantendo o fetch da WhatsApp Oficial restrito.
- Renderizar `TabsContent value="zapi"` para membros; dentro do card, mover o botão de QR Code para fora do bloco `canManageConnections`, mantendo editar/excluir/switch restritos.
- O botão "Adicionar Conexão Z-API" e o estado vazio com CTA permanecem apenas para quem pode gerenciar.
- RLS já permite SELECT em `zapi_connections` para membros do workspace; nenhuma migration é necessária.
