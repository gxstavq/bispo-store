"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, Search, ShoppingBag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useStore } from "./store-provider";

const links = [
  { href: "/catalogo", label: "Todos" },
  { href: "/categoria/tenis", label: "Tênis" },
  { href: "/categoria/calcas", label: "Calças" },
  { href: "/categoria/conjuntos", label: "Conjuntos" },
  { href: "/catalogo?filtro=ofertas", label: "Ofertas" },
  { href: "/sobre", label: "Nossa história" },
];

export function Header() {
  const router = useRouter();
  const { cartCount } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (search.trim()) router.push(`/pesquisa?q=${encodeURIComponent(search.trim())}`);
  };

  return (
    <>
      <div className="announcement">
        <span>DROP DE APRESENTAÇÃO · PRODUTOS E VALORES FICTÍCIOS</span>
        <span className="announcement__desktop">ENTREGAS SOMENTE EM SÃO PAULO</span>
      </div>
      <header className="site-header">
        <div className="container header-main">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu />
          </button>
          <Link href="/" className="brand" aria-label="Bispo Store — início">
            <Image src="/logo-bispo-store.png" width={98} height={98} alt="Bispo Store" priority />
          </Link>
          <form className="header-search" onSubmit={submitSearch}>
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Busque por tênis, calça, conjunto ou código..." aria-label="Pesquisar produtos" />
            <button type="submit">Buscar</button>
          </form>
          <Link href="/carrinho" className="cart-link" aria-label={`Carrinho com ${cartCount} itens`}>
            <ShoppingBag />
            <span>{cartCount}</span>
            <em>Carrinho</em>
          </Link>
        </div>
        <nav className="desktop-nav" aria-label="Categorias principais">
          <div className="container">
            {links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
            <Link href="/acompanhar-pedido" className="nav-track">Acompanhar pedido</Link>
          </div>
        </nav>
      </header>
      {mobileOpen && (
        <div className="mobile-menu">
          <div className="mobile-menu__header">
            <span>MENU</span>
            <button className="icon-button" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X /></button>
          </div>
          <form className="mobile-search" onSubmit={submitSearch}>
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="O que você procura?" />
          </form>
          <nav>
            {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}>{link.label}</Link>)}
            <Link href="/acompanhar-pedido" onClick={() => setMobileOpen(false)}>Acompanhar pedido</Link>
            <Link href="/contato" onClick={() => setMobileOpen(false)}>Contato</Link>
          </nav>
          <p>Versão de demonstração · Bispo Store</p>
        </div>
      )}
    </>
  );
}
