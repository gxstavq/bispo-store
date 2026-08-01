const HUMAN_ERRORS: Record<string, string> = {
  admin_required: "Sua sessão administrativa não possui permissão para esta ação.",
  category_not_found: "A categoria selecionada não existe.",
  inactive_category: "Ative a categoria antes de publicar o produto.",
  invalid_category_image: "Selecione uma imagem válida do álbum Fotos Bispo Store.",
  product_not_found: "O produto não foi encontrado.",
  invalid_price: "Confira o preço normal e o preço promocional.",
  invalid_variant: "Confira tamanhos, cores e estoques das variantes.",
  duplicate_variant: "Existe mais de uma variante com o mesmo tamanho e a mesma cor.",
  variant_product_mismatch: "Uma variante informada nÃ£o pertence a este produto. Recarregue a pÃ¡gina e tente novamente.",
  product_update_conflict: "O produto está sendo alterado em outra sessão. Aguarde um instante e tente novamente.",
  negative_stock_not_allowed: "A alteração deixaria o estoque negativo.",
  stock_adjustment_conflict: "O estoque está sendo atualizado por outra operação. Tente novamente.",
  insufficient_stock: "Não há estoque suficiente para confirmar este pagamento.",
  paid_order_cannot_be_cancelled: "Um pedido pago não pode ser cancelado por esta ação.",
  order_not_awaiting_payment: "O pedido precisa estar aguardando pagamento e com o frete definido.",
};

export function humanAdminError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const known = Object.entries(HUMAN_ERRORS).find(([code]) => message.includes(code));
  if (known) return known[1];
  if (/duplicate key|unique constraint/i.test(message)) return "Já existe um cadastro com esses dados.";
  if (/foreign key|violates.*constraint|SQLSTATE|postgres/i.test(message)) return fallback;
  return message && message.length <= 220 ? message : fallback;
}

export function sanitizedAdminError(error: unknown) {
  const candidate = error as { code?: unknown; name?: unknown };
  return {
    code: typeof candidate?.code === "string" ? candidate.code.slice(0, 24) : "unknown",
    name: typeof candidate?.name === "string" ? candidate.name.slice(0, 80) : "Error",
  };
}
