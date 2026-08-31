# Roadmap — Nexus AI

Roadmap de produto. O que estamos construindo, para quem, e o resultado que queremos com cada entrega.

Organizado em três horizontes:

- **Now** — em execução ou próximo da execução
- **Next** — comprometido, mas ainda não iniciado
- **Later** — backlog priorizado, sujeito a reavaliação

Última atualização: 2026-05-22

---

## Now

### 1. Cadências de mensagem automáticas

**O problema.** Reuniões agendadas têm uma taxa de no-show alta. Quando o lead não comparece, ele esfria rápido e raramente reagenda sozinho. Hoje depende do vendedor lembrar de cobrar manualmente — e na maioria das vezes não acontece.

**O que vamos entregar.** Um sistema onde o administrador monta uma sequência de mensagens (texto, áudio, imagem) com a ordem e o tempo entre elas, e define quando essa sequência dispara. O agente envia automaticamente em nome do vendedor, e para na hora que o lead responde, reagenda ou pede para não receber mais.

**Primeiras duas cadências em produção:**
1. **Confirmação antes da reunião** — lembra o lead 24h antes e 1h antes. Reduz no-show.
2. **Recuperação depois do no-show** — se o lead não entrou, dispara uma sequência tentando remarcar nos próximos dias. Recupera oportunidade que hoje é perdida.

A infraestrutura por trás é genérica: serve para qualquer evento (reunião marcada, lead parado há X dias, cliente fez aniversário, etc.). Começamos com essas duas porque resolvem dor imediata, mas a base permite criar outras cadências sem refazer nada.

**Resultado esperado.** Redução mensurável da taxa de no-show e aumento da taxa de leads reagendados após ausência. Vendedor para de fazer follow-up manual e ganha tempo para focar em quem está pronto para fechar.

---

### 2. Finalizar canal WhatsApp Oficial e abrir Instagram

**O problema.** Hoje a maior parte do volume passa pelo Z-API (não-oficial). Funciona, mas tem risco de bloqueio e não permite alguns recursos que só o canal oficial entrega. Clientes maiores e mais regulados exigem o canal oficial. Além disso, vários leads chegam por DM no Instagram e hoje ninguém atende — o time precisa olhar duas caixas separadas.

**O que vamos entregar.**
- **WhatsApp Oficial completo:** chegar à mesma experiência do Z-API (áudio, vídeo, imagem, documento, figurinha, contato, localização) e somar o que só o oficial oferece — botões, listas, mensagens-modelo aprovadas (necessárias para mandar a primeira mensagem ou reativar leads frios), e acompanhamento de "entregue/lido".
- **Instagram Direct dentro do Inbox:** somente DMs (mensagens diretas) aparecem na mesma caixa do WhatsApp. Respostas a stories, comentários e reações ficam fora do escopo. O time atende DMs em um lugar só, e a interface mostra claramente de qual canal veio cada conversa.

**Resultado esperado.** Reduzir dependência do Z-API, atender contas que só usam canal oficial, e capturar leads que hoje somem porque chegam por Instagram sem ninguém atender.

---

## Next

### 3. Expandir o que o agente sabe fazer

**O problema.** Hoje o agente conversa, busca conhecimento e marca reunião no Google Calendar dos vendedores. Mas quando o lead pede algo um pouco fora desse trilho — confirmar dados da empresa, receber um link de pagamento, falar com humano agora, mudar a data da reunião — o agente trava ou precisa transferir.

**O que vamos entregar.** Um conjunto de novas "ações" que o agente passa a saber executar sozinho, expandindo o que ele resolve sem precisar de gente. Cada uma pensada para resolver uma situação concreta que aparece nas conversas:

| Ação | Quando o agente usa |
|------|---------------------|
| **Transferir para humano** *(já existe)* | Decisão explícita do agente, com contexto resumido para o vendedor que assume |
| **Confirmar presença na reunião** | Durante a cadência de confirmação (item 1), o agente interpreta a resposta do lead ("confirmo", "não vou mais", "posso na quarta?") e atualiza o status da reunião no sistema — sem o vendedor precisar fazer nada manualmente |

