# Plano: API REST + Swagger para Nexus AI

## Contexto

O Nexus AI e uma plataforma SaaS multi-tenant de atendimento ao cliente com IA, CRM, integracao WhatsApp e gestao de conhecimento. Atualmente o sistema opera com 27 Supabase Edge Functions e o frontend acessa o Supabase diretamente via client SDK. A empresa precisa de uma **API REST documentada com Swagger/OpenAPI** para:

- **Publico-alvo**: Integracoes externas (parceiros, clientes enterprise)
- Padronizar o acesso aos dados e operacoes
- Documentacao profissional da API via Swagger UI
- **Abordagem**: Swagger (openapi.yaml) + codigo dos endpoints implementados juntos

---

## Decisoes de Arquitetura

### Autenticacao
- **Bearer Token** via Supabase Auth JWT (usuarios logados)
- **API Key** via tabela `api_keys` (integracoes externas, ja existe pagina `/settings/api-keys`)
- Header: `Authorization: Bearer <token>` ou `X-API-Key: <key>`

### Versionamento
- Prefixo `/api/v1/` em todos os endpoints
- Versionamento por URL (simples, claro)

### Formato de Resposta Padrao
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "per_page": 50, "total": 250 }
}
```
```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }
}
```

### Paginacao
- Query params: `?page=1&per_page=50`
- Default: 50 itens por pagina (consistente com CRM Contacts)

### Filtros
- Query params: `?search=texto&status=active&sort=created_at&order=desc`

### Workspace Isolation
- Header obrigatorio: `X-Workspace-Id: <uuid>` (ou query param `workspace_id`)
- Todos os endpoints filtram por workspace_id

### Swagger/OpenAPI
- Formato: OpenAPI 3.0.3
- Arquivo: `src/docs/openapi.yaml` (YAML para legibilidade)
- UI: Swagger UI servido em `/api/docs` (pode ser pagina React com swagger-ui-react)

---

## Checklist Completo de Endpoints

### 1. AUTH - Autenticacao e Sessao

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 1.1 | POST | `/api/v1/auth/login` | Login com email/senha | Supabase Auth nativo |
| 1.2 | POST | `/api/v1/auth/register` | Registro de novo usuario | Supabase Auth nativo |
| 1.3 | POST | `/api/v1/auth/logout` | Encerrar sessao | Supabase Auth nativo |
| 1.4 | POST | `/api/v1/auth/refresh` | Renovar token JWT | Supabase Auth nativo |
| 1.5 | POST | `/api/v1/auth/reset-password` | Solicitar reset de senha | Supabase Auth nativo |
| 1.6 | GET | `/api/v1/auth/me` | Perfil do usuario autenticado | NOVO |
| 1.7 | PUT | `/api/v1/auth/me` | Atualizar perfil | NOVO |

### 2. COMPANIES - Empresas

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 2.1 | GET | `/api/v1/companies` | Listar empresas do usuario | NOVO |
| 2.2 | GET | `/api/v1/companies/:id` | Detalhes da empresa | NOVO |
| 2.3 | POST | `/api/v1/companies` | Criar empresa | NOVO |
| 2.4 | PUT | `/api/v1/companies/:id` | Atualizar empresa | NOVO |
| 2.5 | DELETE | `/api/v1/companies/:id` | Remover empresa | NOVO |
| 2.6 | GET | `/api/v1/companies/:id/members` | Listar membros | NOVO |
| 2.7 | POST | `/api/v1/companies/:id/members` | Adicionar membro (direto) | `create-user-direct` |
| 2.8 | PUT | `/api/v1/companies/:id/members/:userId` | Alterar role do membro | NOVO |
| 2.9 | DELETE | `/api/v1/companies/:id/members/:userId` | Remover membro | NOVO |
| 2.10 | POST | `/api/v1/companies/:id/invites` | Enviar convite | `send-invite-email` |
| 2.11 | GET | `/api/v1/companies/:id/invites` | Listar convites pendentes | NOVO |
| 2.12 | DELETE | `/api/v1/companies/:id/invites/:inviteId` | Cancelar convite | NOVO |
| 2.13 | POST | `/api/v1/invites/accept` | Aceitar convite | `accept-invite` |
| 2.14 | PUT | `/api/v1/companies/:id/zapi-token` | Configurar Z-API Account Token | NOVO |

### 3. WORKSPACES - Espacos de Trabalho

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 3.1 | GET | `/api/v1/workspaces` | Listar workspaces da empresa | NOVO |
| 3.2 | GET | `/api/v1/workspaces/:id` | Detalhes do workspace | NOVO |
| 3.3 | POST | `/api/v1/workspaces` | Criar workspace | NOVO |
| 3.4 | PUT | `/api/v1/workspaces/:id` | Atualizar workspace | NOVO |
| 3.5 | DELETE | `/api/v1/workspaces/:id` | Remover workspace | NOVO |
| 3.6 | GET | `/api/v1/workspaces/:id/members` | Listar membros do workspace | NOVO |
| 3.7 | POST | `/api/v1/workspaces/:id/members` | Adicionar membro ao workspace | NOVO |
| 3.8 | DELETE | `/api/v1/workspaces/:id/members/:userId` | Remover membro do workspace | NOVO |

### 4. AGENTS - Agentes de IA

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 4.1 | GET | `/api/v1/agents` | Listar agentes (ambas tabelas unificadas) | NOVO |
| 4.2 | GET | `/api/v1/agents/:id` | Detalhes do agente | NOVO |
| 4.3 | POST | `/api/v1/agents` | Criar agente (legacy) | NOVO |
| 4.4 | PUT | `/api/v1/agents/:id` | Atualizar agente | NOVO |
| 4.5 | DELETE | `/api/v1/agents/:id` | Arquivar agente | NOVO |
| 4.6 | POST | `/api/v1/agents/from-template` | Criar agente a partir de template | NOVO |
| 4.7 | GET | `/api/v1/agents/:id/tools` | Listar tools do agente | NOVO |
| 4.8 | PUT | `/api/v1/agents/:id/tools` | Atualizar tools do agente | NOVO |
| 4.9 | GET | `/api/v1/agents/:id/knowledge-bases` | Listar KBs do agente | NOVO |
| 4.10 | PUT | `/api/v1/agents/:id/knowledge-bases` | Vincular KBs ao agente | NOVO |

### 5. AGENT CATEGORIES - Categorias de Agentes

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 5.1 | GET | `/api/v1/agent-categories` | Listar categorias | NOVO |
| 5.2 | POST | `/api/v1/agent-categories` | Criar categoria | NOVO |
| 5.3 | PUT | `/api/v1/agent-categories/:id` | Atualizar categoria | NOVO |
| 5.4 | DELETE | `/api/v1/agent-categories/:id` | Remover categoria | NOVO |

### 6. AGENT TEMPLATES - Templates (Super Admin)

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 6.1 | GET | `/api/v1/agent-templates` | Listar templates disponiveis | NOVO |
| 6.2 | GET | `/api/v1/agent-templates/:id` | Detalhes do template | NOVO |
| 6.3 | POST | `/api/v1/agent-templates` | Criar template (super_admin) | NOVO |
| 6.4 | PUT | `/api/v1/agent-templates/:id` | Atualizar template | NOVO |
| 6.5 | DELETE | `/api/v1/agent-templates/:id` | Remover template | NOVO |

### 7. INBOX - Leads e Mensagens (Chat)

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 7.1 | GET | `/api/v1/inbox/leads` | Listar leads do inbox | NOVO |
| 7.2 | GET | `/api/v1/inbox/leads/:id` | Detalhes do lead (com insights) | NOVO |
| 7.3 | PUT | `/api/v1/inbox/leads/:id` | Atualizar lead (status, notas, tags) | NOVO |
| 7.4 | PUT | `/api/v1/inbox/leads/:id/status` | Alterar status do lead | NOVO |
| 7.5 | POST | `/api/v1/inbox/leads/:id/assign` | Atribuir lead a agente humano | NOVO (usa routing engine) |
| 7.6 | POST | `/api/v1/inbox/leads/:id/transfer` | Transferir lead | NOVO (usa routing engine) |
| 7.7 | POST | `/api/v1/inbox/leads/:id/resolve` | Resolver/encerrar lead | NOVO (usa routing engine) |
| 7.8 | GET | `/api/v1/inbox/leads/:id/messages` | Listar mensagens do lead | NOVO |
| 7.9 | POST | `/api/v1/inbox/leads/:id/messages` | Enviar mensagem (dispara WhatsApp) | `send-to-whatsapp-channel` |
| 7.10 | POST | `/api/v1/inbox/leads/:id/messages/:msgId/transcribe` | Transcrever audio | `transcribe-audio` |
| 7.11 | GET | `/api/v1/inbox/queue` | Fila de leads aguardando | NOVO |
| 7.12 | POST | `/api/v1/inbox/queue/process` | Processar fila de espera | NOVO |

### 8. CRM CONTACTS - Contatos

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 8.1 | GET | `/api/v1/crm/contacts` | Listar contatos (paginado, filtros) | NOVO |
| 8.2 | GET | `/api/v1/crm/contacts/:id` | Detalhes do contato | NOVO |
| 8.3 | POST | `/api/v1/crm/contacts` | Criar contato | NOVO |
| 8.4 | PUT | `/api/v1/crm/contacts/:id` | Atualizar contato | NOVO |
| 8.5 | DELETE | `/api/v1/crm/contacts/:id` | Remover contato (soft delete) | NOVO |
| 8.6 | POST | `/api/v1/crm/contacts/import` | Importar contatos (CSV) | NOVO |
| 8.7 | GET | `/api/v1/crm/contacts/export` | Exportar contatos (CSV) | NOVO |
| 8.8 | PUT | `/api/v1/crm/contacts/:id/tags` | Atualizar tags do contato | NOVO |
| 8.9 | PUT | `/api/v1/crm/contacts/:id/opt-out` | Marcar opt-out | NOVO |
| 8.10 | POST | `/api/v1/crm/contacts/backfill` | AI: Extrair dados de conversas | `backfill-contact-data` |

#### Campo `source` (Origem) - valores aceitos

O campo `source` em `POST /crm/contacts` e `PUT /crm/contacts/:id` aceita apenas os valores listados abaixo. Qualquer outro valor é descartado e substituído pelo fallback `"API - Origem não identificada"`.

**Origens de negócio (selecionáveis pela UI):**
- `Indicação`
- `Tráfego pago`
- `Parceria`
- `Orgânico`

**Origens de sistema (geradas internamente, também aceitas via API):**
- `manual` - criação manual no CRM
- `pipeline` - default ao criar lead pelo pipeline
- `importacao` - importação via CSV
- `widget` - chat widget
- `whatsapp` - Z-API / WhatsApp Official
- `api` - criação via API externa

**Regras:**
- Valor omitido em `POST`: default `"manual"`.
- Valor omitido em `PUT`: campo não é alterado.
- `POST` em contato existente (dedup por telefone/email): `source` é **não-destrutivo** — só grava se o contato ainda não tiver origem definida.
- Valor não reconhecido (qualquer string fora da lista acima): substituído por `"API - Origem não identificada"`.

Fonte única de verdade no frontend: `src/lib/contactSources.ts`.


### 9. CRM PIPELINE - Funil de Vendas

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 9.1 | GET | `/api/v1/crm/pipeline/stages` | Listar estagios do pipeline | NOVO |
| 9.2 | POST | `/api/v1/crm/pipeline/stages` | Criar estagio | NOVO |
| 9.3 | PUT | `/api/v1/crm/pipeline/stages/:id` | Atualizar estagio | NOVO |
| 9.4 | DELETE | `/api/v1/crm/pipeline/stages/:id` | Remover estagio | NOVO |
| 9.5 | PUT | `/api/v1/crm/pipeline/stages/reorder` | Reordenar estagios | NOVO |
| 9.6 | GET | `/api/v1/crm/leads` | Listar leads do CRM (com filtros) | NOVO |
| 9.7 | GET | `/api/v1/crm/leads/:id` | Detalhes do lead CRM | NOVO |
| 9.8 | POST | `/api/v1/crm/leads` | Criar lead CRM | NOVO |
| 9.9 | PUT | `/api/v1/crm/leads/:id` | Atualizar lead CRM | NOVO |
| 9.10 | PUT | `/api/v1/crm/leads/:id/stage` | Mover lead de estagio | NOVO |
| 9.11 | PUT | `/api/v1/crm/leads/:id/assign` | Atribuir responsavel | NOVO |
| 9.12 | GET | `/api/v1/crm/leads/:id/history` | Historico de movimentacoes | NOVO |
| 9.13 | GET | `/api/v1/crm/leads/:id/activities` | Atividades do lead (suporta `?include=call,meeting,transcript`) | NOVO |
| 9.14 | POST | `/api/v1/crm/leads/:id/activities` | Criar atividade | NOVO |
| 9.15 | PUT | `/api/v1/crm/leads/:id/activities/:actId` | Atualizar atividade | NOVO |
| 9.16 | GET | `/api/v1/crm/activities/:id/call` | Dados da ligacao vinculada (URL gravacao, transcricao, analise IA) | NOVO |
| 9.17 | GET | `/api/v1/crm/activities/:id/meeting` | Dados da reuniao vinculada (URL video, transcricao, analise IA, chat) | NOVO |
| 9.18 | GET | `/api/v1/crm/activities/:id/transcript` | Transcricao consolidada (reuniao tem prioridade sobre ligacao) | NOVO |

### 10. CRM PSYCHOLOGY - Analise Psicologica (DNIA)

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 10.1 | GET | `/api/v1/crm/leads/:id/psychology` | Obter analise DNIA do lead | NOVO |
| 10.2 | POST | `/api/v1/crm/leads/:id/psychology/analyze` | Disparar analise IA | `analyze-lead-psychology` |

### 11. CRM PRODUCTS - Produtos

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 11.1 | GET | `/api/v1/crm/products` | Listar produtos | NOVO |
| 11.2 | POST | `/api/v1/crm/products` | Criar produto | NOVO |
| 11.3 | PUT | `/api/v1/crm/products/:id` | Atualizar produto | NOVO |
| 11.4 | DELETE | `/api/v1/crm/products/:id` | Remover produto | NOVO |

### 12. CRM LOSS REASONS - Motivos de Perda

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 12.1 | GET | `/api/v1/crm/loss-reasons` | Listar motivos | NOVO |
| 12.2 | POST | `/api/v1/crm/loss-reasons` | Criar motivo | NOVO |
| 12.3 | PUT | `/api/v1/crm/loss-reasons/:id` | Atualizar motivo | NOVO |
| 12.4 | DELETE | `/api/v1/crm/loss-reasons/:id` | Remover motivo | NOVO |

### 12.b CRM CONTACT SOURCES - Origens do Lead (somente leitura)

Gerenciadas em **Configuracoes > Empresa**. Escopadas por empresa do workspace.

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 12b.1 | GET | `/api/v1/crm/contact-sources` | Listar origens ativas da empresa | NOVO |
| 12b.2 | GET | `/api/v1/crm/contact-sources?include_inactive=true` | Inclui origens desabilitadas | NOVO |



### 13. CRM TAGS - Tags de Contatos

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 13.1 | GET | `/api/v1/crm/tags` | Listar tags unicas do workspace | NOVO |
| 13.2 | PUT | `/api/v1/crm/tags/rename` | Renomear tag em todos os contatos | NOVO |
| 13.3 | DELETE | `/api/v1/crm/tags/:name` | Remover tag de todos os contatos | NOVO |

### 14. CRM AUTOMOVE - Regras de Movimentacao Automatica

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 14.1 | GET | `/api/v1/crm/automove-rules` | Listar regras | NOVO |
| 14.2 | POST | `/api/v1/crm/automove-rules` | Criar regra | NOVO |
| 14.3 | PUT | `/api/v1/crm/automove-rules/:id` | Atualizar regra | NOVO |
| 14.4 | DELETE | `/api/v1/crm/automove-rules/:id` | Remover regra | NOVO |
| 14.5 | GET | `/api/v1/crm/automove-log` | Historico de automove | NOVO |

### 15. APPOINTMENTS - Agendamentos

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 15.1 | GET | `/api/v1/appointments` | Listar agendamentos | NOVO |
| 15.2 | GET | `/api/v1/appointments/:id` | Detalhes do agendamento | NOVO |
| 15.3 | POST | `/api/v1/appointments` | Criar agendamento | `schedule-appointment` |
| 15.4 | PUT | `/api/v1/appointments/:id` | Atualizar agendamento | `schedule-appointment` (reschedule) |
| 15.5 | DELETE | `/api/v1/appointments/:id` | Cancelar agendamento | `schedule-appointment` (cancel) |
| 15.6 | POST | `/api/v1/appointments/:id/attendees` | Adicionar participante | `schedule-appointment` (add_attendee) |
| 15.7 | GET | `/api/v1/appointments/availability` | Verificar disponibilidade | `schedule-appointment` (check) |
| 15.8 | POST | `/api/v1/appointments/:id/sync-calendar` | Sincronizar com Google Calendar | `google-calendar-create-event` |

### 16. GOOGLE CALENDAR - Integracao

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 16.1 | GET | `/api/v1/integrations/google-calendar/auth-url` | Obter URL de autorizacao | `google-calendar-auth` |
| 16.2 | POST | `/api/v1/integrations/google-calendar/callback` | Trocar code por tokens | `google-calendar-auth` |
| 16.3 | GET | `/api/v1/integrations/google-calendar/status` | Status da integracao | NOVO |
| 16.4 | DELETE | `/api/v1/integrations/google-calendar` | Desconectar | NOVO |

### 17. AGENT CALENDARS - Calendarios dos Agentes

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 17.1 | GET | `/api/v1/agent-calendars` | Listar calendarios | NOVO |
| 17.2 | GET | `/api/v1/agent-calendars/:agentId` | Calendario do agente | NOVO |
| 17.3 | PUT | `/api/v1/agent-calendars/:agentId` | Configurar calendario | NOVO |

### 18. KNOWLEDGE BASE - Base de Conhecimento

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 18.1 | GET | `/api/v1/knowledge-bases` | Listar bases | NOVO |
| 18.2 | GET | `/api/v1/knowledge-bases/:id` | Detalhes da base | NOVO |
| 18.3 | POST | `/api/v1/knowledge-bases` | Criar base | NOVO |
| 18.4 | PUT | `/api/v1/knowledge-bases/:id` | Atualizar base | NOVO |
| 18.5 | DELETE | `/api/v1/knowledge-bases/:id` | Remover base | NOVO |
| 18.6 | GET | `/api/v1/knowledge-bases/:id/documents` | Listar documentos/chunks | NOVO |
| 18.7 | POST | `/api/v1/knowledge-bases/:id/documents` | Upload de documento | `parse-document` |
| 18.8 | DELETE | `/api/v1/knowledge-bases/:id/documents/:docId` | Remover documento | NOVO |
| 18.9 | GET | `/api/v1/knowledge-bases/:id/jobs` | Status de processamento | NOVO |
| 18.10 | POST | `/api/v1/knowledge-bases/:id/regenerate-embeddings` | Regenerar embeddings | `regenerate-embeddings` |
| 18.11 | POST | `/api/v1/knowledge-bases/:id/search` | Busca semantica (RAG) | NOVO (usa match_documents) |

### 19. CONNECTIONS - Conexoes WhatsApp

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 19.1 | GET | `/api/v1/connections` | Listar todas as conexoes | NOVO |
| 19.2 | GET | `/api/v1/connections/:id` | Detalhes da conexao | NOVO |
| 19.3 | DELETE | `/api/v1/connections/:id` | Desativar conexao | NOVO |
| 19.4 | GET | `/api/v1/connections/:id/workspaces` | Listar workspaces vinculados | NOVO |
| 19.5 | PUT | `/api/v1/connections/:id/workspaces` | Atualizar workspaces vinculados | NOVO |
| 19.6 | GET | `/api/v1/connections/:id/health` | Metricas de saude | NOVO |

### 20. Z-API CONNECTIONS

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 20.1 | POST | `/api/v1/connections/zapi` | Criar conexao Z-API | NOVO |
| 20.2 | PUT | `/api/v1/connections/zapi/:id` | Atualizar credenciais (super_admin) | NOVO |
| 20.3 | POST | `/api/v1/connections/zapi/validate` | Validar instancia | `zapi-validate-instance` |
| 20.4 | POST | `/api/v1/connections/zapi/validate-token` | Validar account token | `zapi-validate-token` |
| 20.5 | POST | `/api/v1/connections/zapi/:id/revalidate` | Revalidar status | `zapi-validate-instance` |
| 20.6 | POST | `/api/v1/connections/zapi/:id/control` | Controle de instancia (QR, disconnect, profile) | `zapi-instance-control` |
| 20.7 | GET | `/api/v1/connections/zapi/:id/qrcode` | Obter QR code | `zapi-instance-control` |

### 21. WHATSAPP OFFICIAL CONNECTIONS

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 21.1 | POST | `/api/v1/connections/whatsapp` | Criar conexao WhatsApp Official | NOVO |
| 21.2 | PUT | `/api/v1/connections/whatsapp/:id` | Atualizar conexao | NOVO |
| 21.3 | POST | `/api/v1/connections/whatsapp/:id/send` | Enviar mensagem direta | `whatsapp-send` |

### 22. MESSAGING - Envio de Mensagens (Multi-Canal)

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 22.1 | POST | `/api/v1/messages/send` | Enviar mensagem (roteamento automatico) | `send-to-whatsapp-channel` |
| 22.2 | POST | `/api/v1/messages/send-media` | Enviar midia (imagem, audio, video, doc) | `zapi-send` / `whatsapp-send` |

### 23. ROUTING - Configuracao de Roteamento

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 23.1 | GET | `/api/v1/routing/config` | Obter config de roteamento do workspace | NOVO |
| 23.2 | PUT | `/api/v1/routing/config` | Atualizar config de roteamento | NOVO |
| 23.3 | GET | `/api/v1/routing/agent-assignments` | Listar atribuicoes agente-categoria | NOVO |
| 23.4 | PUT | `/api/v1/routing/agent-assignments` | Atualizar atribuicoes | NOVO |

### 24. CHAT CATEGORIES - Categorias de Chat

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 24.1 | GET | `/api/v1/chat-categories` | Listar categorias de chat | NOVO |
| 24.2 | POST | `/api/v1/chat-categories` | Criar categoria | NOVO |
| 24.3 | PUT | `/api/v1/chat-categories/:id` | Atualizar categoria | NOVO |
| 24.4 | DELETE | `/api/v1/chat-categories/:id` | Remover categoria | NOVO |

### 25. AVAILABILITY - Disponibilidade dos Agentes

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 25.1 | GET | `/api/v1/availability` | Listar disponibilidade dos agentes | NOVO |
| 25.2 | PUT | `/api/v1/availability` | Atualizar minha disponibilidade | NOVO |
| 25.3 | GET | `/api/v1/availability/:userId` | Ver disponibilidade de um agente | NOVO |

### 26. NOTIFICATIONS - Notificacoes

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 26.1 | GET | `/api/v1/notifications` | Listar minhas notificacoes | NOVO |
| 26.2 | PUT | `/api/v1/notifications/:id/read` | Marcar como lida | NOVO |
| 26.3 | PUT | `/api/v1/notifications/read-all` | Marcar todas como lidas | NOVO |

### 27. ANALYTICS - Metricas e Relatorios

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 27.1 | GET | `/api/v1/analytics/overview` | KPIs gerais (leads, msgs, taxa conversao) | NOVO |
| 27.2 | GET | `/api/v1/analytics/leads` | Metricas de leads por periodo | NOVO |
| 27.3 | GET | `/api/v1/analytics/messages` | Metricas de mensagens por periodo | NOVO |
| 27.4 | GET | `/api/v1/analytics/agents` | Ranking de agentes | NOVO |
| 27.5 | GET | `/api/v1/analytics/delivery` | Taxas de entrega (anti-ban) | NOVO |
| 27.6 | GET | `/api/v1/analytics/connection-health` | Saude das conexoes | NOVO |

### 28. TOOLS - Catalogo de Ferramentas

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 28.1 | GET | `/api/v1/tools` | Listar ferramentas disponiveis | NOVO |
| 28.2 | GET | `/api/v1/tools/:id` | Detalhes da ferramenta | NOVO |

### 29. WIDGETS - Chat Widget Publico

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 29.1 | GET | `/api/v1/widgets` | Listar widgets do workspace | NOVO |
| 29.2 | POST | `/api/v1/widgets` | Criar widget | NOVO |
| 29.3 | PUT | `/api/v1/widgets/:id` | Atualizar widget | NOVO |
| 29.4 | DELETE | `/api/v1/widgets/:id` | Remover widget | NOVO |
| 29.5 | GET | `/api/v1/public/widgets/:slug` | Config do widget (publico, sem auth) | `widget-chat` (GET) |
| 29.6 | POST | `/api/v1/public/widgets/:slug/sessions` | Criar sessao de chat (publico) | `widget-chat` (POST) |

### 30. WEBHOOKS - Endpoints de Recepcao

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 30.1 | GET | `/api/v1/webhooks/whatsapp` | Verificacao do webhook Meta | `whatsapp-webhook` |
| 30.2 | POST | `/api/v1/webhooks/whatsapp` | Recepcao de mensagens WhatsApp | `whatsapp-webhook` |
| 30.3 | GET | `/api/v1/webhooks/zapi` | Verificacao do webhook Z-API | `zapi-webhook` |
| 30.4 | POST | `/api/v1/webhooks/zapi` | Recepcao de mensagens Z-API | `zapi-webhook` |

### 31. INTERNAL/CRON - Endpoints Internos

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 31.1 | POST | `/api/v1/internal/orchestrator` | Pipeline IA (trigger por DB) | `orchestrator` |
| 31.2 | POST | `/api/v1/internal/cron/health-check` | Cron: Z-API health check | `zapi-health-check` |
| 31.3 | POST | `/api/v1/internal/cron/health-metrics` | Cron: Metricas diarias | `connection-health-metrics` |
| 31.4 | POST | `/api/v1/internal/process-document` | Background: Processar documento | `process-document-background` |
| 31.5 | POST | `/api/v1/internal/process-pdf` | Background: OCR de PDF | `process-pdf-pages` |
| 31.6 | POST | `/api/v1/internal/generate-embeddings` | Background: Gerar embeddings | `generate-embeddings-background` |

### 32. API KEYS - Gerenciamento de Chaves

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 32.1 | GET | `/api/v1/api-keys` | Listar chaves do workspace | NOVO |
| 32.2 | POST | `/api/v1/api-keys` | Criar chave de API | NOVO |
| 32.3 | DELETE | `/api/v1/api-keys/:id` | Revogar chave | NOVO |

### 33. ADMIN - Super Admin

| # | Metodo | Endpoint | Descricao | Edge Function Existente |
|---|--------|----------|-----------|------------------------|
| 33.1 | GET | `/api/v1/admin/companies` | Listar todas as empresas | NOVO |
| 33.2 | GET | `/api/v1/admin/companies/:id` | Detalhes de qualquer empresa | NOVO |
| 33.3 | PUT | `/api/v1/admin/companies/:id` | Editar qualquer empresa | NOVO |
| 33.4 | DELETE | `/api/v1/admin/companies/:id` | Remover empresa | NOVO |
| 33.5 | GET | `/api/v1/admin/users` | Listar todos os usuarios | NOVO |
| 33.6 | PUT | `/api/v1/admin/users/:id/role` | Alterar role global | NOVO |

---

## Resumo Quantitativo

| Dominio | Endpoints | Novos | Existentes (Edge Functions) |
|---------|-----------|-------|-----------------------------|
| Auth | 7 | 7 | 0 (Supabase nativo) |
| Companies | 14 | 10 | 4 |
| Workspaces | 8 | 8 | 0 |
| Agents | 10 | 10 | 0 |
| Agent Categories | 4 | 4 | 0 |
| Agent Templates | 5 | 5 | 0 |
| Inbox (Leads/Messages) | 12 | 10 | 2 |
| CRM Contacts | 10 | 9 | 1 |
| CRM Pipeline | 15 | 15 | 0 |
| CRM Psychology | 2 | 1 | 1 |
| CRM Products | 4 | 4 | 0 |
| CRM Loss Reasons | 4 | 4 | 0 |
| CRM Tags | 3 | 3 | 0 |
| CRM Automove | 5 | 5 | 0 |
| Appointments | 8 | 3 | 5 |
| Google Calendar | 4 | 2 | 2 |
| Agent Calendars | 3 | 3 | 0 |
| Knowledge Base | 11 | 8 | 3 |
| Connections (Geral) | 6 | 6 | 0 |
| Z-API | 7 | 2 | 5 |
| WhatsApp Official | 3 | 2 | 1 |
| Messaging | 2 | 0 | 2 |
| Routing Config | 4 | 4 | 0 |
| Chat Categories | 4 | 4 | 0 |
| Availability | 3 | 3 | 0 |
| Notifications | 3 | 3 | 0 |
| Analytics | 6 | 6 | 0 |
| Tools | 2 | 2 | 0 |
| Widgets | 6 | 4 | 2 |
| Webhooks | 4 | 0 | 4 |
| Internal/Cron | 6 | 0 | 6 |
| API Keys | 3 | 3 | 0 |
| Admin | 6 | 6 | 0 |
| **TOTAL** | **~192** | **~155** | **~37** |

---

## Swagger/OpenAPI - Estrutura do Documento

### Arquivo: `src/docs/openapi.yaml`

```yaml
openapi: 3.0.3
info:
  title: Nexus AI API
  description: API REST para a plataforma Nexus AI de atendimento inteligente
  version: 1.0.0
  contact:
    name: Nexus AI
