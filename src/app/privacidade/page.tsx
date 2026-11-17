import { site } from "@/config/site";
import { agenda } from "@/config/agenda";
// Campos destacados dependem do CONTROLADOR e não devem ser preenchidos com dados presumidos.
const P = ({ children }: { children: React.ReactNode }) => <span className="rounded bg-lima/20 px-1.5 text-lima">[PREENCHER: {children}]</span>;
export default function Privacidade() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-neblina [&_li]:text-neblina">
      <a href="/" className="text-lima underline">← Voltar</a>
      <h1 className="mt-6 font-display text-4xl font-bold">Aviso de Privacidade</h1>
      <p>Versão {agenda.privacidade.versao} — preliminar. Os campos destacados dependem de informações do responsável e este texto ainda não passou por validação jurídica.</p>
      <h2>Quem é o responsável</h2><p>{site.nome}, {site.cref}, é o controlador dos dados tratados neste site. Documento (CPF/CNPJ) e endereço: <P>dados do controlador</P>. Encarregado pelo tratamento de dados: <P>nome e contato do encarregado, ou informação sobre dispensa, conforme avaliação do controlador</P>.</p>
      <h2>Quais dados coletamos</h2><ul className="list-disc pl-5">
        <li>Nome, e-mail e WhatsApp (número e país).</li>
        <li>Tipo de atendimento, data e horário desejados.</li>
        <li>Objetivo do treinamento, se você optar por informar.</li>
        <li>Registro de que você leu este aviso (versão e data/hora).</li>
        <li>Histórico da solicitação (recebimento, confirmação, propostas de horário, respostas, cancelamentos e e-mails enviados).</li>
        <li>Dados técnicos de segurança: o endereço IP e sinais do navegador são analisados no momento do envio para bloquear robôs e abusos. O IP não é gravado em claro: guardamos apenas um código irreversível (pseudônimo) para limitar tentativas repetidas.</li>
      </ul>
      <h2>Para que usamos e com qual base legal</h2><ul className="list-disc pl-5">
        <li><strong className="text-marfim">Tratar sua solicitação de atendimento</strong> — analisar a disponibilidade, confirmar, recusar ou propor outro horário e falar com você por e-mail ou WhatsApp sobre ela. Base legal: procedimentos preliminares relacionados a contrato, a seu pedido (LGPD, art. 7º, V).</li>
        <li><strong className="text-marfim">Segurança do site e prevenção de abusos</strong> — verificação anti-robô, limite de tentativas e registros técnicos. Base legal: legítimo interesse (LGPD, art. 7º, IX), limitado ao necessário.</li>
        <li><strong className="text-marfim">Registro do histórico de cada solicitação</strong> — para demonstrar o que foi solicitado e respondido. Base legal: exercício regular de direitos (LGPD, art. 7º, VI).</li>
      </ul>
      <p>As bases legais acima foram indicadas para cada finalidade e estão sujeitas à validação do controlador. Seus dados não são exibidos publicamente e não são usados para publicidade ou campanhas. Marcar que leu este aviso não é um consentimento para outras finalidades.</p>
      <h2>Quem pode acessar</h2><p>O profissional responsável, por meio de um painel com acesso restrito. Também participam do funcionamento do site, como operadores, os seguintes provedores de infraestrutura: Vercel (hospedagem), Supabase (banco de dados e autenticação), Resend (envio de e-mails) e Cloudflare (verificação anti-robô Turnstile). Ao conversar pelo WhatsApp, aplica-se também a política do próprio WhatsApp. Esses provedores podem processar dados fora do Brasil: <P>confirmar regiões contratadas e salvaguardas de transferência internacional</P>.</p>
      <h2>Como protegemos</h2><p>Conexão criptografada (HTTPS), acesso ao painel somente com conta autorizada, banco de dados com regras de acesso restritivas, links de resposta pessoais, de uso único e com prazo de validade, e registros técnicos sem dados pessoais desnecessários.</p>
      <h2>Por quanto tempo guardamos</h2><p>Solicitações e seu histórico: <P>prazo ou critério de retenção</P>. Registros técnicos de segurança: pseudônimos usados para limitar tentativas são apagados automaticamente após 2 dias; controles internos contra envio duplicado, após 7 dias.</p>
      <h2>Seus direitos</h2><p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização ou eliminação dos dados, entre outros direitos da LGPD (Lei 13.709/2018), e também apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD). Para exercer seus direitos, contate: <P>e-mail ou canal do encarregado/controlador</P>.</p>
    </main>);
}
