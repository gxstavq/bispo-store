import { Footer } from "./footer";
import { Header } from "./header";
import { StoreProvider } from "./store-provider";
import { WhatsappFloat } from "./whatsapp-float";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <Header />
      <main>{children}</main>
      <Footer />
      <WhatsappFloat />
    </StoreProvider>
  );
}
