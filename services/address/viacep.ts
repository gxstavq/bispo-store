import "server-only";

import { isBrazilianState } from "@/lib/brazilian-states";

const VIA_CEP_ORIGIN = "https://viacep.com.br";
const REQUEST_TIMEOUT_MS = 5_000;

type ViaCepResponse = {
  cep?: unknown;
  logradouro?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  localidade?: unknown;
  uf?: unknown;
  erro?: unknown;
};

export type PostalAddress = {
  postalCode: string;
  street: string;
  district: string;
  city: string;
  state: string;
};

export class PostalCodeLookupError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PostalCodeLookupError";
  }
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePostalCode(value: string) {
  return value.replace(/\D/g, "");
}

export async function lookupPostalAddress(
  value: string,
  request: typeof fetch = fetch,
): Promise<PostalAddress> {
  const postalCode = normalizePostalCode(value);
  if (postalCode.length !== 8) {
    throw new PostalCodeLookupError("Informe um CEP válido com 8 dígitos.", 400);
  }

  let response: Response;
  try {
    response = await request(`${VIA_CEP_ORIGIN}/ws/${postalCode}/json/`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "BispoStore/1.0 (consulta de endereço)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PostalCodeLookupError(
      "Não foi possível consultar o CEP agora. Tente novamente em instantes.",
      502,
    );
  }

  if (!response.ok) {
    throw new PostalCodeLookupError(
      "O serviço de CEP está temporariamente indisponível.",
      502,
    );
  }

  let result: ViaCepResponse;
  try {
    result = await response.json() as ViaCepResponse;
  } catch {
    throw new PostalCodeLookupError(
      "O serviço de CEP retornou uma resposta inválida.",
      502,
    );
  }

  if (result.erro === true || result.erro === "true") {
    throw new PostalCodeLookupError("CEP não encontrado. Confira os números informados.", 404);
  }

  const state = stringField(result.uf).toUpperCase();
  if (!isBrazilianState(state)) {
    throw new PostalCodeLookupError(
      "Não foi possível identificar a UF deste CEP.",
      422,
    );
  }

  const city = stringField(result.localidade);
  if (!city) {
    throw new PostalCodeLookupError(
      "Não foi possível identificar a cidade deste CEP.",
      422,
    );
  }

  return {
    postalCode,
    street: stringField(result.logradouro),
    district: stringField(result.bairro),
    city,
    state,
  };
}
