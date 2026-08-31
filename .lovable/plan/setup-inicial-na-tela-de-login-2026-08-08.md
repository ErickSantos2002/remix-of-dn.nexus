# Setup inicial na tela de login

Quando o sistema ainda não tiver nenhum usuário cadastrado, a tela de login exibe um bloco de "Primeiro acesso" com um botão que abre um assistente para criar o administrador, a empresa e o primeiro workspace de uma só vez.

## Comportamento

1. Ao abrir `/login`, o app pergunta ao backend se já existe algum usuário.
2. Se existir, nada muda (tela de login atual).
3. Se não existir, aparece um card destacado "Configurar sistema" com o botão "Criar administrador".
4. O botão abre um modal com um formulário único:
   - Nome do administrador, e-mail, senha e confirmação de senha (mínimo 8 caracteres)
   - Nome da empresa
   - Nome do primeiro workspace (pré-preenchido com "Principal")
5. Ao confirmar, o sistema cria tudo e já loga o novo administrador, redirecionando para a home.
6. Se, no meio do caminho, outro usuário tiver sido criado, a operação é recusada com mensagem clara e a tela volta ao login normal.

## Detalhes técnicos

Nova edge function `bootstrap-admin` (service role, sem JWT), com duas ações:

- `status`: retorna `{ needs_setup: boolean }` — verdadeiro só quando não há nenhuma linha em `profiles` (nem usuários em `auth.users`). Não retorna nenhum dado sensível.
- `setup`: validado com Zod (nome, e-mail, senha mín. 8, nome da empresa, nome do workspace). Fluxo:
  1. Re-checa que não existe usuário — se existir, responde 409 (proteção contra corrida/abuso).
  2. `auth.admin.createUser` com `email_confirm: true`.
  3. Garante o `profiles` (o trigger `handle_new_user` já cria; complementa nome se necessário).
  4. Insere `user_roles` com `super_admin`.
  5. Cria `companies` (owner = novo usuário) e `company_members` como admin/owner.
  6. Cria `workspaces` vinculado à empresa e `workspace_members` como owner.
  7. Em caso de falha após criar o usuário, faz rollback removendo o usuário criado.

Frontend:

- `src/pages/Login.tsx`: consulta `status` no mount (silenciosa, sem travar a tela) e renderiza o card/botão apenas quando `needs_setup` for verdadeiro.
- Novo componente `src/components/auth/FirstSetupDialog.tsx` com o formulário (React Hook Form + Zod), chamando `supabase.functions.invoke("bootstrap-admin")` e, no sucesso, `signInWithPassword` + navegação para `/`.
- UI em pt-BR usando tokens semânticos do design system, sem emojis.