servers:
  - url: https://nexus-ai-schema.lovable.app/api/v1
    description: Producao
  - url: http://localhost:8080/api/v1
    description: Desenvolvimento
security:
  - BearerAuth: []
  - ApiKeyAuth: []
tags:
  - name: Auth
  - name: Companies
  - name: Workspaces
  - name: Agents
  - name: Agent Categories
  - name: Agent Templates
  - name: Inbox
  - name: CRM Contacts
  - name: CRM Pipeline
  - name: CRM Psychology
  - name: CRM Products
  - name: CRM Loss Reasons
  - name: CRM Tags
  - name: CRM Automove
  - name: Appointments
  - name: Google Calendar
  - name: Agent Calendars
  - name: Knowledge Base
  - name: Connections
  - name: Z-API
  - name: WhatsApp Official
  - name: Messaging
  - name: Routing
  - name: Chat Categories
  - name: Availability
  - name: Notifications
  - name: Analytics
  - name: Tools
  - name: Widgets
  - name: Webhooks
  - name: Internal
  - name: API Keys
  - name: Admin
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
  schemas:
    # ~80 schemas para request/response bodies
  parameters:
    WorkspaceId:
      name: X-Workspace-Id
      in: header
      required: true
      schema:
        type: string
        format: uuid
    Page:
      name: page
      in: query
      schema:
        type: integer
        default: 1
    PerPage:
      name: per_page
      in: query
      schema:
        type: integer
        default: 50
