import { AdminPageHeader } from "@/components/admin-page-header";
import { CategoriesManager } from "@/components/categories-manager";
import { fetchCategories } from "@/repositories/category-repository";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export default async function CategoriesPage() {
  const [products, categories] = await Promise.all([
    fetchProducts({ includeInactive: true }),
    fetchCategories(true),
  ]);
  const withCounts = categories.map((category) => ({
    ...category,
    productCount: products.filter((product) => product.category === category.slug).length,
  }));
  return (
    <>
      <AdminPageHeader eyebrow="ORGANIZAÇÃO" title="Categorias." description="Crie, ordene, arquive e reutilize categorias sem alterar o código da loja." />
      <CategoriesManager initial={withCounts} />
    </>
  );
}
