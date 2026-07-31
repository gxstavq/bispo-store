import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const productsSource = readFileSync(join(root, "data", "products.ts"), "utf8");
const provisionalProducts = JSON.parse(readFileSync(join(root, "data", "provisional-products.generated.json"), "utf8"));
const localProducts = JSON.parse(readFileSync(join(root, "data", "products.local.json"), "utf8"));
const imageReport = JSON.parse(readFileSync(join(root, "reports", "image-optimization-report.json"), "utf8"));

test("catálogo preserva os 16 produtos demonstrativos originais", () => {
  const ids = productsSource.match(/id: "p\d+"/g) ?? [];
  assert.equal(ids.length, 16);
});

test("188 fotos foram associadas uma única vez a 94 produtos provisórios", () => {
  assert.equal(provisionalProducts.length, 94);
  const images = provisionalProducts.flatMap((product) => product.images);
  assert.equal(images.length, 188);
  assert.equal(new Set(images).size, 188);
  assert.ok(provisionalProducts.every((product) => product.images.length === 2));
  assert.ok(provisionalProducts.every((product) => product.needsReview === true));
});

test("relatório confirma processamento integral sem arquivos ignorados", () => {
  assert.equal(imageReport.encontradas, 188);
  assert.equal(imageReport.processadas, 188);
  assert.equal(imageReport.ignoradas, 0);
  assert.ok(imageReport.imagens.every((image) => image.tamanho_otimizado_bytes <= 450 * 1024));
});

test("todas as rotas públicas essenciais existem", () => {
  const routes = [
    "app/page.tsx", "app/catalogo/page.tsx", "app/categoria/tenis/page.tsx",
    "app/categoria/calcas/page.tsx", "app/categoria/conjuntos/page.tsx", "app/produto/[slug]/page.tsx",
    "app/pesquisa/page.tsx", "app/carrinho/page.tsx", "app/checkout/page.tsx",
    "app/pedido-recebido/page.tsx", "app/acompanhar-pedido/page.tsx",
    "app/sobre/page.tsx", "app/contato/page.tsx", "app/trocas-e-devolucoes/page.tsx",
    "app/privacidade/page.tsx", "app/termos/page.tsx", "app/not-found.tsx",
  ];
  for (const route of routes) assert.ok(existsSync(join(root, route)), `rota ausente: ${route}`);
  assert.equal(existsSync(join(root, "app", "categoria", "roupas", "page.tsx")), false);
});

