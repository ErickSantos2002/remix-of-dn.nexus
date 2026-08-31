# Migração do Nexus AI para o DN.IA Design System V3 — Plano de Implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para rastreamento.

**Goal:** Substituir a fundação visual do Nexus AI (tokens, tipografia, primitivos, moldura e gráficos) pelo DN.IA Design System V3, mantendo intactos regras de negócio, dados, permissões, integrações e rotas.

**Architecture:** Fundação em PR único e reversível (tokens + Tailwind + fontes + provider de tema), depois primitivos e moldura, depois telas por área — uma área por PR. A ponte shadcn (`--background`, `--primary`, `--border`…) já existe no V3 e é portada verbatim, de modo que os 51 componentes de `src/components/ui/` e todas as classes Tailwind continuam funcionando sem renomeação.

**Tech Stack:** React 18 · TypeScript · Vite (SWC) · Tailwind CSS 3.4.17 · shadcn/ui · next-themes 0.3.0 · Recharts 2.15.4 · lucide-react · Supabase · sync Lovable

**Spec:**
- `E:\Projetos\desing-system\DESIGN-SYSTEM.md` — fundações (identidade, paleta, tipografia, componentes, do/don't)
- `E:\Projetos\desing-system\IMPLEMENTACAO-V3.md` — rollout em plataforma existente (tokens por tema, primitivos, matriz de estados, padrões de IA, ordem de execução, critérios de aceite)
- `E:\Projetos\desing-system\DATAVIZ.md` — gráficos e visualização de dados
- `E:\Projetos\desing-system\aplicacao\dntask.md` — precedente mais próximo (mesma stack, big-bang bem-sucedido)
- `E:\Projetos\desing-system\aplicacao\dnos.md` — precedente de convergência incremental
- Inventário das 59 telas: https://claude.ai/code/artifact/8226cb8b-2bad-49b2-898d-0a84cade94ad

---

## Global Constraints

- **Temas expostos: `dark` (padrão) e `premium`.** No Nexus, "premium" **é** o tema claro — não existe um `light` neutro separado. O tema `light` do DS não é portado.
- **Tipografia:** Sora (display + body), Space Mono (labels/IDs/status/números técnicos), Video apenas na marca. Saem Inter, Poppins e Rajdhani.
- **Entrega:** fundação (Fases 1–3) em PR único e reversível; telas em PRs separados, um por área.
- **Exceções declaradas** (não são dívida técnica, não corrigir):
  - **Cor escolhida pelo usuário** — paleta de etapas do pipeline (`CRMPipelineSettings.tsx`), cor de tag (`src/types/tags.ts` → `TAG_COLOR_PALETTE`), cor de categoria de agente (`AgentCategories.tsx`), tema do widget de chat (`WidgetSettings.tsx`). São dado gravado no banco, não tema.
  - **`MeetingRoom.tsx`** — superfície de tema único (UI de vídeo). Não adota os tokens; permanece como está.
- **Cores da marca (imutáveis):** azul `#3D61FF` · azul claro `#7D97FF` · azul profundo `#2F4FD1` · vermelho `#E41A11` · verde `#20A878` · âmbar `#C98A16`.
- **Vermelho é semântico.** Só erro, urgência real ou ação irreversível. Nunca decoração, nunca série comum de gráfico.
- **Sem emoji na UI.** Ícones exclusivamente `lucide-react`. (O Nexus já cumpre: 0 emojis em 258 arquivos.)
- **Sem hex cru** fora de `src/index.css` e das exceções acima.
- **Não tocar** em: `src/integrations/supabase/types.ts` (auto-gerado), `supabase/functions/**`, `supabase/migrations/**`, `package-lock.json`, `.lovable/`.
- **Fluxo Lovable:** `git pull` antes de cada tarefa · commits pequenos · **push imediato após cada commit** · o usuário valida em https://nexus-ai-schema.lovable.app. O build local **não** prova o que está em produção.
- **Projeto-alvo em qualquer prompt para o Lovable: Nexus AI** (`nexus-ai-schema`), nunca dn.ia/dnMarketing — são projetos Lovable distintos.

---

## Verificação (este projeto não tem framework de testes)

Não existe Vitest/Jest/Playwright no `nexus-ai-schema`, e nenhum arquivo de teste. O ciclo de verificação de cada tarefa é, portanto:

```bash
npm run lint                 # ESLint — não pode introduzir erro novo
npx tsc --noEmit --strict    # type check real (o tsconfig do projeto é frouxo e o Vite não checa tipos)
npm run build                # o build precisa passar
```

Mais duas verificações específicas desta migração, usadas como "teste" das tarefas de token:

```bash
# AUDITORIA A — cor crua em componentes (deve cair a cada fase; alvo final: só as exceções)
grep -rnE "(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-[0-9]{2,3}" src --include=*.tsx

# AUDITORIA B — hex literal fora do index.css
grep -rnE "#[0-9a-fA-F]{6}\b" src --include=*.tsx
```

**Baseline medida em 2026-08-28 (commit `c06dc39d`):** Auditoria A = 208 ocorrências · Auditoria B = 109 ocorrências · total 317.

Validação visual: após o push, abrir a URL do Lovable e conferir a tela nos **dois temas** pelo toggle da sidebar.

---

## Estrutura de arquivos

**Fundação (Fases 1–3), PR único:**

| Arquivo | Responsabilidade após a migração |
|---|---|
| `src/index.css` | Única fonte de valor visual. Primitivos `--dn-*`, semânticos por tema (`:root` = dark, `[data-theme="premium"]` = claro), ponte shadcn em HSL, `--series-*`/`--viz-*`, classes `.dn-*` e as classes legadas do Nexus reparametrizadas. |
| `tailwind.config.ts` | `darkMode` por seletor de atributo, `fontFamily` Sora/Space Mono, cores `dn-*`, `boxShadow` de marca. Preserva as escalas primitivas `--color-*` já usadas por `badge-grade` e `temp-*`. |
| `index.html` | Carrega Sora + Space Mono do Google Fonts; remove Inter, Poppins e Rajdhani. Fontes Video seguem locais em `public/design_system/fonts/`. |
| `src/App.tsx` | `ThemeProvider` com `attribute="data-theme"`, `themes={["dark","premium"]}`, `defaultTheme="dark"`. |
| `src/components/layout/Sidebar.tsx`, `CollapsedSidebar.tsx` | Toggle de tema passa a alternar `dark` ↔ `premium`. |
| `src/components/ui/*.tsx` | Primitivos recebem as formas do V3 (raios, variantes de botão, input pill, aba sublinhada, pill de status, menu de contexto). |
| `src/components/layout/*.tsx` | Moldura: sidebar ativa com barra azul de 2px, header denso, breadcrumb mono. |

**Telas (Fase 5), um PR por área:** `src/pages/**` e os componentes de feature da mesma área.

---

## Fase 0 — Blindar a semântica do vermelho

### Task 1: Traduzir `accent` → `destructive` antes de qualquer troca de token

O Nexus usa `--accent` como **vermelho da marca**; o V3 usa `--accent` como **azul**. Trocar os tokens sem esta tarefa deixaria os avisos de urgência azuis sem quebrar o build — falha silenciosa.

Hoje `--accent: 4 87% 48%` e `--destructive: 4 87% 48%` são **valores idênticos**, e `--accent-foreground` e `--destructive-foreground` também (`0 0% 100%`). Logo, esta tarefa é **pixel-idêntica** em produção: nada muda visualmente, só o nome do token.

**Files:**
- Modify: `src/pages/Inbox.tsx` (10 ocorrências), `src/pages/Analytics.tsx` (8), `src/pages/CRMPipeline.tsx` (4), `src/pages/LeadPsychology.tsx` (2), `src/pages/ToolsCatalog.tsx` (2), `src/pages/Agents.tsx` (1)
- Modify: demais ocorrências fora de `src/components/ui/` reveladas pelo grep do passo 1

**Interfaces:**
- Produz: um app onde `accent` só aparece em `src/components/ui/` (superfície de hover do shadcn) e onde todo vermelho semântico está em `destructive`. A Task 2 depende disso para poder trocar `--accent` para azul com segurança.

- [ ] **Passo 1: Listar todas as ocorrências fora de `ui/`**

```bash
grep -rnE '\b(bg|text|border|ring)-accent(-foreground)?(/[0-9]+)?\b' src/pages src/components --include=*.tsx \
  | grep -v '^src/components/ui/' > /tmp/accent-map.txt
wc -l /tmp/accent-map.txt   # esperado: 72
cat /tmp/accent-map.txt
```

- [ ] **Passo 2: Classificar cada ocorrência em uma das três categorias**

Percorrer `/tmp/accent-map.txt` e marcar cada linha:

- **URGÊNCIA** → trocar `accent` por `destructive`. Casos conhecidos: badge `needs_human` ("ATENÇÃO") em `Inbox.tsx:124`, etapa quente do pipeline em `CRMPipeline.tsx:181-182`, divisor e chip de aviso em `Inbox.tsx:3107-3109`.
- **ESTADO ATIVO DE NAVEGAÇÃO** → trocar por `primary`. Caso conhecido: sub-abas do CRM em `Analytics.tsx:398,407,416,425` (`bg-accent text-accent-foreground shadow-md`). Estado ativo de navegação é azul no V3, nunca vermelho. A forma de aba sublinhada vem depois, na Task 9.
- **DECORAÇÃO** → remover a cor, deixando o elemento em `text-muted-foreground` ou `text-foreground` conforme o contexto. Caso conhecido: ícone `MessageSquare` em `Agents.tsx:1736`.

- [ ] **Passo 3: Aplicar as trocas de URGÊNCIA**

Exemplo real, `src/pages/Inbox.tsx:124`:

```tsx
// antes
needs_human: { label: "ATENÇÃO", className: "bg-accent/20 text-accent border-accent/30" },
// depois
needs_human: { label: "ATENÇÃO", className: "bg-destructive/20 text-destructive border-destructive/30" },
```

Exemplo real, `src/pages/CRMPipeline.tsx:181-182`:

```tsx
// antes
colorClass: "text-accent",
badgeClass: "bg-accent/20 text-accent border-accent/30"
// depois
colorClass: "text-destructive",
badgeClass: "bg-destructive/20 text-destructive border-destructive/30"
```

- [ ] **Passo 4: Aplicar as trocas de ESTADO ATIVO**

`src/pages/Analytics.tsx`, nas quatro sub-abas:

```tsx
// antes
crmSubTab === "pipeline" ? "bg-accent text-accent-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
// depois
crmSubTab === "pipeline" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
```

Repetir para `"cohort"`, `"pains"` e `"objections"`.

- [ ] **Passo 5: Aplicar as remoções de DECORAÇÃO**

`src/pages/Agents.tsx:1736`:

```tsx
// antes
<MessageSquare className="h-3.5 w-3.5 text-accent" />
// depois
<MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
```

- [ ] **Passo 6: Verificar que sobrou zero `accent` fora de `ui/`**

```bash
grep -rnE '\b(bg|text|border|ring)-accent(-foreground)?(/[0-9]+)?\b' src/pages src/components --include=*.tsx \
  | grep -v '^src/components/ui/'
```
Esperado: **nenhuma saída**.

- [ ] **Passo 7: Build e lint**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
```
Esperado: os três passam.

- [ ] **Passo 8: Commit e push**

```bash
git pull
git add src/pages src/components
git commit -m "refactor(ds): move vermelho semantico de accent para destructive

Prepara a troca de tokens do DS V3, onde --accent passa a ser azul.
Hoje --accent e --destructive tem o mesmo valor, entao a mudanca e
visualmente identica em producao.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Passo 9: Validação visual**

Abrir https://nexus-ai-schema.lovable.app no Inbox, no Pipeline e no Analytics. **Nada pode ter mudado de aparência.** Se algo mudou, uma ocorrência foi classificada errado.

---

## Fase 1 — Fundação de tema (PR único, reversível)

As Tasks 2 a 5 formam **um só commit**. Só há verificação visual válida com as quatro aplicadas: trocar os tokens sem trocar as fontes, ou trocar o provider sem os tokens, deixa o app em estado inconsistente.

### Task 2: Portar os tokens do V3 para `src/index.css`

**Files:**
- Modify: `src/index.css` — bloco `@layer base` inteiro (linhas 66 a ~365 do arquivo atual: o `:root` light, o `.dark` e a base de elementos)

**Interfaces:**
- Consome: paleta primitiva `--color-*` já presente no arquivo (linhas 70–160), que **permanece** — é usada por `.badge-grade-*` e pelos tokens `--temp-*`.
- Produz: `:root` = tema dark; `[data-theme="premium"]` = tema claro; ponte shadcn nos dois; `--series-1..5`, `--series-ref`, `--chart-grid`, `--chart-axis`, `--viz-*` (consumidos pela Task 14); `--dn-radius-sm|md|lg` (consumidos pelas Tasks 6–12).

- [ ] **Passo 1: Inserir os primitivos do V3 no topo do `:root`**

Logo após a abertura de `:root {`, antes do comentário `PRIMITIVE TOKENS (Core Values)`:

```css
    /* ─────────────────────────────────────────
       DN.IA V3 — PRIMITIVOS
       Fonte: E:\Projetos\desing-system\src\index.css
       ───────────────────────────────────────── */
    --dn-blue: #3d61ff;
    --dn-blue-light: #7d97ff;
    --dn-blue-deep: #2f4fd1;
    --dn-red: #e41a11;
    --dn-green: #20a878;
    --dn-amber: #c98a16;

    --dn-dark-950: #04070f;
    --dn-dark-900: #060a14;
    --dn-dark-850: #0b1120;
    --dn-dark-800: #111a2b;
    --dn-dark-750: #18243a;
    --dn-dark-text: #f0f4ff;
    --dn-dark-muted: #a8b3c7;
    --dn-dark-subtle: #748198;

    --dn-warm-50: #fcfbf8;
    --dn-warm-100: #f7f5f0;
    --dn-warm-200: #eeeae2;
    --dn-warm-300: #ddd8ce;
    --dn-warm-900: #17191d;
    --dn-warm-muted: #686a70;

    --dn-radius-sm: 8px;
    --dn-radius-md: 12px;
    --dn-radius-lg: 16px;
    --dn-ease: cubic-bezier(0.16, 1, 0.3, 1);

    --font-display: "Sora", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
    --font-body: "Sora", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
    --font-mono: "Space Mono", "JetBrains Mono", ui-monospace, monospace;
    --font-brand: "Video", "Sora", sans-serif;
```

- [ ] **Passo 2: Substituir o bloco semântico do `:root` — de light para dark**

O `:root` atual (a partir de `--background: 0 0% 100%`, linha ~178) define o tema **claro**. Ele é substituído inteiro pelo tema **dark** do V3. Trocar da linha `/* Backgrounds */` até o fechamento do `:root` por:

```css
    /* ─────────────────────────────────────────
       TEMA DARK — padrão (V3)
       ───────────────────────────────────────── */
    --canvas: var(--dn-dark-950);
    --section-bg: var(--dn-dark-900);
    --surface: var(--dn-dark-800);
    --surface-raised: var(--dn-dark-850);
    --surface-hover: var(--dn-dark-750);
    --line: rgba(210, 220, 255, 0.16);
    --line-strong: rgba(210, 220, 255, 0.28);
    --text: var(--dn-dark-text);
    --muted-ink: var(--dn-dark-muted);
    --subtle: var(--dn-dark-subtle);
    --accent-ink: var(--dn-blue-light);
    --shadow-card: 0 16px 42px rgba(8, 12, 24, 0.45);
    --card-radius: var(--dn-radius-md);
    --card-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);

    /* Glass (V3: mais contido que o do Nexus — 3%/8%/12px) */
    --glass-bg: rgba(255, 255, 255, 0.03);
    --glass-border: rgba(255, 255, 255, 0.08);
    --glass-blur: 12px;

    /* Marca (gradientes decorativos existentes) */
    --brand-primary: #de1a11;
    --brand-accent: #3d61ff;

    /* Temperatura do lead — escala ordinal, mantida */
    --temp-hot: var(--color-red-500);
    --temp-warm: var(--color-yellow-500);
    --temp-cool: var(--color-cyan-500);
    --temp-cold: var(--color-blue-500);

    /* Dataviz — DARK, validado sobre #04070F (DATAVIZ.md §1.1) */
    --series-1: var(--dn-blue);
    --series-2: #db2777;
    --series-3: #0891b2;
    --series-4: #8b5cf6;
    --series-5: #ea580c;
    --series-ref: #5c6070;
    --chart-grid: rgba(210, 220, 255, 0.08);
    --chart-axis: var(--dn-dark-subtle);
    --viz-area-top: 0.22;
    --viz-halo: 0.14;
    --viz-bar-fade: 0.28;
    --viz-donut-glow: drop-shadow(0 0 16px rgba(61, 97, 255, 0.2));

    /* Ponte shadcn — DARK (portada verbatim do DS) */
    --background: 222 55% 5%;
    --foreground: 225 100% 97%;
    --card: 222 43% 11%;
    --card-foreground: 225 100% 97%;
    --popover: 222 43% 11%;
    --popover-foreground: 225 100% 97%;
    --primary: 229 100% 62%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 36% 15%;
    --secondary-foreground: 225 100% 97%;
    --muted: 220 36% 15%;
    --muted-foreground: 220 15% 72%;
    --accent: 229 100% 62%;
    --accent-foreground: 0 0% 100%;
    --destructive: 4 87% 48%;
    --destructive-foreground: 0 0% 100%;
    --success: 159 68% 39%;
    --success-foreground: 0 0% 100%;
    --warning: 39 80% 44%;
    --warning-foreground: 0 0% 100%;
    --border: 220 40% 22%;
    --input: 220 40% 22%;
    --ring: 229 100% 62%;
    --radius: 0.75rem;

    /* Sidebar — dark */
    --sidebar-background: 222 47% 8%;
    --sidebar-foreground: 225 100% 97%;
    --sidebar-primary: 229 100% 62%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 220 36% 15%;
    --sidebar-accent-foreground: 225 100% 97%;
    --sidebar-border: 220 40% 22%;
    --sidebar-ring: 229 100% 62%;
  }
```

> `--success` e `--warning` não existem na ponte do DS (que usa `--dn-green`/`--dn-amber`). Como o Nexus já os consome, eles são mantidos e reapontados para os valores do V3: `#20A878` = `162 68% 39%`, `#C98A16` = `41 80% 44%`.

- [ ] **Passo 3: Substituir o bloco `.dark` pelo bloco `[data-theme="premium"]`**

O bloco `.dark { … }` (linha ~244) é removido e substituído por:

```css
  /* Alias explícito: next-themes estampa data-theme="dark" no tema padrão */
  [data-theme="dark"] {
    color-scheme: dark;
  }

  /* ─────────────────────────────────────────
     TEMA PREMIUM — o "claro" do Nexus (Neutral Warm)
     ───────────────────────────────────────── */
  [data-theme="premium"] {
    color-scheme: light;

    --canvas: var(--dn-warm-50);
    --section-bg: var(--dn-warm-100);
    --surface: #ffffff;
    --surface-raised: #ffffff;
    --surface-hover: var(--dn-warm-100);
    --line: rgba(221, 216, 206, 0.65);
    --line-strong: var(--dn-warm-300);
    --text: var(--dn-warm-900);
    --muted-ink: var(--dn-warm-muted);
    --subtle: #8a8c92;
    --accent-ink: var(--dn-blue-deep);
    --shadow-card: 0 24px 64px rgba(23, 25, 29, 0.07), 0 2px 8px rgba(23, 25, 29, 0.04);
    --card-radius: var(--dn-radius-lg);
    --card-highlight: none;

    /* Verde e âmbar escurecem para manter AA sobre fundo claro */
    --dn-green: #14795a;
    --dn-amber: #8a5d0a;

    /* Glass no claro: superfície branca translúcida, não branco a 3% */
    --glass-bg: rgba(255, 255, 255, 0.72);
    --glass-border: rgba(221, 216, 206, 0.65);
    --glass-blur: 12px;

    /* Dataviz — LIGHT/PREMIUM, validado sobre #FCFBF8 (DATAVIZ.md §1.1) */
    --series-1: var(--dn-blue-deep);
    --series-2: #be185d;
    --series-3: #0891b2;
    --series-4: #7c3aed;
    --series-5: #c2410c;
    --series-ref: #9b968b;
    --chart-grid: rgba(23, 25, 29, 0.08);
    --chart-axis: #8a8c92;
    --viz-area-top: 0;
    --viz-halo: 0;
    --viz-bar-fade: 1;
    --viz-donut-glow: none;

    /* Ponte shadcn — PREMIUM (portada verbatim do DS) */
    --background: 40 33% 98%;
    --foreground: 225 12% 10%;
    --card: 0 0% 100%;
    --card-foreground: 225 12% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 225 12% 10%;
    --primary: 229 100% 62%;
    --primary-foreground: 0 0% 100%;
    --secondary: 38 24% 96%;
    --secondary-foreground: 225 12% 10%;
    --muted: 38 24% 96%;
    --muted-foreground: 225 6% 42%;
    --accent: 229 100% 62%;
    --accent-foreground: 0 0% 100%;
    --destructive: 4 87% 48%;
    --destructive-foreground: 0 0% 100%;
    --success: 162 71% 27%;
    --success-foreground: 0 0% 100%;
    --warning: 39 87% 29%;
    --warning-foreground: 0 0% 100%;
    --border: 36 22% 88%;
    --input: 36 22% 88%;
    --ring: 229 100% 62%;
    --radius: 1rem;

    /* Sidebar — premium */
    --sidebar-background: 38 24% 96%;
    --sidebar-foreground: 225 12% 10%;
    --sidebar-primary: 229 100% 62%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 40 33% 98%;
    --sidebar-accent-foreground: 225 12% 10%;
    --sidebar-border: 36 22% 88%;
    --sidebar-ring: 229 100% 62%;
  }
```

- [ ] **Passo 4: Atualizar a base de elementos**

No `@layer base` seguinte (onde hoje está `* { @apply border-border; }`), substituir as regras de `body` e adicionar as de tipografia e foco:

```css
  body {
    font-family: var(--font-body);
    background: var(--canvas);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    transition: background-color 300ms var(--dn-ease), color 300ms var(--dn-ease);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  code, pre {
    font-family: var(--font-mono);
  }
  ::selection {
    background: var(--dn-blue);
    color: #fff;
  }
  :focus-visible {
    outline: 2px solid var(--dn-blue);
    outline-offset: 2px;
    border-radius: 4px;
  }
```

- [ ] **Passo 5: Reapontar `.font-display` e `.font-mono`**

Nas linhas ~327–338, as classes utilitárias passam a usar os tokens:

```css
  .font-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .font-display {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
```

- [ ] **Passo 6: Verificar que nenhum bloco `.dark` sobrou**

```bash
grep -n "\.dark" src/index.css
```
Esperado: **nenhuma saída**.

- [ ] **Passo 7: Verificar que a paleta primitiva `--color-*` continua intacta**

```bash
grep -c -- "--color-" src/index.css
```
Esperado: ≥ 84 (as escalas blue/red/neutral/yellow/green/purple/cyan permanecem — `.badge-grade-*` e `--temp-*` dependem delas).

### Task 3: Ajustar `tailwind.config.ts`

**Files:**
- Modify: `tailwind.config.ts` (207 linhas)

**Interfaces:**
- Consome: tokens definidos na Task 2.
- Produz: utilitários `font-display`/`font-body`/`font-mono`, classes de cor `dn-blue`/`dn-red`/`dn-green`/`dn-amber`/`dn-dark-*`/`dn-warm-*`, e o seletor de dark mode que faz as 5 ocorrências de `dark:` continuarem funcionando.

- [ ] **Passo 1: Trocar o seletor de dark mode**

```ts
// linha 4 — antes
darkMode: ["class"],
// depois
darkMode: ["selector", '[data-theme="dark"]'],
```

> Tailwind 3.4.17 suporta a estratégia `selector`. Existem apenas 5 usos de `dark:` no projeto (`Inbox.tsx` ×2, `ui/chart.tsx`, `ui/alert.tsx`), então o risco é mínimo — mas eles precisam continuar funcionando.

- [ ] **Passo 2: Trocar `fontFamily`**

```ts
// linhas 21-25 — antes
fontFamily: {
  sans: ["Poppins", "Inter", "system-ui", "sans-serif"],
  display: ["Video", "Rajdhani", "sans-serif"],
  mono: ["JetBrains Mono", "monospace"],
},
// depois
fontFamily: {
  sans: ["Sora", "Plus Jakarta Sans", "system-ui", "sans-serif"],
  body: ["Sora", "Plus Jakarta Sans", "system-ui", "sans-serif"],
  display: ["Sora", "Plus Jakarta Sans", "sans-serif"],
  mono: ["Space Mono", "JetBrains Mono", "monospace"],
  brand: ["Video", "Sora", "sans-serif"],
},
```

- [ ] **Passo 3: Adicionar as cores `dn-*` dentro de `colors`**

Inserir ao final do objeto `colors` (antes do seu fechamento, por volta da linha 174):

```ts
        "dn-dark": {
          950: "#04070F", 900: "#060A14", 850: "#0B1120", 800: "#111A2B", 750: "#18243A",
        },
        "dn-warm": {
          50: "#FCFBF8", 100: "#F7F5F0", 200: "#EEEAE2", 300: "#DDD8CE", 900: "#17191D",
        },
        "dn-blue": { DEFAULT: "#3D61FF", light: "#7D97FF", deep: "#2F4FD1" },
        "dn-red": "#E41A11",
        "dn-green": "#20A878",
        "dn-amber": "#C98A16",
```

- [ ] **Passo 4: Adicionar `boxShadow` de marca**

Após o bloco `borderRadius` (linha ~179):

```ts
      boxShadow: {
        brand: "0 10px 28px rgba(61, 97, 255, 0.22)",
        "brand-hover": "0 14px 36px rgba(61, 97, 255, 0.38)",
        danger: "0 10px 28px rgba(228, 26, 17, 0.22)",
        card: "0 16px 42px rgba(8, 12, 24, 0.45)",
      },
```

- [ ] **Passo 5: Verificar que as 5 ocorrências de `dark:` não quebraram**

```bash
grep -rn "dark:" src --include=*.tsx
```
Esperado: 5 linhas em `Inbox.tsx` (2), `ui/chart.tsx` (1), `ui/alert.tsx` (1). Nenhuma alteração de código aqui — só conferência de que o seletor cobre esses casos.

### Task 4: Trocar as fontes carregadas

**Files:**
- Modify: `index.html` (linha 51 e vizinhança — carregamento não-bloqueante do Google Fonts)

**Interfaces:**
- Consome: `--font-display`/`--font-body`/`--font-mono` da Task 2.
- Produz: Sora e Space Mono disponíveis; Video segue local via `@font-face` no `index.css`.

- [ ] **Passo 1: Trocar a URL do Google Fonts**

```js
// index.html, linha 51 — antes
var href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@400;500;600;700&family=Rajdhani:wght@400;500;600;700&display=swap';
// depois
var href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap';
```

- [ ] **Passo 2: Conferir que os `@font-face` da Video seguem intactos**

```bash
grep -c "font-family: 'Video'" src/index.css
```
Esperado: 5 (Bold, SemiBold, Medium, Regular, Light). Nenhuma alteração.

- [ ] **Passo 3: Buscar referências residuais às fontes removidas**

```bash
grep -rn "Poppins\|Rajdhani\|'Inter'\|\"Inter\"" src index.html --include=*.tsx --include=*.css --include=*.html
```
Esperado: nenhuma saída. Se houver, trocar por `var(--font-body)` / `var(--font-display)`.

### Task 5: Trocar o provider de tema e os toggles

**Files:**
- Modify: `src/App.tsx:103`
- Modify: `src/components/layout/Sidebar.tsx:122,326`
- Modify: `src/components/layout/CollapsedSidebar.tsx:91,226`
- Modify: `src/components/ui/sonner.tsx:7`

**Interfaces:**
- Consome: `[data-theme="premium"]` da Task 2 e o `darkMode` da Task 3.
- Produz: atributo `data-theme` no `<html>` com valor `dark` ou `premium`; toggle funcional nas duas sidebars.

- [ ] **Passo 1: Trocar o `ThemeProvider`**

```tsx
// src/App.tsx:103 — antes
<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
// depois
<ThemeProvider
  attribute="data-theme"
  defaultTheme="dark"
  themes={["dark", "premium"]}
  enableSystem={false}
  disableTransitionOnChange
>
```

- [ ] **Passo 2: Trocar o toggle da `Sidebar`**

```tsx
// src/components/layout/Sidebar.tsx:326 — antes
onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
// depois
onClick={() => setTheme(theme === "dark" ? "premium" : "dark")}
```

Conferir o ícone e o rótulo ao redor da linha 326: se disserem "Modo claro"/"Modo escuro", o texto continua correto — premium **é** o claro do Nexus. Ícones `Sun`/`Moon` do Lucide permanecem.

- [ ] **Passo 3: Trocar o toggle da `CollapsedSidebar`**

```tsx
// src/components/layout/CollapsedSidebar.tsx:226 — antes
onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
// depois
onClick={() => setTheme(theme === "dark" ? "premium" : "dark")}
```

- [ ] **Passo 4: Ajustar o `sonner`**

```tsx
// src/components/ui/sonner.tsx:7 — antes
const { theme = "system" } = useTheme();
// depois
const { theme = "dark" } = useTheme();
```

E, na prop passada ao `<Sonner theme={…}>`, mapear `premium` para `light`, que é o único valor que a lib entende:

```tsx
theme={theme === "premium" ? "light" : "dark"}
```

- [ ] **Passo 5: Verificar que `"light"` não sobrou como valor de tema**

```bash
grep -rn 'setTheme("light")\|theme === "light"\|defaultTheme="light"' src --include=*.tsx
```
Esperado: nenhuma saída.

- [ ] **Passo 6: Build, lint e type check da fundação inteira**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
```
Esperado: os três passam.

- [ ] **Passo 7: Commit único da fundação e push**

```bash
git pull
git add src/index.css tailwind.config.ts index.html src/App.tsx src/components/layout/Sidebar.tsx src/components/layout/CollapsedSidebar.tsx src/components/ui/sonner.tsx
git commit -m "feat(ds): funda o Nexus no DN.IA Design System V3

- Tokens V3 em src/index.css: :root = dark, [data-theme=premium] = claro
- Ponte shadcn portada verbatim do DS, por tema
- Tokens de dataviz --series-*/--viz-* por tema
- Tipografia Sora + Space Mono; saem Inter, Poppins e Rajdhani
- next-themes passa a usar data-theme com os temas dark e premium
- Tailwind: darkMode por seletor de atributo, cores dn-*, sombras de marca

Reversivel em um unico revert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Passo 8: Validação visual da fundação**

Na URL do Lovable, percorrer Inbox, Pipeline, Analytics, Conexões e Configurações da empresa **nos dois temas**. O que se espera:
- Fundo azul-marinho profundo (`#04070F`) no dark, warm (`#FCFBF8`) no premium.
- Toda a tipografia em Sora.
- Nenhum texto ilegível, nenhum card invisível.

Problemas de contraste pontuais são esperados e serão tratados nas fases seguintes. **Se a leitura geral estiver quebrada, `git revert` deste commit** — é exatamente para isso que ele é único.

---

## Fase 2 — Primitivos

### Task 6: Variantes de botão do V3

**Files:**
- Modify: `src/components/ui/button.tsx:7-30`

**Interfaces:**
- Produz: variantes `default` (CTA gradiente), `glass`, `outline` (ghost mono), `destructive`, `secondary`, `ghost`, `link`; tamanhos com altura 32–44px.

- [ ] **Passo 1: Reescrever `buttonVariants`**

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-[16px] font-semibold text-white bg-[linear-gradient(135deg,var(--dn-blue),var(--dn-blue-deep))] shadow-brand hover:-translate-y-0.5 hover:brightness-110 hover:shadow-brand-hover active:translate-y-0",
        destructive:
          "rounded-[16px] font-semibold text-white bg-[linear-gradient(135deg,var(--dn-red),#a3120d)] shadow-danger hover:-translate-y-0.5 hover:brightness-110",
        glass:
          "rounded-[16px] font-semibold text-foreground bg-white/[0.04] border border-primary/35 backdrop-blur-[12px] hover:bg-white/[0.07] hover:border-primary/60",
        outline:
          "rounded-[16px] font-mono text-xs uppercase tracking-[0.16em] font-bold border border-[var(--line-strong)] bg-transparent text-foreground hover:border-[var(--accent-ink)] hover:-translate-y-0.5",
        secondary:
          "rounded-[16px] bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "rounded-[12px] hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-3",
        sm: "h-9 px-4 text-[0.8rem]",
        lg: "h-12 px-8",
        icon: "h-8 w-8 rounded-[8px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

- [ ] **Passo 2: Acabamento claro do CTA (sem glow colorido no premium)**

Adicionar ao `src/index.css`, dentro de `@layer components`:

```css
  /* V3: glow colorido é exclusivo do dark; no premium a sombra é neutra */
  [data-theme="premium"] .shadow-brand,
  [data-theme="premium"] .shadow-danger {
    box-shadow: 0 16px 40px rgba(23, 25, 29, 0.14), 0 2px 6px rgba(23, 25, 29, 0.06);
  }
  [data-theme="premium"] .hover\:shadow-brand-hover:hover {
    box-shadow: 0 16px 40px rgba(23, 25, 29, 0.18), 0 2px 6px rgba(23, 25, 29, 0.08);
  }
  [data-theme="premium"] .hover\:brightness-110:hover {
    filter: none;
  }
```

- [ ] **Passo 3: Conferir o impacto**

```bash
grep -rc "from \"@/components/ui/button\"" src --include=*.tsx | grep -v ":0" | wc -l
```
Anotar o número de arquivos afetados. Nenhuma edição neles — a mudança é toda na variante.

- [ ] **Passo 4: Build + validação visual**

```bash
npm run lint && npm run build
```
Depois do push, conferir nos dois temas: um CTA gradiente por tela, `outline` em mono uppercase, `icon` com 32×32.

- [ ] **Passo 5: Commit e push**

```bash
git pull && git add src/components/ui/button.tsx src/index.css
git commit -m "feat(ds): variantes de botao do V3 (CTA gradiente, glass, ghost mono)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 7: Campos de formulário — pill e 16px

**Files:**
- Modify: `src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`

**Interfaces:**
- Produz: inputs `rounded-full` com `text-base` (16px, evita zoom no iOS); textarea `rounded-xl` (exceção documentada — pill em caixa multilinha corta texto).

- [ ] **Passo 1: `input.tsx` — trocar a classe base**

```tsx
// antes
"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background ..."
// depois
"flex h-11 w-full rounded-full border border-input bg-background px-5 py-2 text-base ring-offset-background ..."
```

- [ ] **Passo 2: `textarea.tsx` — raio 16px, não pill**

```tsx
// antes
"flex min-h-[80px] w-full rounded-md border border-input ..."
// depois
"flex min-h-[80px] w-full rounded-[16px] border border-input px-4 py-3 text-base ..."
```

- [ ] **Passo 3: `select.tsx` — trigger em pill**

No `SelectTrigger`, trocar `rounded-md` por `rounded-full` e `h-10` por `h-11`. O `SelectContent` mantém `rounded-md` (dropdown não é campo).

- [ ] **Passo 4: Verificar que nenhum campo ficou com fonte abaixo de 16px**

```bash
grep -rn "text-sm" src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx
```
Esperado: nenhuma saída no elemento de entrada em si.

- [ ] **Passo 5: Build, commit e push**

```bash
npm run lint && npm run build
git pull && git add src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx
git commit -m "feat(ds): campos em pill com 16px (V3)

textarea fica em rounded-xl — excecao documentada: pill corta texto multilinha.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 8: Card, badge e pill de status

**Files:**
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/index.css` (bloco `.glass-card`, linhas ~340–355, e os `.badge-*` legados)
- Create: `src/components/dn/Pill.tsx`

**Interfaces:**
- Produz: `<Pill status="live|info|success|warning|danger" solid? showDot? />` — consumido pelas telas na Fase 5 para status padronizado (§7.2 do guia).

- [ ] **Passo 1: `card.tsx` — raio por token**

```tsx
// antes
"rounded-lg border bg-card text-card-foreground shadow-sm"
// depois
"rounded-[var(--card-radius)] border bg-card text-card-foreground shadow-[var(--card-highlight)]"
```

- [ ] **Passo 2: `.glass-card` — raio do V3**

Em `src/index.css`, no bloco `.glass-card` (linha ~340), trocar `border-radius: var(--radius);` por `border-radius: var(--card-radius);`. Os valores de `--glass-bg`/`--glass-border`/`--glass-blur` já foram trocados na Task 2, então os 288 usos em 86 arquivos migram sem tocar em nenhum deles.

- [ ] **Passo 3: Criar o componente `Pill`**

```tsx
// src/components/dn/Pill.tsx
import { cn } from "@/lib/utils";

type PillStatus = "live" | "info" | "success" | "warning" | "danger" | "neutral";

const STATUS_CLASS: Record<PillStatus, string> = {
  live: "text-[var(--dn-blue-light)] bg-primary/10 border-primary/35",
  info: "text-primary bg-primary/10 border-primary/30",
  success: "text-[var(--dn-green)] bg-[var(--dn-green)]/10 border-[var(--dn-green)]/30",
  warning: "text-[var(--dn-amber)] bg-[var(--dn-amber)]/10 border-[var(--dn-amber)]/30",
  danger: "text-destructive bg-destructive/10 border-destructive/30",
  neutral: "text-muted-foreground bg-muted border-border",
};

const SOLID_CLASS: Record<PillStatus, string> = {
  live: "bg-primary text-white border-transparent",
  info: "bg-primary text-white border-transparent",
  success: "bg-[var(--dn-green)] text-white border-transparent",
  warning: "bg-[var(--dn-amber)] text-white border-transparent",
  danger: "bg-destructive text-white border-transparent",
  neutral: "bg-muted-foreground text-background border-transparent",
};

interface PillProps {
  status?: PillStatus;
  solid?: boolean;
  showDot?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Pill({ status = "neutral", solid, showDot, className, children }: PillProps) {
  const dot = showDot ?? status === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em]",
        solid ? SOLID_CLASS[status] : STATUS_CLASS[status],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            status === "live" && "motion-safe:animate-pulse",
          )}
        />
      )}
      {children}
    </span>
  );
}
```

- [ ] **Passo 4: Alinhar os `.badge-*` legados aos tokens**

Em `src/index.css`, `.badge-accent` (linha ~595) hoje aponta para o vermelho via `--accent`. Como `--accent` virou azul, renomear semanticamente:

```css
  .badge-accent {
    /* mantido pelo nome para não quebrar consumidores; agora é o azul do V3 */
    background: hsl(var(--primary) / 0.15);
    color: hsl(var(--primary));
    border: 1px solid hsl(var(--primary) / 0.3);
  }
  .badge-danger {
    background: hsl(var(--destructive) / 0.15);
    color: hsl(var(--destructive));
    border: 1px solid hsl(var(--destructive) / 0.3);
  }
