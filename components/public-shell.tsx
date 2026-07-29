import { Footer } from "./footer";
import { Header } from "./header";
import { WhatsappFloat } from "./whatsapp-float";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
      <WhatsappFloat />
    </>
  );
}
