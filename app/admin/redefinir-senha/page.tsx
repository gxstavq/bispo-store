import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin";
import { updateAdminPassword } from "../actions";

const messages: Record<string, string> = {
  "senhas-diferentes": "As senhas informadas são diferentes.",
  "senha-invalida": "A senha deve ter entre 12 e 128 caracteres.",
  "nao-atualizada": "Não foi possível atualizar a senha. Solicite um novo link.",
};

export default async function AdminPasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/admin?erro=acesso-negado");
  const { erro } = await searchParams;
  return (
    <main className="admin-login">
      <form className="admin-login__form" action={updateAdminPassword}>
        <span className="demo-pill">SESSÃO VERIFICADA</span>
        <h1>Definir nova senha</h1>
        <p>Use pelo menos 12 caracteres e não reutilize senhas de outros serviços.</p>
        {erro && <div className="admin-feedback" role="alert">{messages[erro] ?? "Não foi possível continuar."}</div>}
        <label>Nova senha<input required name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <label>Confirmar senha<input required name="confirmation" type="password" minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <button type="submit" className="button button--red button--full">Atualizar senha</button>
      </form>
    </main>
  );
}
