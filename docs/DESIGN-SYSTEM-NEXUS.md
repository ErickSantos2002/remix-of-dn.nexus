# Aplicação do DS — Nexus AI (dn.nexus)

> Repo: `EngenhariaBucarId/nexus-ai-schema` · Superfície: **SaaS multi-tenant de
> atendimento com IA — inbox, CRM, agentes, dashboards, widgets públicos**
> Stack: React 18 + Vite (SWC) + Tailwind 3.4 + shadcn/ui + Supabase + sync Lovable.
> Status: **V3 aplicado por fases (ago/2026)**, ciente do precedente de reversão do
> dn.dash. Fundação em commits isolados e reversíveis; telas por área.
> Referência canônica: `E:\Projetos\desing-system` — `DESIGN-SYSTEM.md`,
> `IMPLEMENTACAO-V3.md`, `DATAVIZ.md`.

---

## 1. O que está aplicado

- **Tokens V3 completos** em `src/index.css`: primitivos `--dn-*`, semânticos por
  tema, ponte shadcn em HSL portada do DS, `--series-*` / `--viz-*` de dataviz.
- **Dois temas: `dark` (padrão) e `premium`.** No Nexus o claro **é** o premium
  (Neutral Warm) — não existe um `light` neutro. Alternados por `data-theme` via
  next-themes; o toggle já existente na sidebar passou a alternar `dark ↔ premium`.
- **Sora + Space Mono** (Google Fonts, não-bloqueante) + **Video** local só na marca.
  Saíram Inter, Poppins e Rajdhani — de 5 famílias para 3.
- **Botões**: `default` é o CTA gradiente 135° azul→azul-profundo com radius 16px e
  sombra de marca; `destructive` idem em vermelho; `glass`; `outline` vira ghost
  mono hairline; `icon` com 32×32.
- **Campos**: input e select em `rounded-full` com 16px de fonte; textarea em 16px
  de raio (exceção documentada).
- **Abas sublinhadas** com o ativo marcado por três sinais somados (cor, peso, barra
  de 2px). As classes de pill/grid que 10 telas passavam para `TabsList` saíram.
- **Sidebar** com barra azul de 2px no item ativo, header denso `h-12` com blur,
  breadcrumb em mono uppercase.
- **Dataviz** no padrão do `DATAVIZ.md`: slots fixos de série (a série 1 é sempre o
  azul da marca), estado deixou de ser série, grid e eixos recessivos por tema.
- **Primitivos de marca** em `src/components/dn/`: `Pill`, `TabCount`, `EmptyState`.
- **Telas de entrada reformadas** — Login, Register, ResetPassword, AcceptInvite,
  MeetingGate, NotFound e o layout das páginas legais. Saíram o mesh de gradientes
  vermelho+azul do Login e os três radial-gradients do layout legal (o "glow difuso
  salesy" que o V3 veta); entrou a atmosfera oficial `--atmosphere` — dois glows
  **azuis** a 10% e 7%, e `none` no premium. Card do V3 (`.dn-card`), eyebrow mono
  (`.dn-eyebrow`), label de campo mono uppercase (`.dn-field-label`) e o logo da
  marca no lugar do ícone `Bot` genérico. O 404 estava em inglês e foi reescrito.
- **Vermelho separado do azul**: as 50 ocorrências de `accent` fora de
  `components/ui/` foram classificadas — urgência virou `destructive`, informativo e
  estado ativo viraram `primary`, decoração saiu. `accent` ficou só onde o shadcn o
  usa como superfície de hover/seleção.

## 2. Exceções documentadas (não são dívida)

- **`src/pages/MeetingRoom.tsx`** — UI de vídeo sobre fundo claro fixo do Daily.co.
  Superfície de **tema único**; mantém as 24 classes neutras cruas.
- **Cor escolhida pelo usuário** — é dado gravado no banco, não tema:
  paleta de etapa do pipeline (`CRMPipelineSettings.tsx`), cor de categoria de agente
  (`AgentCategories.tsx`), cor de tag (`src/types/tags.ts`), tema do widget de chat
  (`WidgetSettings.tsx`, `components/widget/*`), estilo do widget de agendamento
  (`SchedulingStyleDialog.tsx`), cor de categoria de chat (`components/categories/*`).
- **`components/crm/flows/RichTextEditor.tsx`** e o CSS do preview em
  `FlowNodeConfigDialog.tsx` — e-mail não tem tema; os hex ficam.
- **`components/ui/confetti.tsx`** — `canvas-confetti` pinta em `<canvas>` e não
  resolve `var()`. Hex sincronizados à mão com os primitivos do V3.
- **`src/pages/PublicSchedule.tsx`** — roda em shell isolado, fora do
  `ThemeProvider`, com meta de JS crítico abaixo de 100 KB. Herda o tema dark do
  `:root` e **não carrega Google Fonts** (o `index.html` já pula a fonte nessa rota).
- **Marca de terceiro** — o verde do WhatsApp tem token próprio
  (`--brand-whatsapp`), fora da paleta de tema.

## 3. Pendências conhecidas

- **Padrões de agente e chat (§7 do `IMPLEMENTACAO-V3.md`)** — tool call expansível,
  card de aprovação humana, indicador de contexto do modelo e o tratamento de
  falha/retry ainda não foram implementados no Inbox.
- **Matriz de estados (§6)** — hover, foco, selecionado, desabilitado, carregando,
  vazio, erro recuperável e sem permissão ainda não foram percorridos tela a tela.
- **Responsividade (§10)** — não revalidada em 375/768/1280 depois da migração.
- **`src/components/effects/MatrixRainBackground.tsx`** — 215 linhas de código morto
  (não é importado por nenhum arquivo). O `CLAUDE.md` afirmava ser o fundo do Login;
  não é. Candidato a remoção.
- **Escala DNIA de 6 dimensões** — segue categórica; o `DATAVIZ.md` §3.8 pede um
  matiz em degraus de intensidade por ser ordinal.

## 4. Checklist de PR no Nexus

- [ ] Nenhuma classe de cor crua nova (`bg-red-500`, `text-white`) nem hex novo,
      fora das exceções acima:
      `grep -rnE "(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-[0-9]{2,3}" src --include=*.tsx`
- [ ] Botão novo usa uma variante do `button.tsx`, nunca classe inline duplicada
- [ ] Um CTA preenchido por tela; secundárias em `outline` ou `ghost`
- [ ] Vermelho só em erro, urgência ou ação irreversível
- [ ] Estado ativo marcado por mais de um sinal, nunca só pela cor
- [ ] Status usa `<Pill>`; lista vazia usa `<EmptyState>`
- [ ] Gráfico novo passa pelo checklist do `DATAVIZ.md` §7 — série 1 sempre azul,
      estado nunca é série
- [ ] Testado nos **dois temas** (toggle da sidebar)
- [ ] Nada de emoji na UI — Lucide only
- [ ] `npm run lint`, `npx tsc --noEmit --strict` e `npm run build` passam
