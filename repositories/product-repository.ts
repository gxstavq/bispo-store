import { fetchProducts } from "@/repositories/supabase-product-repository";
import type { Product, ProductCategory } from "@/types/commerce";

export interface ProductRepository {
  list(): Promise<Product[]>;
  findBySlug(slug: string): Promise<Product | null>;
  findByCategory(category: ProductCategory): Promise<Product[]>;
  search(term: string): Promise<Product[]>;
}

export class SupabaseProductRepository implements ProductRepository {
  async list() {
    return fetchProducts();
  }

  async findBySlug(slug: string) {
    const [product] = await fetchProducts({ slug });
    return product ?? null;
  }

  async findByCategory(category: ProductCategory) {
    return fetchProducts({ category });
  }

  async search(term: string) {
    return fetchProducts({ search: term });
  }
}

export const productRepository: ProductRepository = new SupabaseProductRepository();
