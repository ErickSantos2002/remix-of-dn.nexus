# Corrigir as cores das badges no modal "Avaliação do atendimento"

## Por que a mudança não aparece

A troca de cores já está feita em `src/lib/analysisCatalog.ts` (`partial` = azul, `missed` = âmbar), mas nada muda na tela porque o componente `Badge` sobrepõe essas classes.

O `Badge` usa a variante `default`, que aplica `bg-primary text-primary-foreground`. Essas utilities do Tailwind têm precedência sobre as classes `.badge-primary` / `.badge-warning` / `.badge-success`, que são definidas na camada de componentes do `index.css`. Resultado: toda badge sai azul sólida, independente do veredicto — exatamente o que aparece no print.

## O que fazer

Nas badges de veredicto do modal (`src/components/performance/AnalysisResultModal.tsx`), usar `variant="outline"` junto com a classe semântica, para que a variante padrão pare de sobrescrever o fundo e o texto.

Aplicar o mesmo ajuste nas outras badges do modal que recebem classes `badge-*` (resumo de atendidos / parciais / não atendidos / não se aplica), garantindo consistência.

Nenhuma mudança de regra de negócio, de score ou de backend.

## Detalhe técnico

- `badgeVariants` (`src/components/ui/badge.tsx`) permanece intocado — a correção é no ponto de uso.
- `variant="outline"` só define `text-foreground` e a borda base, sem `bg-*`, então `.badge-warning` / `.badge-primary` / `.badge-success` / `.badge-neutral` passam a valer.
