import { Mail } from "lucide-react";
import { requestCustomerMagicLink } from "@/app/entrar/actions";

export function CustomerLoginForm({ next = "/checkout" }: { next?: string }) {
  return (
    <form className="customer-login-form" action={requestCustomerMagicLink}>
      <input type="hidden" name="next" value={next} />
      <label>
        E-mail
        <input
          required
          name="email"
          type="email"
          maxLength={254}
          autoComplete="email"
          placeholder="voce@exemplo.com"
        />
      </label>
      <button className="button button--red button--full">
        <Mail size={18} /> Receber link de acesso
      </button>
    </form>
  );
}
