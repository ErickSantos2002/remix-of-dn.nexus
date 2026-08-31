// scripts/test-contact-guard.ts — Verificação da guarda de dados de contato.
// Não toca no banco nem chama LLM: exercita apenas supabase/functions/_shared/contactDataGuard.ts.
// Uso: npx tsx scripts/test-contact-guard.ts
import {
  buildTenantGuard,
  sanitizeExtractedContactData,
  squash,
  type HistoryMessage,
} from "../supabase/functions/_shared/contactDataGuard.ts";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`, extra ?? ""); }
}

// Nomes reais que o tenant expõe na conversa: empresa, workspace e agente.
const TENANT = ["dn.ia", "Comercial dn.ia", "Ana"];
const guard = buildTenantGuard(TENANT);

function run(
  history: HistoryMessage[],
  extracted: Record<string, string>,
  currentMessage?: string,
) {
  return sanitizeExtractedContactData({ extracted, history, currentMessage, guard });
}

const h = (role: "user" | "assistant", content: string): HistoryMessage => ({ role, content });

async function main() {
  console.log("\n== Normalização ==");
  ok("squash colapsa separadores", squash("dn.ia") === "dnia", squash("dn.ia"));
  ok("squash remove acentos", squash("Boticário") === "boticario", squash("Boticário"));
  ok("squash de URL", squash("https://nexus.dnia.ai/m/abc") === "httpsnexusdniaaimabc", squash("https://nexus.dnia.ai/m/abc"));

  console.log("\n== Reprodução do bug ==");
  // Caso 1: exatamente o cenário do relato — lembrete de reunião + "ok".
  const c1 = run(
    [
      h("assistant", "Oi! Lembrete da sua reunião de amanhã. Link: https://nexus.dnia.ai/m/abc123"),
      h("user", "ok, confirmado"),
    ],
    { company: "dn.ia" },
  );
  ok("1. lembrete de reunião não vira empresa do lead",
    c1.clean.company === undefined && c1.rejected.some(r => r.field === "company"), c1);

  // Caso 2: valida especificamente o squash — "dn ia" vs "dnia" na blocklist.
  const c2 = run([h("user", "ok")], { company: "dn.ia" });
  ok("2. blocklist casa apesar da pontuação",
    c2.clean.company === undefined && c2.rejected[0]?.reason === "tenant", c2);

  console.log("\n== Empresas legítimas passam ==");
  const c3 = run([h("user", "somos a techcorp")], { company: "TechCorp Ltda" });
  ok("3. expansão com sufixo societário", c3.clean.company === "TechCorp Ltda", c3);

  const c4 = run([h("user", "trabalho no boticário")], { company: "Grupo Boticario" });
  ok("4. prefixo genérico + acento", c4.clean.company === "Grupo Boticario", c4);

  const c9 = run(
    [h("assistant", "Você ainda é da empresa ACME?"), h("user", "não, mudei, agora sou da Beta Sistemas")],
    { company: "Beta Sistemas" },
  );
  ok("9. troca de empresa informada pelo lead", c9.clean.company === "Beta Sistemas", c9);

  const cExp = run([h("user", "trabalho na acme")], { company: "ACME Corporation Brasil" });
  ok("expansão pelo LLM sobrevive via token distintivo", cExp.clean.company === "ACME Corporation Brasil", cExp);

  console.log("\n== Nome do contato ==");
  const c5 = run([h("assistant", "Aqui é a Ana, da dn.ia"), h("user", "oi")], { name: "Ana" });
  ok("5. nome do agente não vira nome do lead",
    c5.clean.name === undefined && c5.rejected[0]?.reason === "tenant", c5);

  const c6 = run([h("user", "meu nome é Ana Paula")], { name: "Ana Paula Silva" });
  ok("6. nome dito pelo lead é aceito", c6.clean.name === "Ana Paula Silva", c6);

  console.log("\n== As duas camadas são necessárias ==");
  // Aqui a proveniência SOZINHA passaria: o lead escreveu "dn.ia".
  const c7 = run([h("user", "vocês são da dn.ia?")], { company: "dn.ia" });
  ok("7. blocklist segura o que a proveniência deixaria passar",
    c7.clean.company === undefined && c7.rejected[0]?.reason === "tenant", c7);

  // E aqui a blocklist sozinha não teria nada a dizer.
  const cProv = run([h("assistant", "Trabalhamos com a Zenith Corp")], { company: "Zenith Corp" });
  ok("proveniência segura o que a blocklist não conhece",
    cProv.clean.company === undefined && cProv.rejected[0]?.reason === "no-provenance", cProv);

  console.log("\n== Sem over-blocking ==");
  const c8 = run([h("user", "sou da Nexus Contabilidade")], { company: "Nexus Contabilidade" });
  ok("8. 'nexus' só bloqueia por igualdade exata", c8.clean.company === "Nexus Contabilidade", c8);

  console.log("\n== Email e telefone ==");
  const e1 = run([h("assistant", "Dúvidas? contato@dnia.ai")], { email: "contato@dnia.ai" });
  ok("email do tenant é rejeitado", e1.clean.email === undefined && e1.rejected[0]?.reason === "tenant", e1);

  const e2 = run([h("user", "meu email é joao@techcorp.com")], { email: "joao@techcorp.com" });
  ok("email dito pelo lead é aceito", e2.clean.email === "joao@techcorp.com", e2);

  const p1 = run([h("assistant", "Nosso WhatsApp é (11) 3333-4444")], { phone: "1133334444" });
  ok("telefone do assistente é rejeitado", p1.clean.phone === undefined, p1);

  const p2 = run([h("user", "pode ligar no 31 98888-7777")], { phone: "(31) 98888-7777" });
  ok("telefone dito pelo lead é aceito", p2.clean.phone === "(31) 98888-7777", p2);

  console.log("\n== Campos fora da guarda ==");
  const f1 = run([h("user", "ok")], { employee_count: "51-200 funcionarios", revenue: "Entre 1MM e 3MM/mes" });
  ok("employee_count/revenue passam sem proveniência textual",
    f1.clean.employee_count === "51-200 funcionarios" && f1.clean.revenue === "Entre 1MM e 3MM/mes", f1);

  console.log("\n== Mensagem atual entra no haystack ==");
  const m1 = run([h("assistant", "Qual sua empresa?")], { company: "Delta Log" }, "sou da Delta Log");
  ok("currentMessage conta como fala do lead", m1.clean.company === "Delta Log", m1);

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
