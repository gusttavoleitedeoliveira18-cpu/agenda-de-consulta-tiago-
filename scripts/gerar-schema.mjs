// Gera supabase/schema.sql concatenando as migrações versionadas (fonte de verdade).
// Uso: npm run db:schema
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const dir = "supabase/migrations";
const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const partes = arquivos.map((f) => `-- >>> ${f}\n${readFileSync(`${dir}/${f}`, "utf8").trim()}\n`);
writeFileSync("supabase/schema.sql", `-- ARQUIVO GERADO por \`npm run db:schema\` — não edite à mão.
-- Fonte de verdade: supabase/migrations/*.sql (aplique com \`supabase db push\`).
-- Alternativa manual: executar este arquivo inteiro no SQL Editor do Supabase.
-- Todas as migrações são incrementais e podem ser reexecutadas sem apagar dados.
-- FAÇA BACKUP ANTES (veja README → "Banco de dados").

${partes.join("\n")}`);
console.log(`schema.sql gerado a partir de ${arquivos.length} migrações`);
