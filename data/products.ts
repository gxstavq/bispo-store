import type { Product } from "@/types/commerce";
import {
  allCategoryLabels,
  defaultsForCategory,
  isSellableCategory,
  publicCategoryLabels,
} from "@/lib/product-rules";
import provisionalProducts from "./provisional-products.generated.json";

const legacyProducts: Product[] = [
  {
    id: "p01", name: "Pulse Runner 01", slug: "pulse-runner-01", code: "BSP-TN-001", category: "tenis",
    description: "Tênis urbano de demonstração com construção leve, linhas dinâmicas e conforto para a rotina.", price: 429.9, promotionalPrice: 359.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["37", "38", "39", "40", "41", "42", "43"], colors: ["Vermelho", "Preto"], stock: 12,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#ef2b35", secondary: "#f7f7f4", type: "shoe" },
  },
  {
    id: "p02", name: "Night Shift Low", slug: "night-shift-low", code: "BSP-TN-002", category: "tenis",
    description: "Silhueta baixa de inspiração noturna com acabamento monocromático e sola de alto contraste.", price: 389.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["37", "38", "39", "40", "41", "42"], colors: ["Preto", "Grafite"], stock: 7,
    featured: true, isNew: false, active: true, demo: true, visual: { accent: "#222226", secondary: "#8c8c92", type: "shoe" },
  },
  {
    id: "p03", name: "District 90", slug: "district-90", code: "BSP-TN-003", category: "tenis",
    description: "Proporções retrô, base clara e detalhes marcantes para composições streetwear.", price: 449.9, promotionalPrice: 399.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["36", "37", "38", "39", "40", "41", "42"], colors: ["Branco", "Vermelho"], stock: 18,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#f2efe8", secondary: "#d9212d", type: "shoe" },
  },
  {
    id: "p04", name: "Apex Street", slug: "apex-street", code: "BSP-TN-004", category: "tenis",
    description: "Tênis robusto com recortes técnicos e visual contemporâneo para destacar qualquer produção.", price: 479.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["38", "39", "40", "41", "42", "43", "44"], colors: ["Cinza", "Preto"], stock: 5,
    featured: false, isNew: true, active: true, demo: true, visual: { accent: "#a9abb0", secondary: "#26262b", type: "shoe" },
  },
  {
    id: "p05", name: "Redline Classic", slug: "redline-classic", code: "BSP-TN-005", category: "tenis",
    description: "Clássico casual revisitado com assinatura vermelha e cabedal visualmente limpo.", price: 349.9, promotionalPrice: 299.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["36", "37", "38", "39", "40", "41"], colors: ["Branco", "Preto"], stock: 22,
    featured: true, isNew: false, active: true, demo: true, visual: { accent: "#f8f6f0", secondary: "#ee2934", type: "shoe" },
  },
  {
    id: "p06", name: "Concrete Flow", slug: "concrete-flow", code: "BSP-TN-006", category: "tenis",
    description: "Mix de tons minerais, volumes equilibrados e presença urbana para o dia a dia.", price: 419.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["37", "38", "39", "40", "41", "42", "43"], colors: ["Areia", "Cinza"], stock: 9,
    featured: false, isNew: false, active: true, demo: true, visual: { accent: "#c8bca9", secondary: "#74777b", type: "shoe" },
  },
  {
    id: "p07", name: "Velocity Knit", slug: "velocity-knit", code: "BSP-TN-007", category: "tenis",
    description: "Construção knit conceitual, desenho esportivo e leveza visual para acompanhar o ritmo.", price: 399.9, promotionalPrice: 339.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["38", "39", "40", "41", "42", "43"], colors: ["Preto", "Vermelho"], stock: 4,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#111114", secondary: "#e12731", type: "shoe" },
  },
  {
    id: "p08", name: "Mono Court", slug: "mono-court", code: "BSP-TN-008", category: "tenis",
    description: "Tênis clean inspirado nas quadras, com acabamento tonal e fácil combinação.", price: 369.9,
    images: ["Frente", "Lateral", "Detalhe"], sizes: ["36", "37", "38", "39", "40", "41", "42"], colors: ["Off-white", "Preto"], stock: 16,
    featured: false, isNew: false, active: true, demo: true, visual: { accent: "#eae8df", secondary: "#3a3a3d", type: "shoe" },
  },
  {
    id: "p09", name: "Camiseta Essential Box", slug: "camiseta-essential-box", code: "BSP-CM-001", category: "camisetas",
    description: "Camiseta boxy de demonstração em malha encorpada, gola firme e identidade minimalista.", price: 129.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG"], colors: ["Preto", "Branco"], stock: 24,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#17171a", secondary: "#f4f1ea", type: "shirt" },
  },
  {
    id: "p10", name: "Camiseta Bishop Signal", slug: "camiseta-bishop-signal", code: "BSP-CM-002", category: "camisetas",
    description: "Modelagem ampla com gráfico conceitual inspirado na assinatura visual da Bispo Store.", price: 149.9, promotionalPrice: 119.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG"], colors: ["Vermelho", "Preto"], stock: 14,
    featured: true, isNew: false, active: true, demo: true, visual: { accent: "#d9222e", secondary: "#151518", type: "shirt" },
  },
  {
    id: "p11", name: "Camiseta Off Grid", slug: "camiseta-off-grid", code: "BSP-CM-003", category: "camisetas",
    description: "Base clara, estampa técnica e caimento confortável para looks de alto contraste.", price: 139.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG", "XGG"], colors: ["Off-white", "Cinza"], stock: 11,
    featured: false, isNew: true, active: true, demo: true, visual: { accent: "#eae5da", secondary: "#64666b", type: "shirt" },
  },
  {
    id: "p12", name: "Camiseta Core Type", slug: "camiseta-core-type", code: "BSP-CM-004", category: "camisetas",
    description: "Peça essencial com tipografia frontal discreta e construção pensada para sobreposições.", price: 119.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG"], colors: ["Chumbo", "Preto"], stock: 19,
    featured: false, isNew: false, active: true, demo: true, visual: { accent: "#4a4b50", secondary: "#141417", type: "shirt" },
  },
  {
    id: "p13", name: "Moletom Heavy Mark", slug: "moletom-heavy-mark", code: "BSP-ML-001", category: "moletons",
    description: "Moletom pesado com capuz estruturado, bolso canguru e detalhe gráfico de demonstração.", price: 299.9, promotionalPrice: 259.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG"], colors: ["Preto", "Vermelho"], stock: 8,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#19191c", secondary: "#df2530", type: "hoodie" },
  },
  {
    id: "p14", name: "Moletom Urban Layer", slug: "moletom-urban-layer", code: "BSP-ML-002", category: "moletons",
    description: "Camada urbana versátil, interior macio e modelagem relaxada para dias mais frios.", price: 279.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["P", "M", "G", "GG"], colors: ["Mescla", "Preto"], stock: 6,
    featured: false, isNew: false, active: true, demo: true, visual: { accent: "#7e8084", secondary: "#222226", type: "hoodie" },
  },
  {
    id: "p15", name: "Calça Cargo Sector", slug: "calca-cargo-sector", code: "BSP-CL-001", category: "calcas-shorts",
    description: "Calça cargo utilitária com múltiplos bolsos e ajuste relaxado de inspiração street.", price: 249.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["38", "40", "42", "44", "46"], colors: ["Preto", "Verde militar"], stock: 10,
    featured: true, isNew: true, active: true, demo: true, visual: { accent: "#202023", secondary: "#53584b", type: "bottom" },
  },
  {
    id: "p16", name: "Short Utility Block", slug: "short-utility-block", code: "BSP-SH-001", category: "calcas-shorts",
    description: "Short de sarja com bolsos funcionais, acabamento limpo e etiqueta conceitual da coleção.", price: 179.9, promotionalPrice: 149.9,
    images: ["Frente", "Costas", "Detalhe"], sizes: ["38", "40", "42", "44"], colors: ["Areia", "Preto"], stock: 3,
    featured: false, isNew: false, active: true, demo: true, visual: { accent: "#c4b69d", secondary: "#242428", type: "bottom" },
  },
];

const rawProducts: Product[] = [
  ...(provisionalProducts as unknown as Product[]),
  ...legacyProducts,
];

export const products: Product[] = rawProducts.map((source) => {
  const isLegacyPants = source.category === "calcas-shorts" && source.name.toLocaleLowerCase("pt-BR").startsWith("calça");
  const category = isLegacyPants ? "calcas" : source.category;
  const archived = !isSellableCategory(category);
  const defaults = defaultsForCategory(category);
  return {
    ...source,
    category,
    ...(defaults ?? {}),
    shippingEnabled: archived ? false : (source.shippingEnabled ?? true),
    active: archived ? false : source.active,
    status: archived ? "inactive" : (source.status ?? (source.active ? "active" : "inactive")),
    archivedAt: archived ? (source.archivedAt ?? "2026-07-27T00:00:00.000Z") : source.archivedAt,
    archiveReason: archived ? (source.archiveReason ?? "Categoria fora da operação comercial atual") : source.archiveReason,
  };
});

export const categoryLabels = publicCategoryLabels;
export const adminCategoryLabels = allCategoryLabels;
