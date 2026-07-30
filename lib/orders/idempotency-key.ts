const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORAGE_KEY = "bispo-store:order-idempotency";

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAttempt = {
  key: string;
  fingerprint: string;
};

function fingerprintToken(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function isValidOrderIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function getOrCreateOrderIdempotencyKey(
  storage: MinimalStorage,
  fingerprint: string,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const token = fingerprintToken(fingerprint);
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as StoredAttempt | null;
    if (
      stored
      && stored.fingerprint === token
      && isValidOrderIdempotencyKey(stored.key)
    ) {
      return stored.key;
    }
  } catch {
    // Uma entrada inválida é substituída sem impedir o checkout.
  }
  const key = createKey();
  if (!isValidOrderIdempotencyKey(key)) {
    throw new Error("Não foi possível gerar uma chave segura para o pedido.");
  }
  storage.setItem(STORAGE_KEY, JSON.stringify({ key, fingerprint: token }));
  return key;
}

export function clearOrderIdempotencyKey(storage: MinimalStorage) {
  storage.removeItem(STORAGE_KEY);
}
