import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      // Links internos com <a> são intencionais no site original (âncoras e páginas simples).
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // Testes leem JSON arbitrário das respostas HTTP.
  { files: ["tests/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
];
export default config;