```

- [ ] **Passo 5: Verificar quem usa `badge-accent`**

```bash
grep -rn "badge-accent" src --include=*.tsx
```
Para cada ocorrência, decidir se o sentido é azul (fica) ou urgência (troca para `badge-danger`).

- [ ] **Passo 6: Build, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/components/ui/card.tsx src/components/ui/badge.tsx src/components/dn/Pill.tsx src/index.css
git commit -m "feat(ds): card por token, pill de status do V3 e badges alinhados

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 9: Abas sublinhadas

**Files:**
- Modify: `src/components/ui/tabs.tsx`
- Create: `src/components/dn/TabCount.tsx`

**Interfaces:**
- Produz: `TabsList`/`TabsTrigger` no formato sublinhado; `<TabCount value={n} />` que não renderiza nada quando `n === 0` e mostra `99+` acima de 99.
- Consumidores conhecidos: `CompanySettings.tsx` (14), `Analytics.tsx` (12), `Connections.tsx` (10), `WidgetSettings.tsx` (8), `TeamSettings.tsx` (8), `AutomoveRules.tsx` (8), `Inbox.tsx` (7), `CRMAppointments.tsx` (7), `Widgets.tsx`, `CRMCadences.tsx`.

- [ ] **Passo 1: Reescrever `TabsList` e `TabsTrigger`**

```tsx
const TabsList = React.forwardRef<...>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-6 border-b border-[var(--line)] text-muted-foreground",
      className,
    )}
    {...props}
  />
));