paths:
  # ~192 endpoints documentados
```

### UI do Swagger
- Usar `swagger-ui-react` como componente em `/api/docs`
- Ou servir via `swagger-ui-dist` como pagina estatica

---

## Frontend: Pagina API no Sidebar

Adicionar item **"API"** na secao **Empresa** do sidebar. A pagina `/settings/api` contera:

1. **Gerenciamento de API Keys**
   - Listar chaves existentes (nome, prefixo da chave, data de criacao, ultimo uso)
   - Criar nova chave (nome obrigatorio, permissoes opcionais)
   - Revogar chave (confirmacao com AlertDialog)
   - Copiar chave completa (exibida apenas na criacao)

2. **Link para Swagger UI**
   - Botao/card com link para `/api/docs` (abre em nova aba)
   - Descricao: "Documentacao interativa da API REST"

3. **Informacoes da API**
   - Base URL: `https://nexus-ai-schema.lovable.app/api/v1`
   - Tipo de autenticacao: Bearer JWT ou API Key
   - Header de workspace: `X-Workspace-Id`

---

## Implementacao - Abordagem (Swagger + Codigo Juntos)

### Fase 1: Fundacao
1. Criar `src/docs/openapi.yaml` com a estrutura base (info, servers, security, components)
2. Instalar `swagger-ui-react` e criar pagina `/api/docs`
3. Criar pagina `/settings/api` (ApiSettings.tsx) com gestao de tokens e link Swagger
4. Adicionar item "API" no sidebar na secao "Empresa"
5. Criar edge function `api-gateway/index.ts` com:
   - Router de paths `/api/v1/...`
   - Middleware de autenticacao (Bearer JWT + API Key)
   - Middleware de workspace isolation (header `X-Workspace-Id`)
   - Formato de resposta padronizado (success/error)
   - CORS headers
