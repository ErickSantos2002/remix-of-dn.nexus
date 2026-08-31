# Design System - DN.IA (Nexus AI)

> Sistema de design completo para padronizacao de interfaces. Dark mode com acentos Blue/Red e efeitos glassmorphism.

---

## Sumario

1. [Visao Geral](#visao-geral)
2. [Tipografia](#tipografia)
3. [Paleta de Cores](#paleta-de-cores)
4. [Efeitos Visuais](#efeitos-visuais)
5. [Badges e Status](#badges-e-status)
6. [Animacoes](#animacoes)
7. [Guia de Implementacao](#guia-de-implementacao)

---

## Visao Geral

| Propriedade       | Valor                              |
| ----------------- | ---------------------------------- |
| **Tema**          | Dark Mode (default)                |
| **Primary Color** | Blue (#3D61FF)                     |
| **Accent Color**  | Red (#E41A11)                      |
| **Brand Primary** | #DE1A11 (glow/gradients)           |
| **Brand Accent**  | #3D61FF (glow/gradients)           |
| **Estilo Visual** | Glassmorphism com bordas luminosas |
| **Border Radius** | 0.75rem (12px)                     |
| **Stack**         | React + Tailwind CSS + shadcn/ui   |

---

## Tipografia

### Fontes

| Tipo           | Familia        | Pesos              | Uso                       |
| -------------- | -------------- | ------------------ | ------------------------- |
| **Display**    | Video          | 300-700            | Titulos, headlines        |
| **Sans-serif** | Poppins, Inter | 400, 500, 600, 700 | Texto geral, UI           |
| **Monospace**  | JetBrains Mono | 400, 500           | Numeros, codigo, metricas |

### Classes

```tsx
// Titulos e headlines (Video)
<h1 className="font-display text-3xl font-bold">Titulo</h1>

// Texto padrao (Poppins/Inter)
<p className="font-sans">Texto geral</p>

// Numeros e metricas (JetBrains Mono)
<span className="font-mono text-2xl text-primary">R$ 1.5M</span>
```

---

## Paleta de Cores

### Cores Base (Dark Mode)

| Token              | HSL        | HEX       | Uso              |
| ------------------ | ---------- | --------- | ---------------- |
| `background`       | 0 0% 4%    | `#0A0A0A` | Fundo principal  |
| `foreground`       | 0 0% 98%   | `#FAFAFA` | Texto principal  |
| `card`             | 0 0% 7%    | `#121212` | Fundo de cards   |
| `muted`            | 0 0% 15%   | `#262626` | Elementos sutis  |
| `muted-foreground` | 0 0% 64%   | `#A3A3A3` | Texto secundario |

### Cores de Destaque

| Token       | HSL          | HEX       | Uso                      |
| ----------- | ------------ | --------- | ------------------------ |
| `primary`   | 231 100% 62% | `#3D61FF` | Cor principal (Blue)     |
| `accent`    | 4 87% 48%    | `#E41A11` | Cor de acento (Red)      |
| `secondary` | 0 0% 15%     | `#262626` | Superficies secundarias  |

### Cores Semanticas

| Token         | HSL          | HEX       | Uso              |
| ------------- | ------------ | --------- | ---------------- |
| `success`     | 160 84% 39%  | `#10B981` | Sucesso/positivo |
| `warning`     | 38 92% 50%   | `#F59E0B` | Alerta/atencao   |
| `destructive` | 4 87% 48%    | `#E41A11` | Erro/destrutivo  |

### Escalas de Cores Primitivas

Disponiveis no Tailwind e CSS variables:

- **Blue**: `blue-50` a `blue-900` (base: `blue-500` #3D61FF)
- **Red**: `red-50` a `red-900` (base: `red-500` #E41A11)
- **Neutral**: `neutral-0` (#FFF) a `neutral-1000` (#000)
- **Yellow**: `yellow-50` a `yellow-900`
- **Green**: `green-50` a `green-900`
- **Purple**: `purple-50` a `purple-900`
- **Cyan**: `cyan-50` a `cyan-900`

### Cores para Graficos

| Token     | Cor                |
| --------- | ------------------ |
| `chart-1` | Blue (primary)     |
| `chart-2` | Green (success)    |
| `chart-3` | Yellow (warning)   |
| `chart-4` | Purple             |
| `chart-5` | Pink               |

---

## Efeitos Visuais

### Glass Card (Padrao)

```tsx
<div className="glass-card p-6">
  <h2 className="text-foreground">Titulo</h2>
  <p className="text-muted-foreground">Descricao</p>
</div>
```

### Glass Card com Glow (Destaque)

```tsx
<div className="glass-card-glow p-6">
  <div className="glass-card-glow-effect"></div>
  <div className="glass-card-glow-content">
    <h2 className="text-gradient">Titulo Destacado</h2>
  </div>
</div>
```

### Variantes de Glow

| Classe          | Cor do Glow     |
| --------------- | --------------- |
| `glow-primary`  | Red (#DE1A11)   |
| `glow-accent`   | Blue (#3D61FF)  |
| `glow-success`  | Green           |
| `glow-purple`   | Purple          |
| `glow-cyan`     | Cyan            |

### Gradient Border

```tsx
<div className="gradient-border p-6">
  Conteudo com borda gradiente
</div>
```

### Text Gradient

```tsx
<span className="text-gradient">Texto com gradiente</span>
```

---

## Badges e Status

### Status Badges

```tsx
<span className="status-active px-2 py-1 rounded">Ativo</span>
<span className="status-attention px-2 py-1 rounded">Atencao</span>
<span className="status-waiting px-2 py-1 rounded">Aguardando</span>
```

| Classe             | Background      | Uso                   |
| ------------------ | --------------- | --------------------- |
| `status-active`    | Success (verde) | Estados ativos        |
| `status-attention` | Primary (azul)  | Precisa de atencao    |
| `status-waiting`   | Warning (amber) | Aguardando acao       |

### Semantic Badges

```tsx
<span className="badge-primary">Primary</span>
<span className="badge-accent">Accent</span>
<span className="badge-success">Success</span>
<span className="badge-warning">Warning</span>
<span className="badge-neutral">Neutral</span>
```

### Dashboard Badges

```tsx
<span className="badge-hot">HOT</span>
<span className="badge-p1">P1</span>
<span className="badge-p2">P2</span>
<span className="badge-p3">P3</span>
<span className="badge-grade badge-grade-a">A</span>
<span className="badge-status-alta">Alta</span>
<span className="badge-status-baixa">Baixa</span>
```

### Indicadores de Temperatura (Leads)

| Temperatura   | Classes                                    |
| ------------- | ------------------------------------------ |
| Muito Quente  | `bg-accent/20 text-accent border-accent/30`|
| Quente        | `bg-warning/20 text-warning border-warning/30` |
| Morno         | `bg-yellow-500/20 text-yellow-500 border-yellow-500/30` |
| Frio          | `bg-primary/20 text-primary border-primary/30` |

---

## Animacoes

### Classes Disponiveis

| Classe                   | Descricao                       |
| ------------------------ | ------------------------------- |
| `animate-fade-in`        | Fade in com movimento para cima |
| `animate-slide-in-right` | Slide da direita para esquerda  |
| `animate-accordion-down` | Accordion expandindo            |
| `animate-accordion-up`   | Accordion recolhendo            |
| `animate-pulse-glow`     | Pulsacao com glow               |

---

## Guia de Implementacao

### Tokens Semanticos

| Contexto           | Classe Tailwind                       |
| ------------------ | ------------------------------------- |
| Fundo principal    | `bg-background`                       |
| Texto principal    | `text-foreground`                     |
| Texto secundario   | `text-muted-foreground`               |
| Fundo de cards     | `bg-card`                             |
| Bordas             | `border-border`                       |
| Destaque principal | `text-primary` / `bg-primary`         |
| Acento             | `text-accent` / `bg-accent`           |
| Sucesso            | `text-success` / `bg-success`         |
| Erro               | `text-destructive` / `bg-destructive` |
| Alerta             | `text-warning` / `bg-warning`         |

### Exemplo Completo

```tsx
// Card padrao
<div className="glass-card p-6">
  <h2 className="text-foreground font-semibold">Titulo</h2>
  <p className="text-muted-foreground">Descricao do card</p>
  <span className="font-mono text-2xl text-primary">R$ 1.5M</span>
</div>

// Card com destaque
<div className="glass-card-glow p-6">
  <div className="glass-card-glow-effect"></div>
  <div className="glass-card-glow-content">
    <h2 className="text-gradient font-bold">Titulo Destacado</h2>
  </div>
</div>

// Status indicators
<span className="text-success">+15%</span>
<span className="text-destructive">-8%</span>
<span className="text-warning">Atencao</span>
```

---

## Arquivos de Configuracao

- `tailwind.config.ts` - Configuracao do Tailwind com cores, fontes e animacoes
- `src/index.css` - CSS variables, @font-face e classes de componentes
- `public/design_system/index.html` - Referencia visual completa

---

## Regras Importantes

1. **NUNCA use cores diretamente** (ex: `text-white`, `bg-black`)
2. **SEMPRE use tokens semanticos** (ex: `text-foreground`, `bg-background`)
3. **Use HSL para todas as cores** no CSS
4. **Mantenha consistencia** usando as classes do design system
5. **Nunca use emoji** na UI
6. **Primary = Blue (#3D61FF)** para elementos interativos
7. **Accent = Red (#E41A11)** para destaques e CTAs