const TabsTrigger = React.forwardRef<...>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent py-2.5 text-sm font-medium transition-colors",
      "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:border-[var(--accent-ink)] data-[state=active]:text-[var(--accent-ink)] data-[state=active]:font-semibold",
      "[&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
```

- [ ] **Passo 2: Dar respiro ao conteúdo**

Em `TabsContent`, garantir `mt-6` na classe base (24px abaixo da linha, conforme a especificação).

- [ ] **Passo 3: Criar `TabCount`**

```tsx
// src/components/dn/TabCount.tsx
export function TabCount({ value }: { value: number }) {
  if (!value) return null; // zero não vira badge
  return (
    <span className="rounded-[8px] bg-primary/12 px-1.5 py-0.5 font-mono text-[0.625rem] font-bold text-[var(--accent-ink)]">
      {value > 99 ? "99+" : value}
    </span>
  );
}
```

- [ ] **Passo 4: Procurar `TabsList` com classes de pill que precisam sair**

```bash
grep -rn "TabsList className=" src --include=*.tsx | head -30
```
Onde houver `bg-muted`, `rounded-lg`, `p-1` ou similar na `TabsList`, remover a classe — a forma agora vem do primitivo. Não alterar a lógica de abas.

- [ ] **Passo 5: Build, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/components/ui/tabs.tsx src/components/dn/TabCount.tsx src/pages src/components
git commit -m "feat(ds): abas sublinhadas do V3 e TabCount

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 10: Menu de contexto e estados de carga

**Files:**
- Modify: `src/components/ui/dropdown-menu.tsx`
- Modify: `src/components/ui/skeleton.tsx`
- Create: `src/components/dn/EmptyState.tsx`

**Interfaces:**
- Produz: `<EmptyState icon={LucideIcon} title description action? />` — consumido pelas telas na Fase 5.

- [ ] **Passo 1: `dropdown-menu.tsx` — espaçamento de ícone por margem**

No `DropdownMenuItem`, garantir na classe base:

```tsx
"[&>svg]:size-4 [&>svg]:shrink-0 [&>svg:first-child]:mr-2"
```

Não usar `gap-2` no item: os consumidores já escrevem `mr-2` à mão nos ícones, e `gap` somaria com essa margem.

- [ ] **Passo 2: `skeleton.tsx` — pulso de baixo contraste**

```tsx
// antes
"animate-pulse rounded-md bg-muted"
// depois
"motion-safe:animate-pulse rounded-[8px] bg-muted/60"
```

- [ ] **Passo 3: Criar `EmptyState`**

```tsx
// src/components/dn/EmptyState.tsx
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10">
        <Icon className="h-5 w-5 text-[var(--accent-ink)]" />
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="max-w-[42ch] text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
```

- [ ] **Passo 4: Build, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/components/ui/dropdown-menu.tsx src/components/ui/skeleton.tsx src/components/dn/EmptyState.tsx
git commit -m "feat(ds): menu de contexto, skeleton e empty state do V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

## Fase 3 — Moldura

### Task 11: Sidebar, header e breadcrumbs

**Files:**
- Modify: `src/components/layout/Sidebar.tsx` (item ativo)
- Modify: `src/components/layout/CollapsedSidebar.tsx` (item ativo)
- Modify: `src/components/layout/GlobalHeader.tsx` (altura e blur)
- Modify: `src/components/layout/MobileHeader.tsx`
- Modify: `src/components/layout/Breadcrumbs.tsx` (mono pequeno)
- Modify: `src/components/layout/AppLayout.tsx` (se necessário para a altura do header)

**Interfaces:**
- Consome: tokens da Task 2, primitivos das Tasks 6–10.
- Produz: a moldura que aparece em todas as rotas autenticadas.

- [ ] **Passo 1: Item ativo da sidebar — três sinais somados**

Localizar a classe do item ativo (`Sidebar.tsx`, próximo à renderização dos links de navegação) e aplicar o padrão canonizado no DS a partir do dn.os:

```tsx
// item ativo
"relative bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
```

Cor, peso e barra — nunca só a cor.

- [ ] **Passo 2: Repetir na `CollapsedSidebar`**

Mesmo padrão, com a barra à esquerda do ícone.

- [ ] **Passo 3: Header denso**

Em `GlobalHeader.tsx`, garantir altura `h-12` e fundo com blur:

```tsx
"h-12 border-b border-[var(--line)] bg-card/30 backdrop-blur"
```

- [ ] **Passo 4: Breadcrumb em mono**

Em `Breadcrumbs.tsx`, aplicar ao container:

```tsx
"font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground"
```

- [ ] **Passo 5: Conferir mobile**

`MobileHeader.tsx` e a navegação inferior: toque mínimo de 32px em ícone e 40px em controle principal.

- [ ] **Passo 6: Build, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/components/layout
git commit -m "feat(ds): moldura do V3 (sidebar ativa, header denso, breadcrumb mono)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Passo 7: Validação visual da fundação completa**

Percorrer 5 rotas nos dois temas. A partir daqui, o app já deve **parecer** DN.IA V3 — as fases seguintes corrigem tela a tela.

---

## Fase 4 — Dataviz

### Task 12: Migrar os gráficos para `--series-*`

**Files:**
- Modify: `src/components/ui/chart.tsx`
- Modify: `src/pages/Analytics.tsx`
- Modify: `src/components/analytics/PainsObjectionsTab.tsx`, `SalesCycleCard.tsx`, `WhatsAppHealthTab.tsx`
- Modify: `src/components/performance/ScoreEvolutionChart.tsx`
- Modify: `src/components/connections/ZapiStatsModal.tsx`
- Modify: `src/components/crm/cadences/CadenceOverviewDialog.tsx`

**Interfaces:**
- Consome: `--series-1..5`, `--series-ref`, `--chart-grid`, `--chart-axis` da Task 2.
- Produz: gráficos que trocam de paleta sozinhos com o `data-theme`.

- [ ] **Passo 1: Mapear os usos atuais**

```bash
grep -rn "chart-[1-5]" src --include=*.tsx --include=*.css
```
Esperado: 36 ocorrências (chart-1 ×2, chart-2 ×17, chart-3 ×6, chart-4 ×9, chart-5 ×2).

- [ ] **Passo 2: Substituir os tokens, preservando a ordem dos slots**

`--chart-1` → `--series-1`, `--chart-2` → `--series-2`, e assim por diante. **Slots são fixos:** a primeira série de qualquer gráfico é sempre `--series-1` (azul da marca). Filtrar uma série não reordena as cores.

- [ ] **Passo 3: Separar estado de série**

Percorrer cada gráfico e verificar: onde verde/âmbar/vermelho aparecem representando **uma série** (ex.: "leads perdidos" como série vermelha), trocar por um slot `--series-*`. Verde, âmbar e vermelho ficam reservados para **estado** (bom / atenção / problema), sempre com ícone ou rótulo junto.

- [ ] **Passo 4: Grid e eixos recessivos**

Em cada `<CartesianGrid>` e `<XAxis>/<YAxis>`:

```tsx
<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
<XAxis stroke="var(--chart-axis)" tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
```

- [ ] **Passo 5: Escala DNIA — ordinal, não categórica**

Em `LeadPsychology.tsx`, as 6 dimensões formam uma escala **ordinal**. Não usar 6 matizes diferentes: usar um matiz (azul) em degraus de intensidade, conforme DATAVIZ §3.8. Mesma regra vale para o funil do pipeline.

- [ ] **Passo 6: Legenda obrigatória com 2+ séries**

Conferir gráfico a gráfico: com duas ou mais séries, precisa de `<Legend />`.

- [ ] **Passo 7: Conferir os dois temas**

Cada gráfico precisa ser lido nos dois temas. Os tokens trocam sozinhos; o que pode quebrar é cor cru remanescente.

```bash
grep -rnE "#[0-9a-fA-F]{6}" src/components/analytics src/components/performance src/pages/Analytics.tsx
```
Esperado: nenhuma saída.

- [ ] **Passo 8: Build, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/components/ui/chart.tsx src/components/analytics src/components/performance src/components/connections src/components/crm/cadences src/pages/Analytics.tsx
git commit -m "feat(ds): dataviz no padrao DATAVIZ.md (series validadas, estado != serie)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

## Fase 5 — Telas, um PR por área

### Procedimento padrão de migração de tela

Este procedimento vale para **todas** as tarefas da Fase 5. Cada tarefa abaixo cita as particularidades da sua área; o roteiro é este:

1. `git pull`.
2. Rodar as duas auditorias **restritas aos arquivos da área** e anotar a contagem inicial.
3. Para cada ocorrência da Auditoria A (classe Tailwind crua):
   - cor de superfície → `bg-background` / `bg-card` / `bg-muted`;
   - cor de texto → `text-foreground` / `text-muted-foreground`;
   - cor de borda → `border-border`;
   - **estado** (bom/atenção/problema) → `text-[var(--dn-green)]` / `text-[var(--dn-amber)]` / `text-destructive`, sempre sobre tint `/10` do mesmo token e **sempre com ícone Lucide ou rótulo junto**;
   - se for uma das exceções declaradas nas Global Constraints, deixar como está e adicionar um comentário `// exceção DS: cor é dado do usuário` na linha.
