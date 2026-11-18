// Servidor FALSO para testes locais (nunca usado fora do modo de teste):
//  * /siteverify — imita a verificação do Turnstile (token "token-valido" = sucesso).
import http from "node:http";

export function iniciarFalsos(porta) {
  const srv = http.createServer(async (req, res) => {
    let corpo = "";
    for await (const c of req) corpo += c;
    res.writeHead(req.url === "/siteverify" ? 200 : 404, { "content-type": "application/json" });
    if (req.url !== "/siteverify") return res.end("{}");
    const p = new URLSearchParams(corpo);
    res.end(JSON.stringify({ success: p.get("secret") === "segredo-turnstile-teste" && p.get("response") === "token-valido" }));
  });
  return new Promise((ok) => srv.listen(porta, "127.0.0.1", () => ok(srv)));
}
