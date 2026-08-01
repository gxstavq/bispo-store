import { Footer } from "./footer";
import { Header } from "./header";
import { StoreProvider } from "./store-provider";
import { WhatsappFloat } from "./whatsapp-float";
import { fetchPublicCategories } from "@/repositories/category-repository";

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const categories = await fetchPublicCategories();
  return (
    <StoreProvider>
      <Header categories={categories} />
      <main>{children}</main>
      <Footer categories={categories} />
      <WhatsappFloat />
    </StoreProvider>
  );
}
