"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Boxes, ChevronRight, FolderTree, LogOut,
  Settings, Shirt, ShoppingBag, Store, Users,
} from "lucide-react";
import { logoutAdmin } from "@/app/admin/actions";

const nav = [
  { href: "/admin/dashboard", label: "Visão geral", icon: BarChart3 },
  { href: "/admin/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/produtos", label: "Produtos", icon: Shirt },
  { href: "/admin/categorias", label: "Categorias", icon: FolderTree },
  { href: "/admin/estoque", label: "Estoque", icon: Boxes },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export function AdminShell({ children, displayName }: { children: React.ReactNode; displayName: string }) {
  const pathname = usePathname();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/admin/dashboard" className="admin-brand"><Image src="/logo-bispo-store.png" width={58} height={58} alt="Bispo Store" /><div><strong>BISPO</strong><span>ADMIN · SEGURO</span></div></Link>
        <nav>
          <span className="admin-nav-title">OPERAÇÃO</span>
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} className={active ? "is-active" : ""}><Icon size={19} /><span>{item.label}</span>{active && <ChevronRight size={16} />}</Link>;
          })}
        </nav>
        <div className="admin-store-status"><Store size={19} /><div><strong>Supabase conectado</strong><span>Acesso administrativo</span></div></div>
        <form action={logoutAdmin}><button className="admin-logout"><LogOut size={18} /> Encerrar sessão</button></form>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div><span>Painel de controle</span><strong>Olá, {displayName}.</strong></div>
          <div className="admin-topbar__actions"><span><i /> Sessão protegida</span><Link href="/" target="_blank">Ver loja</Link></div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
      <nav className="admin-mobile-nav">
        {nav.slice(0, 5).map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "is-active" : ""}><Icon size={19} /><span>{item.label.split(" ")[0]}</span></Link>; })}
      </nav>
    </div>
  );
}
