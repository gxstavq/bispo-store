import type { MetadataRoute } from "next";
import { productRepository } from "@/repositories/product-repository";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bispastore.com.br";
  const products = await productRepository.list();
  const staticRoutes = [
    "", "/catalogo", "/categoria/tenis", "/categoria/calcas", "/categoria/conjuntos", "/sobre", "/contato",
    "/trocas-e-devolucoes", "/privacidade", "/termos", "/acompanhar-pedido",
  ];
  return [
    ...staticRoutes.map((route) => ({
      url: `${baseUrl}${route}`,
      lastModified: new Date(),
      changeFrequency: route === "" ? "weekly" as const : "monthly" as const,
      priority: route === "" ? 1 : route.includes("categoria") || route === "/catalogo" ? 0.8 : 0.5,
    })),
    ...products.map((product) => ({
      url: `${baseUrl}/produto/${product.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
