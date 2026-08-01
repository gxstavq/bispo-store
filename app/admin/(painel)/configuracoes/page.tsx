import { AdminPageHeader } from "@/components/admin-page-header";
import { StoreSettingsForm } from "@/components/store-settings-form";
import { HomeBannerSettingsPanel } from "@/components/home-banner-settings";
import {
  isCnpjConfigured,
  readStoreSettings,
} from "@/repositories/supabase-settings-repository";
import { getMelhorEnvioConnectionStatus } from "@/repositories/integration-credentials-repository";
import { safeIntegrationConfiguration } from "@/lib/integrations/config";
import { readAdminHomeBanner } from "@/repositories/home-banner-repository";

export default async function SettingsPage() {
  const [settings, melhorEnvio, banner] = await Promise.all([
    readStoreSettings(),
    getMelhorEnvioConnectionStatus().catch(() => ({
      connected: false,
      unavailable: true,
    })),
    readAdminHomeBanner(),
  ]);
  return (
    <>
      <AdminPageHeader eyebrow="SISTEMA" title="Configurações." description="Dados comerciais e de origem preparados para as integrações futuras." />
      <StoreSettingsForm
        initial={settings}
        cnpjConfigured={isCnpjConfigured()}
        integrations={safeIntegrationConfiguration()}
        melhorEnvio={melhorEnvio}
      />
      <HomeBannerSettingsPanel initial={banner.current} hasPrevious={Boolean(banner.previous)} />
    </>
  );
}
