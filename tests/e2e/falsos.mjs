// Servidores FALSOS para testes locais (nunca usados fora do modo de teste):
//  * /emails     — imita a API do Resend, inclusive Idempotency-Key, e registra os e-mails em memória;
//  * /siteverify — imita a verificação do Turnstile (token "token-valido" = sucesso).
import http from "node:http";

export function iniciarFalsos(porta) {
  const emails = [];
  const idem = new Map();
  let modo = "ok";
  const srv = http.createServer(async (req, res) => {
    let corpo = "";
    for await (const c of req) corpo += c;
    const enviar = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/_modo" && req.method === "POST") { modo = JSON.parse(corpo).modo; return enviar(200, { modo }); }
    if (req.url === "/_emails" && req.method === "GET") return enviar(200, emails);
    if (req.url === "/_emails" && req.method === "DELETE") { emails.length = 0; idem.clear(); return enviar(200, {}); }
    if (req.url === "/emails" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer re_teste_local") return enviar(401, { message: "invalid key" });
      if (modo === "falha500") return enviar(500, { message: "erro simulado" });
      if (modo === "falha422") return enviar(422, { message: "erro de validação simulado" });
      if (modo === "lento") await new Promise((r) => setTimeout(r, 12_000));
      const chave = req.headers["idempotency-key"];
      if (chave && idem.has(chave)) return enviar(200, { id: idem.get(chave) });
      const id = `msg_${emails.length + 1}_${Date.now()}`;
      const b = JSON.parse(corpo);
      emails.push({ id, chave, to: b.to, subject: b.subject, html: b.html, text: b.text, from: b.from });
      if (chave) idem.set(chave, id);
      return enviar(200, { id });
    }
    if (req.url === "/siteverify" && req.method === "POST") {
      const p = new URLSearchParams(corpo);
      return enviar(200, { success: p.get("secret") === "segredo-turnstile-teste" && p.get("response") === "token-valido" });
    }
    enviar(404, {});
  });
  return new Promise((ok) => srv.listen(porta, "127.0.0.1", () => ok(srv)));
}
