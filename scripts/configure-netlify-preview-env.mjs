import { spawnSync } from "node:child_process";
import path from "node:path";

const previewAlias = "security-audit-20260729";
const previewSiteUrl = `https://${previewAlias}--bispo-store-homologacao.netlify.app`;

const requiredVariables = {
  NEXT_PUBLIC_SITE_URL: previewSiteUrl,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  MELHOR_ENVIO_CLIENT_ID: process.env.MELHOR_ENVIO_CLIENT_ID,
  MELHOR_ENVIO_REDIRECT_URI: process.env.MELHOR_ENVIO_REDIRECT_URI,
  MELHOR_ENVIO_ENV: process.env.MELHOR_ENVIO_ENV,
  INTEGRATION_USER_AGENT: process.env.INTEGRATION_USER_AGENT,
  ENABLE_MELHOR_ENVIO_LABEL_PURCHASE: "false",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  INTEGRATION_ENCRYPTION_KEY: process.env.INTEGRATION_ENCRYPTION_KEY,
  MELHOR_ENVIO_CLIENT_SECRET: process.env.MELHOR_ENVIO_CLIENT_SECRET,
};

if (requiredVariables.MELHOR_ENVIO_ENV !== "sandbox") {
  throw new Error("MELHOR_ENVIO_ENV deve ser sandbox.");
}

for (const [name, value] of Object.entries(requiredVariables)) {
  if (!value?.trim()) throw new Error(`Variável obrigatória ausente: ${name}`);
}

const script = path.resolve("scripts", "configure-netlify-preview-env.ps1");
const result = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
  {
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: previewSiteUrl },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.status !== 0) {
  throw new Error("Falha ao configurar as variáveis do Deploy Preview.");
}

console.log(`URL prevista do preview: ${previewSiteUrl}`);
