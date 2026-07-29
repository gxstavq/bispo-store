import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const { user, admin } = await requireAdmin();
  return <AdminShell displayName={admin.display_name ?? user.email ?? "Administrador"}>{children}</AdminShell>;
}