test("home exibe entrega nacional sem contadores ou mensagens provisórias", () => {
  const home = readFileSync(join(root, "app", "page.tsx"), "utf8");
  const header = readFileSync(join(root, "components", "header.tsx"), "utf8");
  const footer = readFileSync(join(root, "components", "footer.tsx"), "utf8");
  assert.match(home, /hero-delivery-message">ENTREGAS PARA TODO O BRASIL/);
  assert.doesNotMatch(home, /active\.length|produtos demo|área de entrega|nova fase/i);
  assert.doesNotMatch(home, /demonstra|fictí|provis|preço de apresentação/i);
  assert.doesNotMatch(header, /produtos e valores fictícios|versão de demonstração/i);
  assert.doesNotMatch(footer, /projeto demonstrativo|produtos e preços fictícios/i);
});

test("homologação Netlify bloqueia indexação em todas as camadas", () => {
  const robots = readFileSync(join(root, "app", "robots.ts"), "utf8");
  const layout = readFileSync(join(root, "app", "layout.tsx"), "utf8");
  const netlify = readFileSync(join(root, "netlify.toml"), "utf8");
  const nextConfig = readFileSync(join(root, "next.config.ts"), "utf8");
  assert.match(robots, /disallow: "\/"/);
  assert.match(layout, /index: false/);
  assert.match(layout, /follow: false/);
  assert.match(netlify, /X-Robots-Tag = "noindex, nofollow, noarchive, nosnippet"/);
  assert.match(nextConfig, /X-Robots-Tag/);
  assert.match(nextConfig, /noindex, nofollow, noarchive, nosnippet/);
  assert.match(netlify, /npm run build -- --webpack/);
  assert.match(netlify, /ignore = "node scripts\/netlify-ignore-build\.mjs"/);
  assert.doesNotMatch(netlify, /NEXT_DISABLE_NETLIFY_EDGE|NETLIFY_NEXT_PLUGIN_SKIP/);
  assert.doesNotMatch(netlify, /SUPABASE|PAGBANK|MELHOR_ENVIO|STORE_CNPJ/);
});

test("integrações Sandbox ficam em rotas e serviços de servidor", () => {
  const config = readFileSync(join(root, "lib", "integrations", "config.ts"), "utf8");
  const env = readFileSync(join(root, ".env.example"), "utf8");
  const melhorEnvioCallback = readFileSync(
    join(root, "app", "api", "integrations", "melhor-envio", "callback", "route.ts"),
    "utf8",
  );
  assert.match(config, /sandbox\.melhorenvio\.com\.br/);
  assert.match(config, /sandbox\.api\.pagseguro\.com/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_(?:PAGBANK|MELHOR_ENVIO)/);
  assert.match(env, /^ENABLE_MELHOR_ENVIO_LABEL_PURCHASE=$/m);
  assert.match(melhorEnvioCallback, /process\.env\.NEXT_PUBLIC_SITE_URL/);
});

test("painel possui persistência Supabase, Storage e operações CRUD protegidas", () => {
  assert.ok(existsSync(join(root, "repositories", "supabase-product-repository.ts")));
  assert.ok(existsSync(join(root, "lib", "supabase", "server.ts")));
  assert.ok(existsSync(join(root, "lib", "auth", "admin.ts")));
  assert.ok(existsSync(join(root, "app", "api", "products", "[id]", "route.ts")));
  assert.ok(existsSync(join(root, "app", "api", "products", "[id]", "actions", "route.ts")));
  assert.ok(existsSync(join(root, "app", "api", "admin", "uploads", "route.ts")));
  assert.ok(existsSync(join(root, "app", "api", "orders", "[id]", "route.ts")));
  assert.ok(existsSync(join(root, "repositories", "order-repository.ts")));
  assert.equal(existsSync(join(root, "components", "supabase-session-refresher.tsx")), false);
  assert.ok(existsSync(join(root, "proxy.ts")));
});

test("painel administra o álbum sem apagar arquivos nem agrupar fotos automaticamente", () => {
  const uploadRoute = readFileSync(join(root, "app", "api", "admin", "uploads", "route.ts"), "utf8");
  const form = readFileSync(join(root, "components", "product-form-demo.tsx"), "utf8");
  const repository = readFileSync(join(root, "repositories", "supabase-product-repository.ts"), "utf8");
  assert.match(uploadRoute, /export async function GET/);
  assert.match(uploadRoute, /\.from\("product_images"\)/);
  assert.match(uploadRoute, /\.list\(adminPrefix/);
  assert.match(uploadRoute, /validImageSignature/);
  assert.match(uploadRoute, /12 \* 1024 \* 1024/);
  assert.doesNotMatch(uploadRoute, /storage[\s\S]*\.remove\(/);
  assert.match(form, /Álbum de imagens/);
  assert.match(form, /selectAlbumImage/);
  assert.match(form, /multiple accept="image\/jpeg,image\/png,image\/webp,image\/avif"/);
  assert.match(form, /Definir como imagem principal/);
  assert.match(form, /moveImage/);
  assert.match(form, /imagesConfirmed/);
  assert.match(repository, /revalidateTag\("public-products", \{ expire: 0 \}\)/);
});

test("produtos incompletos não entram no sitemap nem recebem dados estruturados", () => {
  const sitemap = readFileSync(join(root, "app", "sitemap.ts"), "utf8");
  const productPage = readFileSync(join(root, "app", "produto", "[slug]", "page.tsx"), "utf8");
  const card = readFileSync(join(root, "components", "product-card.tsx"), "utf8");
  const detail = readFileSync(join(root, "components", "product-detail.tsx"), "utf8");
  assert.match(sitemap, /products\.filter\(isProductComplete\)/);
  assert.match(productPage, /index: false, follow: true/);
  assert.match(productPage, /isProductComplete\(product\) && <script/);
  assert.doesNotMatch(card, /DADO DEMO/);
  assert.doesNotMatch(detail, /PRODUTO DEMONSTRATIVO/);
});

test("checkout oferece análise local e cotação Melhor Envio Sandbox", () => {
  const checkout = readFileSync(join(root, "components", "checkout-form.tsx"), "utf8");
  const quoteRoute = readFileSync(
    join(root, "app", "api", "shipping", "quotes", "route.ts"),
    "utf8",
  );
  const orderRoute = readFileSync(join(root, "app", "api", "orders", "route.ts"), "utf8");
  const customerSession = readFileSync(
    join(root, "lib", "auth", "customer-session.ts"),
    "utf8",
  );
  assert.match(checkout, /brazilianStates\.map/);
  assert.match(checkout, /Solicitar análise de entrega local grátis em até 5 km/);
  assert.match(checkout, /disabled=\{!localDeliveryCanBeRequested\}/);
  assert.match(checkout, /Calcular frete para meu endereço/);
  assert.match(checkout, /\/api\/shipping\/quotes/);
  assert.match(checkout, /type="button"[\s\S]*calculateShipping/);
  assert.doesNotMatch(checkout, /router\.push\("\/entrar\?next=\/checkout"\)/);
  assert.match(checkout, /createPaymentCheckout/);
  assert.match(checkout, /Nada será cobrado ou liberado automaticamente/i);
  assert.match(quoteRoute, /getOrCreateCheckoutUser/);
  assert.match(orderRoute, /getOrCreateCheckoutUser/);
  assert.doesNotMatch(quoteRoute, /loginRequired/);
  assert.doesNotMatch(orderRoute, /loginRequired/);
  assert.match(customerSession, /guest-checkout-session/);
  assert.match(customerSession, /limit:\s*5/);
  assert.match(customerSession, /createSupabaseServiceClient/);
  assert.match(customerSession, /signInWithPassword/);
  assert.match(customerSession, /guest_checkout:\s*true/);
  assert.doesNotMatch(customerSession, /NEXT_PUBLIC_[A-Z_]*(?:SECRET|SERVICE|TOKEN)/);
});

test("checkout consulta o CEP no servidor e preenche o endereço automaticamente", () => {
  const checkout = readFileSync(join(root, "components", "checkout-form.tsx"), "utf8");
  const route = readFileSync(join(root, "app", "api", "address", "cep", "route.ts"), "utf8");
  const service = readFileSync(join(root, "services", "address", "viacep.ts"), "utf8");
  assert.match(checkout, /\/api\/address\/cep\?postalCode=/);
  assert.match(checkout, /Buscando endereço/);
  assert.match(checkout, /Se necessário, você pode corrigir os campos preenchidos/);
  assert.doesNotMatch(checkout, /readOnly=\{addressLookupStatus === "success"/);
  assert.match(checkout, /Complemento \/ apartamento/);
  assert.match(route, /postal-code-lookup/);
  assert.match(route, /limit: 30/);
  assert.match(service, /https:\/\/viacep\.com\.br/);
  assert.match(service, /isBrazilianState/);
  assert.doesNotMatch(service, /state !== "SP"/);
  assert.match(checkout, /resolvedState === "SP"/);
  assert.doesNotMatch(service, /NEXT_PUBLIC_/);
});

test("envio nacional preserva entrega local apenas para SP e possui migration retrocompatível", () => {
  const validation = readFileSync(join(root, "lib", "validation", "commerce.ts"), "utf8");
  const orderRoute = readFileSync(join(root, "app", "api", "orders", "route.ts"), "utf8");
  const migration = readFileSync(
    join(root, "supabase", "migrations", "20260729150000_nationwide_shipping.sql"),
    "utf8",
  );
  assert.match(validation, /isBrazilianState/);
  assert.match(validation, /deliveryChoice === "local_delivery_review" && state !== "SP"/);
  assert.match(orderRoute, /deliveryChoice === "local_delivery_review"/);
  assert.match(orderRoute, /state: input\.customer\.state/);
  assert.match(migration, /addresses_state_br_uf_check/);
  assert.match(migration, /local_delivery_unavailable_for_state/);
  assert.match(migration, /address_state/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from/i);
});

test("migration preserva dados antigos e arquiva categorias fora da operação", () => {
  assert.equal(localProducts.length, 110);
  const archived = localProducts.filter((product) => ["camisetas", "moletons", "calcas-shorts"].includes(product.category));
  assert.equal(archived.length, 7);
  assert.ok(archived.every((product) => product.active === false && product.status === "inactive"));
  assert.ok(archived.every((product) => product.archiveReason));
});

test("produtos vendáveis possuem dados de envio editáveis e padrões migrados", () => {
  const sellable = localProducts.filter((product) => ["tenis", "calcas", "conjuntos"].includes(product.category));
  assert.ok(sellable.every((product) => product.stock !== undefined));
  assert.ok(sellable.every((product) => product.weightKg > 0));
  assert.ok(sellable.every((product) => product.lengthCm > 0 && product.widthCm > 0 && product.heightCm > 0));
  assert.ok(sellable.every((product) => product.packagingCategory && product.shippingEnabled === true));
  const shoe = sellable.find((product) => product.category === "tenis");
  assert.equal(shoe.weightKg, 1.25);
  assert.equal(shoe.lengthCm, 33);
});

test("novos estados e decisões de entrega estão implementados", () => {
  const types = readFileSync(join(root, "types", "commerce.ts"), "utf8");
  const orderApi = readFileSync(join(root, "app", "api", "orders", "[id]", "route.ts"), "utf8");
  const schema = readFileSync(join(root, "supabase", "migrations", "20260727170000_schema.sql"), "utf8");
  for (const status of [
    "awaiting_local_delivery_review", "local_delivery_approved", "local_delivery_rejected",
    "awaiting_shipping_selection", "awaiting_payment", "paid", "preparing",
    "shipped", "delivered", "cancelled",
  ]) assert.match(types, new RegExp(status));
  assert.match(orderApi, /approve_local/);
  assert.match(orderApi, /reject_local/);
  assert.match(schema, /decided_by/);
  assert.match(schema, /decided_at/);
});

test("configurações comerciais usam CNPJ somente no servidor", () => {
  const settings = readFileSync(join(root, "supabase", "migrations", "20260727172000_seed_settings.sql"), "utf8");
  const envExample = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(settings, /Avenida São Miguel, 5046/);
  assert.match(settings, /03870-100/);
  assert.match(settings, /5511972938269/);
  assert.match(settings, /bispostorebr@hotmail.com/);
  assert.match(envExample, /^STORE_CNPJ=/m);
  assert.doesNotMatch(envExample, /STORE_CNPJ=.+/);
});

test("configurações administrativas continuam disponíveis se o status OAuth falhar", () => {
  const page = readFileSync(
    join(root, "app", "admin", "(painel)", "configuracoes", "page.tsx"),
    "utf8",
  );
  const form = readFileSync(join(root, "components", "store-settings-form.tsx"), "utf8");
  assert.match(page, /getMelhorEnvioConnectionStatus\(\)\.catch/);
  assert.match(page, /unavailable: true/);
  assert.match(form, /Status indisponível/);
  assert.match(form, /As demais configurações continuam disponíveis/);
});

test("catálogo e painéis evitam carregar todos os produtos de uma vez", () => {
  const catalogPage = readFileSync(join(root, "app", "catalogo", "page.tsx"), "utf8");
  const catalog = readFileSync(join(root, "components", "catalog-view.tsx"), "utf8");
  const cartPage = readFileSync(join(root, "app", "carrinho", "page.tsx"), "utf8");
  const checkoutPage = readFileSync(join(root, "app", "checkout", "page.tsx"), "utf8");
  const cartProducts = readFileSync(join(root, "components", "use-cart-products.ts"), "utf8");
  const adminProducts = readFileSync(join(root, "components", "admin-products-manager.tsx"), "utf8");
  const productVisual = readFileSync(join(root, "components", "product-visual.tsx"), "utf8");
  const proxy = readFileSync(join(root, "proxy.ts"), "utf8");

  assert.match(catalogPage, /limit: 24/);
  assert.match(catalog, /PAGE_SIZE = 24/);
  assert.match(catalog, /Carregar mais produtos/);
  assert.doesNotMatch(cartPage, /productRepository|fetchProducts/);
  assert.doesNotMatch(checkoutPage, /productRepository|fetchProducts/);
  assert.match(cartProducts, /\/api\/products\?ids=/);
  assert.match(adminProducts, /pageSize = 25/);
  assert.match(adminProducts, /paginated/);
  assert.doesNotMatch(productVisual, /unoptimized/);
  assert.match(productVisual, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.doesNotMatch(proxy, /_next\/static\|_next\/image/);
  assert.match(proxy, /"\/admin\/:path\*"/);
});

test("consultas de produtos usam formatos e caches separados", () => {
  const repository = readFileSync(
    join(root, "repositories", "supabase-product-repository.ts"),
    "utf8",
  );
  const route = readFileSync(join(root, "app", "api", "products", "route.ts"), "utf8");

  assert.match(repository, /\["public-product-list-v3", cacheKey\]/);
  assert.match(repository, /\["public-product-page-v3", cacheKey\]/);
  assert.match(repository, /ids: options\.ids \? \[\.\.\.new Set\(options\.ids\)\]\.sort\(\)/);
  assert.match(repository, /offset: Math\.max\(0, options\.offset\)/);
  assert.match(repository, /limit: Math\.max\(1, options\.limit\)/);
  assert.match(repository, /category: options\.category/);
  assert.match(repository, /search: options\.search/);
  assert.match(route, /searchParams\.has\("ids"\)/);
  assert.match(route, /if \(hasIdsParameter\)/);
  assert.match(route, /const products = ids\.length[\s\S]*: \[\]/);
  assert.match(route, /const productApiHeaders = \{[\s\S]*"private, no-store"/);
  assert.doesNotMatch(route, /s-maxage/);
});

test("consulta seletiva do carrinho exige array e não reutiliza catálogo paginado", () => {
  const cartProducts = readFileSync(
    join(root, "components", "use-cart-products.ts"),
    "utf8",
  );
  assert.match(cartProducts, /\/api\/products\?ids=/);
  assert.match(cartProducts, /Array\.isArray\(result\)/);
  assert.match(cartProducts, /Formato inesperado ao carregar os itens do carrinho/);
  assert.match(cartProducts, /new Set\(items\.map\(\(item\) => item\.productId\)\)\]\.sort\(\)/);
});

test("produto de teste Sandbox fica oculto somente nas consultas públicas", () => {
  const repository = readFileSync(
    join(root, "repositories", "supabase-product-repository.ts"),
    "utf8",
  );
  assert.match(
    repository,
    /if \(publicRead\) query = query\.not\("name", "ilike", "%\[TESTE SANDBOX\]%"\)/,
  );
  assert.match(repository, /executeProductQuery\(options, false\)/);
});
