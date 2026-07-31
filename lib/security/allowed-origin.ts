const AUTHORIZED_NETLIFY_ORIGINS = new Set([
  "https://bispostorebr.com.br",
  "https://www.bispostorebr.com.br",
  "https://bispo-store-homologacao.netlify.app",
  "https://deploy-preview-1--bispo-store-homologacao.netlify.app",
]);

type NetlifyOriginEnvironment = {
  NEXT_PUBLIC_SITE_URL?: string;
  URL?: string;
  DEPLOY_PRIME_URL?: string;
  NODE_ENV?: string;
};

function normalizedOrigin(value?: string) {
  if (!value) return null;

  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function allowedRequestOrigins(
  requestUrlOrigin: string,
  environment: NetlifyOriginEnvironment,
) {
  const allowed = new Set<string>();
  const candidates = [
    environment.NEXT_PUBLIC_SITE_URL,
    environment.URL,
    environment.DEPLOY_PRIME_URL,
  ];

  for (const candidate of candidates) {
    const origin = normalizedOrigin(candidate);
    if (origin && AUTHORIZED_NETLIFY_ORIGINS.has(origin)) {
      allowed.add(origin);
    }
  }

  const currentOrigin = normalizedOrigin(requestUrlOrigin);
  if (currentOrigin && AUTHORIZED_NETLIFY_ORIGINS.has(currentOrigin)) {
    allowed.add(currentOrigin);
  }

  if (environment.NODE_ENV !== "production" && currentOrigin) {
    const hostname = new URL(currentOrigin).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      allowed.add(currentOrigin);
    }
  }

  return allowed;
}
