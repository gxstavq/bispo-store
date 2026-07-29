import "server-only";

import { headers } from "next/headers";

export async function clientIpAddress() {
  const incoming = await headers();
  return incoming.get("x-nf-client-connection-ip")
    ?? incoming.get("cf-connecting-ip")
    ?? incoming.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}
