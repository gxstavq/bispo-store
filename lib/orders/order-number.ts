const ORDER_NUMBER_PATTERN = /^BSP-[A-F0-9]{8}$/;

export function isValidOrderNumber(value: unknown): value is string {
  return typeof value === "string" && ORDER_NUMBER_PATTERN.test(value);
}

export function pagBankReturnUrl(baseUrl: string, orderNumber: string) {
  if (!isValidOrderNumber(orderNumber)) {
    throw new Error("Número de pedido inválido para retorno do PagBank.");
  }
  const url = new URL(baseUrl);
  url.searchParams.set("pedido", orderNumber);
  return url.toString();
}