4. Criar tabela `api_keys` (se nao existir) com rate limiting

### Fase 2: Auth + Empresas + Workspaces (endpoints 1-3)
- Implementar 29 endpoints de Auth, Companies e Workspaces
- Documentar no openapi.yaml com schemas completos
- Reaproveitar edge functions existentes: `accept-invite`, `create-user-direct`, `send-invite-email`

### Fase 3: Agents + Categorias + Templates (endpoints 4-6)
- Implementar 19 endpoints de Agents, Categories e Templates
- Documentar no openapi.yaml

### Fase 4: Inbox + Mensagens (endpoints 7, 22)
- Implementar 14 endpoints de Inbox e Messaging
- Integrar com edge functions: `send-to-whatsapp-channel`, `transcribe-audio`
- Documentar no openapi.yaml

### Fase 5: CRM Completo (endpoints 8-14)
- Implementar 43 endpoints de CRM (Contacts, Pipeline, Psychology, Products, Loss Reasons, Tags, Automove)
- Integrar com: `analyze-lead-psychology`, `backfill-contact-data`
- Documentar no openapi.yaml

### Fase 6: Appointments + Calendar (endpoints 15-17)
- Implementar 15 endpoints
- Integrar com: `schedule-appointment`, `google-calendar-auth`, `google-calendar-create-event`
- Documentar no openapi.yaml

