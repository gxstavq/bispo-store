import assert from "node:assert/strict";
import test from "node:test";
import { productCompleteness } from "../lib/products/completeness.ts";

const completeProduct = {
  id: "product-test",
  name: "Tênis Urban Pulse",
  slug: "tenis-urban-pulse",
  code: "BSP-UP-001",
  category: "tenis",
  description: "Tênis urbano com acabamento premium e solado confortável.",
  price: 299.9,
  images: ["/products/urban-pulse.webp"],
  coverImage: "/products/urban-pulse.webp",
  imageType: "photo",
  sizes: ["38", "39"],
  colors: ["Preto"],
  stock: 2,
  featured: false,
  isNew: false,
  active: true,
  imagesConfirmed: true,
  demo: true,
  visual: { accent: "#ef2b35", secondary: "#f7f7f4", type: "shoe" },
};

test("cadastro completo fica pronto somente após confirmação explícita das imagens", () => {
  assert.deepEqual(productCompleteness(completeProduct), { complete: true, missing: [] });
  const pending = productCompleteness({ ...completeProduct, imagesConfirmed: false });
  assert.equal(pending.complete, false);
  assert.ok(pending.missing.includes("confirmação das imagens"));
});

test("nome, descrição, tamanho e cor provisórios mantêm o cadastro pendente", () => {
  const pending = productCompleteness({
    ...completeProduct,
    name: "Tênis 016",
    description: "Produto provisório aguardando cadastro",
    sizes: ["A definir"],
    colors: ["A definir"],
  });
  assert.equal(pending.complete, false);
  assert.ok(pending.missing.includes("nome definitivo"));
  assert.ok(pending.missing.includes("descrição definitiva"));
  assert.ok(pending.missing.includes("tamanhos"));
  assert.ok(pending.missing.includes("cores"));
});