4. Para cada ocorrência da Auditoria B (hex literal): mesma regra.
5. Substituir status ad-hoc por `<Pill status="…">` e listas vazias por `<EmptyState>`.
6. Conferir a matriz de estados do §6 na tela: default, hover, foco por teclado, ativo, selecionado, desabilitado, carregando, vazio, erro recuperável, sucesso, sem permissão, mobile.
7. `npm run lint && npx tsc --noEmit --strict && npm run build`.
8. Commit com escopo da área + push.
9. Validar na URL do Lovable **nos dois temas**.

### Task 13: Superfícies públicas

Primeiro, porque é o que o cliente final vê.

**Files:** `src/pages/PublicSchedule.tsx`, `MeetingGate.tsx`, `Login.tsx`, `Register.tsx`, `ResetPassword.tsx`, `AcceptInvite.tsx`, `LegalPrivacyPolicy.tsx`, `src/components/legal/LegalPageLayout.tsx`

- [ ] **Passo 1: Aplicar o procedimento padrão nos arquivos acima**
- [ ] **Passo 2: `PublicSchedule.tsx` — orçamento de bytes**

Esta rota roda em shell isolado (`PublicScheduleShell` em `App.tsx:96`), **fora do `ThemeProvider`**, com meta de JS crítico abaixo de 100 KB. Duas consequências:
- ela não responde ao `data-theme`: fixar o tema premium com `data-theme="premium"` no elemento raiz da página;
- medir o bundle antes e depois:

