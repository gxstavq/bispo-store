export function shouldRefreshMelhorEnvioToken(expiresAt: string, now = Date.now()) {
  return new Date(expiresAt).getTime() <= now + 5 * 60 * 1000;
}
