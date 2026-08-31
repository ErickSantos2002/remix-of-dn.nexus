# CRM Performance

Parte da API Nexus AI API. 9 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/performance/ranking`

Ranking de desempenho dos vendedores no atendimento

Ranking dos vendedores pelo score medio das avaliacoes de atendimento
(reunioes, demonstracoes e ligacoes avaliadas contra um playbook).

- **avg_score**: media 0-100 das avaliacoes concluidas no periodo
- **trend**: media da segunda metade do periodo menos a da primeira, em PONTOS de score
- **recurrent_points**: pontos de desenvolvimento com status `recurrent` (falhas repetidas)

Reincidencia NAO reduz o score: ela e reportada a parte para manter as notas
comparaveis entre vendedores e ao longo do tempo.

Somente atendimentos com `status=done`, score preenchido e nao desconsiderados
pelo gestor entram no calculo.

operationId: `getCRMPerformanceRanking`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) | Ignorado quando `start_date` e informado |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `analysis_id` | query | nao | string<uuid> | Filtra por um tipo de analise (playbook) especifico |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Ranking ordenado por score medio (maior primeiro) -> SuccessResponse & object
- `400` start_date ou end_date invalidos
- `404` Sub-rota desconhecida em /crm/performance

### `GET /crm/performance/overview`

Visao geral do desempenho da equipe

Mesmos numeros da aba "Visao geral" de /crm/desempenho, no escopo da EMPRESA
dona do workspace informado.

- **company_average**: media 0-100 das avaliacoes concluidas no periodo (null se nao houver)
- **trend**: media da segunda metade do periodo menos a da primeira, em PONTOS
- **by_playbook**: media e volume por tipo de analise
- **score_series**: media diaria (yyyy-MM-dd), em ordem cronologica
- **ranking**: mesma estrutura de /crm/performance/ranking, sem paginacao

Avaliacoes desconsideradas pelo gestor ficam fora de todos os calculos.

operationId: `getCRMPerformanceOverview`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `playbook_id` | query | nao | string<uuid> | Filtra por um tipo de analise (alias, `analysis_id`) |

**Respostas**

- `200` Agregados do periodo -> SuccessResponse & object
- `400` start_date ou end_date invalidos
- `404` Empresa nao encontrada para o workspace

### `GET /crm/performance/analyses`

Lista as avaliacoes de atendimento do periodo

Historico das avaliacoes do workspace, ordenado do atendimento mais recente
para o mais antigo (`occurred_at` = quando o atendimento aconteceu, nao
quando a IA avaliou).

Avaliacoes desconsideradas pelo gestor ficam de fora por padrao; use
`include_disregarded=true` para audita-las.

operationId: `listCRMPerformanceAnalyses`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `seller_id` | query | nao | string<uuid> |  |
| `playbook_id` | query | nao | string<uuid> |  |
| `lead_id` | query | nao | string<uuid> |  |
| `status` | query | nao | string (processing \| done \| failed) |  |
| `include_disregarded` | query | nao | boolean |  |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista paginada de avaliacoes -> SuccessResponse & object
- `400` start_date ou end_date invalidos

### `GET /crm/performance/analyses/{id}`

Detalhe completo de uma avaliacao

Retorna a avaliacao inteira: veredicto e evidencia por criterio, pontos fortes,
melhorias sugeridas, habitos observados, reincidencias e correcoes.

`evidence_verified=false` indica que o trecho citado nao foi localizado na
transcricao (a IA parafraseou) — o veredicto continua valido, a evidencia nao
serve como prova.

operationId: `getCRMPerformanceAnalysis`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Avaliacao completa -> SuccessResponse & object
- `404` Avaliacao nao encontrada neste workspace

### `GET /crm/performance/sellers/{sellerId}`

Painel de desempenho de um vendedor

Espelha o painel individual: media, tendencia, serie diaria de score, pontos de
desenvolvimento (abertos, recorrentes e corrigidos no periodo) e conquistas.

Um ponto corrigido pertence ao periodo da CORRECAO; abertos e recorrentes, ao
periodo da ultima ocorrencia.

operationId: `getCRMPerformanceSeller`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `playbook_id` | query | nao | string<uuid> |  |

**Respostas**

- `200` Painel do vendedor -> SuccessResponse & object
- `404` Empresa nao encontrada para o workspace

### `GET /crm/performance/sellers/{sellerId}/development-points`

Pontos de desenvolvimento do vendedor

Todos os pontos rastreados do vendedor, sem recorte de periodo.

- `open`: apontado uma vez e ainda nao corrigido
- `recurrent`: voltou a ocorrer apos ja ter sido apontado
- `corrected`: atendido em uma avaliacao posterior

operationId: `listCRMPerformanceSellerPoints`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |
| `status` | query | nao | string (open \| recurrent \| corrected) |  |

**Respostas**

- `200` Pontos ordenados pela ultima ocorrencia -> SuccessResponse & object

### `GET /crm/performance/sellers/{sellerId}/brief`

Orientacao de coaching do vendedor

Ultimo brief de coaching gerado para o vendedor (material de gestao, em Markdown).
Retorna 404 quando nenhuma orientacao foi gerada ainda — a geracao acontece
sob demanda pelo gestor na tela de desempenho.

operationId: `getCRMPerformanceSellerBrief`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Brief mais recente -> SuccessResponse & object
- `404` Nenhuma orientacao gerada para este vendedor

### `GET /crm/performance/playbooks`

Analises (playbooks) cadastradas na empresa

Catalogo dos tipos de analise usados para avaliar atendimentos. Use o `id`
retornado aqui como `playbook_id` nos demais endpoints de desempenho.

operationId: `listCRMPerformancePlaybooks`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de analises da empresa -> SuccessResponse & object

### `GET /crm/performance/playbooks/{id}`

Analise com a rubrica ativa e seus criterios

Alem dos dados da analise, retorna a versao ATIVA da rubrica e os criterios
avaliados (com peso). O score e a soma ponderada dos veredictos calculada em
codigo — nunca pelo modelo.

operationId: `getCRMPerformancePlaybook`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Analise + rubrica ativa -> SuccessResponse & object
- `404` Analise nao encontrada nesta empresa

