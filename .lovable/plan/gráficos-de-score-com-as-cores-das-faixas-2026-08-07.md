# Gráficos de score com as cores das faixas

Hoje os dois gráficos de evolução do score usam uma cor única (azul no time, vermelho no individual), o que não conversa com as faixas de cor já usadas nas badges e no modal de avaliação:

- 80 a 100: verde (success)
- 60 a 79: amarelo (warning)
- abaixo de 60: vermelho (destructive)

A proposta é fazer a linha e o preenchimento do gráfico assumirem a cor da faixa de cada dia, com transição suave (degradê) entre um dia e outro.

## O que muda

Nos dois gráficos:

- "Evolução do time" na aba Visão geral
- "Evolução do score" na análise individual

Cada ponto do dia passa a ter a cor da sua faixa. Entre dois dias de faixas diferentes, a cor da linha muda gradualmente ao longo do trecho, em vez de saltar. O preenchimento abaixo da linha acompanha a mesma cor, com esmaecimento vertical como já é hoje.

Também será adicionada uma legenda discreta com as três faixas abaixo de cada gráfico, para que a leitura das cores fique clara.

O pontinho de cada dia (visível no hover) recebe a cor da faixa daquele dia.

## Detalhes técnicos

- Nova função `scoreBandColor(score)` em `src/lib/analysisCatalog.ts`, retornando o token HSL correspondente (`--success`, `--warning`, `--destructive`), reaproveitando os mesmos limiares de `scoreTone` — sem duplicar as faixas.
- Novo componente compartilhado `src/components/performance/ScoreEvolutionChart.tsx`, usado pelos dois gráficos, para não duplicar a configuração do Recharts.
- O degradê é feito com um `linearGradient` horizontal (`x1=0 x2=1`) gerado dinamicamente: um `stop` por dia, com `offset` proporcional ao índice do ponto e `stopColor` da faixa daquele score. Esse gradiente é aplicado no `stroke` da `Area`.
- O preenchimento usa um segundo gradiente com os mesmos stops, em opacidade reduzida, mais uma máscara vertical de esmaecimento (mantendo o visual atual).
- `dot` com `fill` calculado por ponto via função de render, e `activeDot` na mesma cor.
- Sem mudança de dados: `scoreSeries` de `useTeamPerformance` e do dashboard individual continua igual.