```bash
npm run build
ls -la dist/assets/ | grep -i "publicschedule\|index"
```
Se as fontes empurrarem a rota acima do orçamento, carregar Sora com `&text=` (subset) apenas nesta página ou manter a fonte de sistema aqui.

- [ ] **Passo 3: Páginas legais — leitura a 640px**

`LegalPageLayout.tsx` passa a limitar a coluna de leitura: `max-w-[640px]`. As 5 páginas legais herdam.

- [ ] **Passo 4: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/PublicSchedule.tsx src/pages/MeetingGate.tsx src/pages/Login.tsx src/pages/Register.tsx src/pages/ResetPassword.tsx src/pages/AcceptInvite.tsx src/pages/Legal*.tsx src/components/legal
git commit -m "feat(ds): superficies publicas no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 14: Inbox e padrões de agente

A tela mais afetada do app (3.572 linhas) e a que mais aproxima o Nexus da família DN.IA.

**Files:** `src/pages/Inbox.tsx`, `src/components/chat/*.tsx` (13 arquivos), `src/components/simulation/*.tsx` (2)

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: Aplicar o §7.1 do guia de implementação**

- **Mensagem humana:** bolha à direita, superfície elevada, **sem gradiente chamativo**. Conferir `.chat-bubble-lead` em `src/index.css:612`.
- **Mensagem do agente:** à esquerda, com avatar, nome, especialidade opcional e timestamp. Conferir `.chat-bubble-ai` em `src/index.css:616`.
- **Tool call:** ferramenta, estado, duração e resultado resumido, expansível.
- **Falha/retry:** linguagem clara, data/hora e retry quando seguro — aplicável à re-transcrição de áudio, que já existe.
- **Presença do agente:** `.agent-indicator` (linha 621) mantém o dot pulsante, mas **só com atividade real** (§12).