**Resultado esperado.** Mais conversas resolvidas pelo próprio agente e CRM mais limpo, porque o agente atualiza o que viu na conversa em vez de exigir que o vendedor lembre.

---

### 4. Painel de cadências e automações

**O problema.** Quando a cadência do item 1 estiver no ar, vamos precisar medir o que funciona. Sem isso, vira caixa-preta: não dá pra saber se a mensagem 2 vale a pena, se está faltando um toque a mais, ou se algum cliente está sendo incomodado demais.

**O que vamos entregar.** Um painel mostrando, para cada cadência ativa: quantos leads entraram, quantos responderam em cada passo, quantos reagendaram, quantos pediram para parar. Permite ajustar mensagens com base em dado real, não em achismo.

**Resultado esperado.** Capacidade de iterar nas cadências e melhorar resultado mês a mês. Sem o painel, a cadência é só "automação que envia coisa".

---

### 5. Cadências para outros momentos do ciclo

**O problema.** As duas primeiras cadências (item 1) cobrem só o entorno da reunião. Mas tem várias outras oportunidades onde o lead esfria por falta de toque: lead que conversou e sumiu há 15 dias, aniversário, cliente que comprou e nunca mais foi contatado.

**O que vamos entregar.** Novas cadências montadas sobre o mesmo motor do item 1:
- **Reativação de lead frio** — sem interação há N dias
- **Aniversário do contato**
- **Pós-venda e NPS** — 7, 30 e 90 dias após o fechamento
- **Cadência manual disparada pelo vendedor** — para SDR que quer iniciar um follow-up sequenciado em alguém específico, sem precisar do gatilho automático

**Resultado esperado.** Aumentar a vida útil de cada lead e cliente na base. Hoje, lead que esfriou está praticamente perdido — passa a ser recuperável.

---

## Later

### 6. Modo de teste / ensaio de cadência

**O problema.** Cadência mal configurada pode disparar mensagem errada para centenas de leads reais — risco operacional e de imagem.

**O que vamos entregar.** Modo de simulação em que o administrador roda a cadência inteira em velocidade acelerada contra um lead fictício, vê todos os toques que seriam enviados, e só então ativa para a base real.

---

### 7. Ferramentas estratégicas adicionais para o agente

Camada seguinte do catálogo de ações (item 3), com foco em casos mais avançados:

- **Pesquisar a empresa do lead na web** — buscar notícias, posts recentes ou site da empresa para dar contexto vivo à conversa
- **Pesquisa de satisfação automática (NPS)** — disparar pesquisa após fechamento ou atendimento
- **Memória de longo prazo do contato** — agente lembra fatos que o lead disse há meses ("ele tem filhos", "viaja em janeiro") sem depender de reler todo o histórico

---

### 8. LGPD e governança de comunicação

**O problema.** Quanto mais o sistema dispara mensagem por conta própria (cadências, automações), maior o risco de receber pedido de descadastro ou questionamento legal. Precisamos estar prontos.

**O que vamos entregar.**
- Opt-out por cadência específica e opt-out global, com histórico do que foi enviado
- Registro de consentimento separado por canal (WhatsApp ≠ Instagram ≠ e-mail)
- Exportação de todo o histórico de comunicação de um contato sob demanda, para atender pedidos de direito de acesso

Integrado com a página de LGPD que já existe.

---

## Itens descartados / em estudo

- ~~Instagram como canal separado do Meta Oficial~~ — fundido com o item 2, é a mesma integração na prática.
- ~~Cadência limitada a reunião~~ — generalizada como cadência configurável no item 1, para qualquer momento do ciclo.

---

## Como usar este roadmap

- Mover itens entre Now/Next/Later conforme o trabalho avança.
- Riscar (`~~item~~`) o que for descartado, mantendo histórico curto na seção "descartados".
- Evitar datas. Se precisar registrar, colocar como nota dentro do item, nunca no topo.
