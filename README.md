# Remix of <dn.nexus>

Objetivo: Criar todo o schema do banco de dados no Supabase para a aplicação "Nexus AI", incluindo a habilitação da extensão de vetores e a definição de todas as tabelas necessárias para a plataforma multi-tenant.

Gere um script SQL para ser executado em um projeto Supabase.

Este script deve realizar as seguintes ações na ordem especificada:

1.  **Habilitar a extensão `vector`**. É crucial para a funcionalidade de RAG (Retrieval-Augmented Generation).

2.  **Criar a tabela `profiles`**. Esta tabela armazenará dados públicos dos usuários e será vinculada à tabela `auth.users` do Supabase.
    *   `id` (uuid, Chave Primária, referenciando `auth.users.id`)
    *   `email` (text, não nulo)
    *   `name` (text)
    *   `company_name` (text)
    *   `role` (text, com os valores possíveis: 'super_admin', 'admin', 'member')
    *   `created_at` (timestamp com timezone, padrão now())

3.  **Criar a tabela `workspaces`**. Representa os ambientes de trabalho de uma empresa.
    *   `id` (uuid, Chave Primária, padrão `gen_random_uuid()`)
    *   `owner_id` (uuid, Chave Estrangeira referenciando `profiles.id`)
    *   `name` (text, não nulo)
    *   `icon_char` (text, para um ícone simples de caractere, ex: "M")
    *   `created_at` (timestamp com timezone, padrão now())

4.  **Criar a tabela `agents`**. Configurações dos agentes de IA.
    *   `id` (uuid, Chave Primária, padrão `gen_random_uuid()`)
    *   `workspace_id` (uuid, Chave Estrangeira referenciando `workspaces.id`)
    *   `name` (text, não nulo)
    *   `persona_prompt` (text, o prompt de sistema para a IA)
    *   `tone` (text, com valores possíveis: 'friendly', 'professional', 'aggressive')
    *   `is_active` (boolean, padrão `true`)
    *   `is_archived` (boolean, padrão `false`)
    *   `created_at` (timestamp com timezone, padrão now())

5.  **Criar a tabela `leads`**. Os contatos/clientes.
    *   `id` (uuid, Chave Primária, padrão `gen_random_uuid()`)
    *   `workspace_id` (uuid, Chave Estrangeira referenciando `workspaces.id`)
    *   `assigned_agent_id` (uuid, Chave Estrangeira referenciando `agents.id`, pode ser nulo)
    *   `name` (text)
    *   `phone` (text, deve ser único dentro de um workspace)
    *   `status` (text, com valores possíveis: 'new', 'ai_talking', 'needs_human', 'closed')
    *   `ai_summary` (text, resumo gerado pela IA)
    *   `notes` (text, anotações internas)
    *   `last_message_at` (timestamp com timezone)
    *   `created_at` (timestamp com timezone, padrão now())

6.  **Criar a tabela `messages`**. Histórico de chat.
    *   `id` (bigint, Chave Primária, gerado sempre como identidade)
    *   `lead_id` (uuid, Chave Estrangeira referenciando `leads.id`)
    *   `workspace_id` (uuid, Chave Estrangeira referenciando `workspaces.id`)
    *   `content` (text, não nulo)
    *   `sender_type` (text, com valores possíveis: 'ai', 'lead', 'human_agent')
    *   `agent_id` (uuid, Chave Estrangeira referenciando `agents.id`, pode ser nulo)
    *   `created_at` (timestamp com timezone, padrão now())

7.  **Criar a tabela `knowledge_bases`**. Para agrupar fontes de conhecimento do RAG.
    *   `id` (uuid, Chave Primária, padrão `gen_random_uuid()`)
    *   `workspace_id` (uuid, Chave Estrangeira referenciando `workspaces.id`)
    *   `name` (text, não nulo)
    *   `description` (text)
    *   `created_at` (timestamp com timezone, padrão now())

8.  **Criar a tabela `documents`**. Para armazenar os chunks de texto vetorizados.
    *   `id` (bigint, Chave Primária, gerado sempre como identidade)
    *   `knowledge_base_id` (uuid, Chave Estrangeira referenciando `knowledge_bases.id`)
    *   `content` (text, não nulo)
    *   `embedding` (vector(1536), a dimensão do embedding)
    *   `metadata` (jsonb)
    *   `created_at` (timestamp com timezone, padrão now())

Adicione comentários no script SQL para explicar cada bloco de criação de tabela.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/25f348a6-8e29-43b9-ad22-d30f55395ca0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