- [ ] **Passo 3: Status do lead com `<Pill>`**

O ciclo `new → ai_talking → needs_human → human_talking → closed` passa a usar `<Pill>` com o mapa do §7.2: verde = concluído/online, azul = em andamento, âmbar = atenção, vermelho = erro/bloqueado, neutro = pendente. `needs_human` é **âmbar** (requer acompanhamento), não vermelho — vermelho fica para falha real de entrega.

- [ ] **Passo 4: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/Inbox.tsx src/components/chat src/components/simulation
git commit -m "feat(ds): Inbox e padroes de agente do V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 15: CRM — pipeline, contatos e compromissos

**Files:** `src/pages/CRMPipeline.tsx`, `CRMContacts.tsx`, `CRMAppointments.tsx`, `src/components/crm/**` (46 arquivos, 54 ocorrências da Auditoria A), `src/components/appointments/**` (4 arquivos, 10 ocorrências)

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: `CRMContacts.tsx` — tabela operacional do §5.4**

Cabeçalho em mono 10–12px uppercase, dado principal destacado, identificador em mono, hover azul a 5%, coluna prioritária fixa, secundárias somem em tablet/mobile, ações de linha em menu de contexto.

- [ ] **Passo 3: `CRMPipeline.tsx` — cor de etapa é dado**

