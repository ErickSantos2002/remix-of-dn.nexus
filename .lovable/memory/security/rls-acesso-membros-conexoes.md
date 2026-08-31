---
name: RLS acesso membros conexões
description: Membros comuns podem ler conexões Z-API; whatsapp_connections restrito a admins/owners
type: constraint
---

- `zapi_connections` SELECT: super_admin, membros do workspace (via `is_workspace_member`). INSERT/UPDATE/DELETE seguem restritos a admin/owner/super_admin.
- `whatsapp_connections`: leitura e escrita restritas a super_admin, admin/owner do workspace ou dono da empresa.
- Decisão do usuário (2026-07): membros comuns precisam listar/ler conexões Z-API para operar o produto; risco de exposição dos tokens é aceito nesse escopo.
