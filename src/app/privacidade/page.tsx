import { site } from "@/config/site";
const P = ({ children }: { children: React.ReactNode }) => <span className="rounded bg-lima/20 px-1.5 text-lima">[PREENCHER: {children}]</span>;
export default function Privacidade() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-neblina [&_li]:text-neblina">
      <a href="/" className="text-lima underline">← Voltar</a>
      <h1 className="mt-6 font-display text-4xl font-bold">Aviso de Privacidade</h1>
      <p>Versão preliminar — revise os campos destacados antes da publicação definitiva.</p>
      <h2>Quem é o responsável</h2><p>{site.nome}, {site.cref}. Documento/CNPJ e endereço: <P>dados do controlador</P>.</p>
      <h2>Quais dados coletamos</h2><ul className="list-disc pl-5"><li>Nome, e-mail e WhatsApp.</li><li>Tipo de atendimento, data e horário desejados.</li><li>Objetivo do treinamento, se você optar por informar.</li></ul>
      <h2>Para que usamos</h2><p>Exclusivamente para tratar sua solicitação de agendamento e entrar em contato com você. Seus dados não são exibidos publicamente.</p>
      <h2>Quem pode acessar</h2><p>O profissional responsável e os provedores de infraestrutura necessários ao funcionamento do site (hospedagem e banco de dados). <P>confirmar lista de operadores</P></p>
      <h2>Por quanto tempo guardamos</h2><p><P>prazo de retenção</P></p>
      <h2>Seus direitos</h2><p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização ou eliminação dos dados, entre outros direitos da LGPD (Lei 13.709/2018). Para isso, contate: <P>e-mail ou canal do encarregado/controlador</P>.</p>
    </main>);
}