As cores de etapa vêm de `crm_pipeline_stages` e são escolhidas em `CRMPipelineSettings.tsx`. **Não converter para token.** Marcar com comentário de exceção. A temperatura do lead continua em `--temp-*` (escala ordinal legítima).

- [ ] **Passo 4: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/CRM*.tsx src/components/crm src/components/appointments
git commit -m "feat(ds): CRM (pipeline, contatos, compromissos) no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 16: Agentes e conexões

**Files:** `src/pages/Agents.tsx`, `AgentsProntos.tsx`, `AgentCategories.tsx`, `AgentToolsSettings.tsx`, `AgentAvailability.tsx`, `Connections.tsx`, `src/components/agents/**` (3), `src/components/connections/**` (4), `src/components/zapi/**` (1)

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: `AgentCategories.tsx` — 12 hex são dado**

A paleta de categoria é escolhida pelo usuário. Marcar como exceção, não converter.

- [ ] **Passo 3: `Connections.tsx` — 20 `glass-card`**

Nenhuma edição de classe necessária: a receita já mudou na Task 2. Conferir apenas se o resultado no premium está legível.

- [ ] **Passo 4: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/Agent*.tsx src/pages/Connections.tsx src/components/agents src/components/connections src/components/zapi
git commit -m "feat(ds): agentes e conexoes no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 17: Analytics e desempenho

**Files:** `src/pages/Analytics.tsx`, `LeadPsychology.tsx`, `CrmPerformance.tsx`, `src/components/analytics/**` (6), `src/components/performance/**` (9)

Depende da Task 12 (dataviz) já concluída.

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: KPIs em uma linha, agrupados por objetivo (§9.3)**

Cada gráfico em superfície elevada; âmbar para atenção em custo; vermelho é exceção. Small multiples quando as escalas divergirem — nunca dual axis.

- [ ] **Passo 3: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/Analytics.tsx src/pages/LeadPsychology.tsx src/pages/CrmPerformance.tsx src/components/analytics src/components/performance
git commit -m "feat(ds): analytics e desempenho no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 18: Configurações do CRM

