import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { loginAdmin, requestAdminPasswordReset } from "./actions";

const errorMessages: Record<string, string> = {
  "campos-obrigatorios": "Informe e-mail e senha.",
  "credenciais-invalidas": "E-mail ou senha inválidos.",
  "acesso-negado": "Esta conta não possui permissão administrativa.",
  "muitas-tentativas": "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; recuperacao?: string; senha?: string }>;
}) {
  const { erro, recuperacao, senha } = await searchParams;
  return (
    <main className="admin-login">
      <div className="admin-login__brand">
        <Image src="/logo-bispo-store.png" width={140} height={140} alt="Bispo Store" />
        <div><span>CONTROLE A OPERAÇÃO.</span><h1>Seu drop.<br />Seus pedidos.<br />Seu ritmo.</h1><p>Acesso protegido pelo Supabase Auth e pelas políticas de segurança do banco.</p></div>
      </div>
      <form className="admin-login__form" action={loginAdmin}>
        <span className="demo-pill">ACESSO RESTRITO</span>
        <h2>Acessar painel</h2>
        <p>Somente contas cadastradas e ativas em <code>admin_users</code>.</p>
        {erro && <div className="admin-feedback" role="alert">{errorMessages[erro] ?? "Não foi possível acessar o painel."}</div>}
        {recuperacao && <div className="admin-feedback" role="status">Se o e-mail estiver habilitado, enviaremos as instruções de redefinição.</div>}
        {senha === "alterada" && <div className="admin-feedback" role="status">Senha alterada. Entre novamente.</div>}
        <label>E-mail<input required name="email" type="email" autoComplete="email" /></label>
        <label>Senha<input required name="password" type="password" autoComplete="current-password" /></label>
        <button type="submit" className="button button--red button--full">Entrar no painel <ArrowRight size={18} /></button>
        <div className="admin-login__safe"><LockKeyhole size={16} /> Nenhuma credencial é armazenada no frontend.</div>
        <Link href="/">← Voltar para a loja</Link>
      </form>
      <form className="admin-login__form" action={requestAdminPasswordReset}>
        <h2>Esqueci minha senha</h2>
        <p>Informe o e-mail administrativo. A resposta não revela se uma conta existe.</p>
        <label>E-mail<input required name="email" type="email" autoComplete="email" /></label>
        <button type="submit" className="button button--dark button--full">Enviar redefinição</button>
      </form>
    </main>
  );
}