### Fase 7: Knowledge Base (endpoint 18)
- Implementar 11 endpoints
- Integrar com: `parse-document`, `regenerate-embeddings`
- Documentar no openapi.yaml

### Fase 8: Connections + Z-API + WhatsApp (endpoints 19-21)
- Implementar 16 endpoints
- Integrar com: `zapi-validate-instance`, `zapi-validate-token`, `zapi-instance-control`, `whatsapp-send`
- Documentar no openapi.yaml

### Fase 9: Config + Analytics + Restantes (endpoints 23-33)
- Implementar 45 endpoints restantes (Routing, Chat Categories, Availability, Notifications, Analytics, Tools, Widgets, Webhooks, API Keys, Admin)
- Documentar no openapi.yaml

### Fase 10: Validacao Final
- Lint do openapi.yaml com `@redocly/cli`
- Testar todos os endpoints via Swagger UI "Try it out"
- Revisar schemas contra `src/integrations/supabase/types.ts`

---

## Arquivos a Criar/Modificar

| Arquivo | Acao | Fase | Descricao |
|---------|------|------|-----------|
| `src/docs/openapi.yaml` | CRIAR | 1 | Especificacao OpenAPI 3.0.3 (~192 endpoints, ~80 schemas) |
| `src/pages/ApiDocs.tsx` | CRIAR | 1 | Pagina Swagger UI com swagger-ui-react |
| `src/pages/ApiSettings.tsx` | CRIAR | 1 | Pagina de gestao de API Keys + link Swagger (secao Empresa no sidebar) |
| `src/App.tsx` | MODIFICAR | 1 | Adicionar rotas `/settings/api` (protegida) e `/api/docs` (publica) |
| `src/components/layout/Sidebar.tsx` (ou equivalente) | MODIFICAR | 1 | Adicionar item "API" na secao "Empresa" do sidebar |
| `package.json` | MODIFICAR | 1 | Adicionar `swagger-ui-react`, `@types/swagger-ui-react` |
| `supabase/functions/api-gateway/index.ts` | CRIAR | 1 | Edge function gateway (router + auth + workspace isolation) |
| `supabase/functions/api-gateway/router.ts` | CRIAR | 1 | Modulo de roteamento por path/method |
| `supabase/functions/api-gateway/auth.ts` | CRIAR | 1 | Middleware de autenticacao (JWT + API Key) |
| `supabase/functions/api-gateway/handlers/` | CRIAR | 2-9 | Handlers por dominio (auth.ts, companies.ts, agents.ts, etc.) |
| `supabase/migrations/XXXXXX_create_api_keys.sql` | CRIAR | 1 | Tabela api_keys (se nao existir) |

**Nota**: Cada fase adiciona handlers no `api-gateway/handlers/` e endpoints no `openapi.yaml` incrementalmente.

---

## Verificacao

1. Validar `openapi.yaml` com `npx @redocly/cli lint src/docs/openapi.yaml`
2. Verificar que Swagger UI renderiza corretamente em `/api/docs`
3. Testar que todos os endpoints listados correspondem a funcionalidades reais do sistema
4. Revisar schemas contra tipos do `src/integrations/supabase/types.ts`