**Files:** `src/pages/CRMPipelineSettings.tsx`, `CRMProductsSettings.tsx`, `CRMTagsSettings.tsx`, `AutomoveRules.tsx`, `CRMGoogleCalendarSettings.tsx`, `CRMAgentCalendarSettings.tsx`, `CRMCadences.tsx`, `CRMFlows.tsx`, `CRMFlowBuilder.tsx`, `src/components/crm/flows/**`, `src/components/crm/cadences/**`

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: Exceções desta área**

`CRMPipelineSettings.tsx` (11 hex) e `CRMTagsSettings.tsx` + `src/types/tags.ts` (`TAG_COLOR_PALETTE`) são cor-como-dado. Marcar, não converter.

- [ ] **Passo 3: Formulários longos — matriz de estados**

`AutomoveRules.tsx` e `CRMFlowBuilder.tsx` são os formulários mais densos do app. Aplicar o §5.2: label acima do campo, foco com outline azul de 2px, erro com **ícone `AlertTriangle` + texto explicativo** (nunca só borda vermelha), `aria-invalid` e `aria-describedby`.

- [ ] **Passo 4: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages/CRM*.tsx src/pages/AutomoveRules.tsx src/components/crm/flows src/components/crm/cadences
git commit -m "feat(ds): configuracoes do CRM no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

### Task 19: Configurações gerais, widgets e admin

**Files:** `src/pages/CompanySettings.tsx`, `CompanySendingWindow.tsx`, `TeamSettings.tsx`, `WorkspacesSettings.tsx`, `RoutingConfig.tsx`, `ApiKeys.tsx`, `ChatCategories.tsx`, `ToolsCatalog.tsx`, `MeetingSettings.tsx`, `DataPrivacy.tsx`, `WhatsAppTemplates.tsx`, `Widgets.tsx`, `WidgetSettings.tsx`, `SchedulingWidgets.tsx`, `SchedulingWidgetHistory.tsx`, `AdminCompanies.tsx`, `AdminTemplates.tsx`, `AdminNotificationsTest.tsx`, `Knowledge.tsx`, `ProductDocs.tsx`, `ApiDocs.tsx`, `NotFound.tsx`, `src/components/settings/**` (19), `src/components/team/**` (5), `src/components/widget/**` (13), `src/components/categories/**` (2)

- [ ] **Passo 1: Aplicar o procedimento padrão**
- [ ] **Passo 2: `WidgetSettings.tsx` — tema do widget é dado do cliente**

As cores editadas aqui configuram o widget público do cliente. Não converter. Opcionalmente, oferecer a paleta V3 como **sugestão** no seletor.

- [ ] **Passo 3: `DataPrivacy.tsx` — modal destrutivo do §5.5**

Anonimizar e excluir são irreversíveis: o modal cita a consequência e a irreversibilidade, e o botão destrutivo **não** é o foco padrão.

- [ ] **Passo 4: `AdminCompanies.tsx` — sem primitivos hoje**

Esta página não importa nenhum componente de `ui/`. Ao migrar, substituir o layout próprio pelos primitivos (Card, Table, Button), em vez de reestilizar o HTML solto.

- [ ] **Passo 5: Verificação, commit e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add src/pages src/components/settings src/components/team src/components/widget src/components/categories
git commit -m "feat(ds): configuracoes gerais, widgets e admin no V3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

## Fase 6 — Fechamento

### Task 20: Auditoria final, acessibilidade e documentação

**Files:**
- Modify: `CLAUDE.md` (seção "Design System Rules")
- Create: `docs/DESIGN-SYSTEM-NEXUS.md` (guia de aplicação, no formato de `aplicacao/*.md` do DS)

- [ ] **Passo 1: Rodar as duas auditorias no projeto inteiro**

```bash
grep -rnE "(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-[0-9]{2,3}" src --include=*.tsx
grep -rnE "#[0-9a-fA-F]{6}\b" src --include=*.tsx
```
Esperado: apenas as exceções declaradas (cor-como-dado e `MeetingRoom.tsx`). Baseline era 317 ocorrências.

- [ ] **Passo 2: Conferir que não entrou emoji**

```bash
grep -rlP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' src --include=*.tsx
```
Esperado: nenhuma saída (a baseline já era zero).

- [ ] **Passo 3: Responsividade (§10)**

Percorrer no navegador, em 375px, 768px e 1280px, as cinco telas mais densas (Inbox, Pipeline, Contatos, Analytics, Conexões) e conferir:
- **≤767px** — sidebar em drawer ou barra inferior; ações secundárias em menu de contexto; tabela mantém a coluna principal e abre o detalhe em drawer; gráficos em uma coluna com tooltip ao toque; o chat alterna lista/conversa com composer fixo; modal vira bottom sheet.
- **768–1023px** — grid de duas colunas, filtros em drawer; reduzir densidade antes de reduzir a tipografia.
- **≥1024px** — container de 1200–1320px; painéis operacionais podem ser full-bleed preservando colunas mínimas legíveis.

Corrigir o que quebrar; abrir tarefa separada se a correção for grande.

- [ ] **Passo 4: Acessibilidade — foco visível**

```bash
grep -rn "outline-none" src --include=*.tsx | grep -v "focus-visible:ring"
```
Toda ocorrência de `outline-none` precisa ter um substituto de foco. Corrigir as que não tiverem.

- [ ] **Passo 5: Atualizar o `CLAUDE.md`**

Substituir a seção "Design System Rules" pelas regras do V3: temas `dark`/`premium` por `data-theme`, Sora + Space Mono, raios 8/12/16 + input pill, vermelho semântico, um CTA por dobra, `--series-*` em gráficos, exceções declaradas. Corrigir também a afirmação desatualizada de que o Matrix rain é o fundo do Login — o componente `src/components/effects/MatrixRainBackground.tsx` não é importado por nenhum arquivo.

- [ ] **Passo 6: Escrever o guia de aplicação do Nexus**

Criar `docs/DESIGN-SYSTEM-NEXUS.md` no formato dos guias de `aplicacao/` do DS, com: o que está aplicado, as exceções documentadas (cor-como-dado, MeetingRoom, PublicSchedule) e o checklist de PR. Oferecer ao usuário levá-lo para `E:\Projetos\desing-system\aplicacao\nexus.md`, para que o Nexus passe a constar no DS como os outros produtos.

- [ ] **Passo 7: Decidir sobre o código morto**

`src/components/effects/MatrixRainBackground.tsx` (215 linhas) não é importado em lugar nenhum. Confirmar com o usuário antes de remover.

- [ ] **Passo 8: Commit final e push**

```bash
npm run lint && npx tsc --noEmit --strict && npm run build
git pull && git add CLAUDE.md docs/DESIGN-SYSTEM-NEXUS.md
git commit -m "docs(ds): registra as regras do V3 no Nexus e as excecoes declaradas

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Passo 9: Publicar em produção**

O sync do Lovable traz o código, mas a publicação é um passo separado. Entregar ao usuário o prompt para colar no editor do **Nexus AI** (não no dn.ia/dnMarketing):

````
```
---
Gere o build do Nexus AI com o Design System V3 aplicado.

O codigo ja esta no repositorio GitHub (commit XXXXXXX).
Depois do build, publique via Share > Publish.
---
```
````

---

## Critérios de aceite (do §15 do guia)

- [ ] Nenhuma página usa cor, borda, sombra, raio ou tipografia fora dos tokens — exceto as exceções declaradas.
- [ ] Os temas `dark` e `premium` funcionam sem mudar estrutura ou funcionalidade dos componentes.
- [ ] Botão, input, tabela, modal, aba e card têm estados completos.
- [ ] Chat, agentes, automações, dados e aprovações seguem os padrões do §7.
- [ ] Dashboards seguem a semântica de dataviz; status não é série comum.
- [ ] Vermelho aparece só em erro, urgência ou ação irreversível.
- [ ] Navegação mobile e tabelas densas continuam utilizáveis.
- [ ] Todo elemento interativo tem foco visível e contraste AA.
- [ ] Sem gradiente neon, estética gamer, glass excessivo, preto chapado ou roxo fora de token.
- [ ] Cada tela tem uma ação primária clara; secundárias não competem.
- [ ] `npm run lint`, `npx tsc --noEmit --strict` e `npm run build` passam.
