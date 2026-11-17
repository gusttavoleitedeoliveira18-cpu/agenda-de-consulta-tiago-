/** Destino seguro após login (somente caminhos internos de /admin; impede open redirect). */
export function destinoSeguro(next: unknown): string {
  return typeof next === "string" && /^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_%-]*)?$/.test(next) && !next.startsWith("//") ? next : "/admin";
}
