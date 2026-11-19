import { site } from "@/config/site";
import { agenda } from "@/config/agenda";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";

export default function Privacidade() {
  const wa = linkWhatsApp(site.whatsapp);
  const contato = wa
    ? <a href={wa} className="text-lima underline">WhatsApp {formatarTelefone(site.whatsapp)}</a>
    : <span>WhatsApp do profissional</span>;
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-neblina [&_li]:text-neblina">
      <a href="/" className="text-lima underline">← Voltar</a>
      <h1 className="mt-6 font-display text-4xl font-bold">Aviso de Privacidade</h1>
      <p>Versão de {agenda.privacidade.versao.split("-").reverse().join("/")}.</p>
      <h2>Quem é o responsável</h2><p>{site.nome}, {site.cref}, personal trainer em {site.cidade}, é o responsável (controlador) pelos dados enviados por este site. Dúvidas e pedidos sobre seus dados: {contato}.</p>
      <h2>Quais dados coletamos</h2><ul className="list-disc pl-5">
        <li>Nome, e-mail e WhatsApp (número e país).</li>
        <li>Tipo de atendimento, data e horário desejados.</li>
        <li>Objetivo do treinamento, se você optar por informar.</li>
        <li>Registro de que você leu este aviso (versão e data/hora).</li>
        <li>Data e hora do envio da solicitação.</li>
        <li>Dados técnicos de segurança: o endereço IP e sinais do navegador são analisados no momento do envio para bloquear robôs e abusos. O IP não é gravado em claro: guardamos apenas um código irreversível (pseudônimo) para limitar tentativas repetidas.</li>
      </ul>
      <h2>Para que usamos e com qual base legal</h2><ul className="list-disc pl-5">
        <li><strong className="text-marfim">Tratar sua solicitação de atendimento</strong> — registrar o pedido, analisar a disponibilidade e falar com você pelo WhatsApp ou e-mail sobre ele. Base legal: procedimentos preliminares relacionados a contrato, a seu pedido (LGPD, art. 7º, V).</li>
        <li><strong className="text-marfim">Segurança do site e prevenção de abusos</strong> — limite de tentativas e registros técnicos. Base legal: legítimo interesse (LGPD, art. 7º, IX), limitado ao necessário.</li>
        <li><strong className="text-marfim">Registro de cada solicitação</strong> — para demonstrar o que foi solicitado e quando. Base legal: exercício regular de direitos (LGPD, art. 7º, VI).</li>
      </ul>
      <p>Seus dados não são exibidos publicamente e não são usados para publicidade ou campanhas. Marcar que leu este aviso não é um consentimento para outras finalidades.</p>
      <h2>Quem pode acessar</h2><p>Somente o profissional responsável. Também participam do funcionamento do site, como operadores, os provedores de infraestrutura Vercel (hospedagem) e Supabase (banco de dados). As solicitações ficam armazenadas no Brasil (São Paulo); a Vercel é uma empresa estrangeira e pode processar dados técnicos de acesso fora do país. Ao final do envio, o site abre o seu WhatsApp com a mensagem pronta para o profissional: essa conversa acontece no próprio WhatsApp, sob a política dele.</p>
      <h2>Como protegemos</h2><p>Conexão criptografada (HTTPS), banco de dados sem acesso público (somente o servidor do site grava as solicitações) e registros técnicos sem dados pessoais desnecessários.</p>
      <h2>Por quanto tempo guardamos</h2><p>As solicitações enviadas pelo site são guardadas por até 1 ano a partir do envio e depois apagadas automaticamente. Registros técnicos de segurança: pseudônimos usados para limitar tentativas são apagados após 2 dias; controles internos contra envio duplicado, após 7 dias. Conversas pelo WhatsApp ficam no próprio aplicativo e não são controladas por este site.</p>
      <h2>Seus direitos</h2><p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização ou eliminação dos seus dados, entre outros direitos da LGPD (Lei 13.709/2018), e também apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD). Para exercer seus direitos, fale pelo {contato}.</p>
    </main>);
}
