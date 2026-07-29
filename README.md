# Bispo Store

Loja virtual em Next.js com catálogo, carrinho, Checkout PagBank Sandbox, cotação Melhor Envio Sandbox e painel administrativo. A persistência usa Supabase Postgres; a autenticação usa Supabase Auth e as imagens usam Supabase Storage.

O projeto continua em ambiente de desenvolvimento. As integrações recusam configuração de produção e nenhuma publicação foi realizada.

## Stack

- Next.js 16 com App Router, TypeScript e React 19
- Tailwind CSS 4 e CSS responsivo próprio
- Supabase Postgres, Auth e Storage
- migrations SQL versionadas e políticas RLS
- ESLint e testes com Node Test Runner
- pgTAP para testes de autorização no banco
- configuração compatível com Netlify

## Pré-requisitos

- Node.js 22.13 ou superior
- npm
- um projeto Supabase de desenvolvimento
- Supabase CLI e Docker somente para executar a stack e os testes SQL localmente

## Instalação

```bash
npm install
copy .env.example .env.local
npm run dev
```

Abra `http://localhost:3000`.

Preencha `.env.local` sem versionar valores reais:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_WHATSAPP_NUMBER=5511972938269
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STORE_CNPJ=
MELHOR_ENVIO_CLIENT_ID=
MELHOR_ENVIO_CLIENT_SECRET=
MELHOR_ENVIO_REDIRECT_URI=http://localhost:3000/api/integrations/melhor-envio/callback
MELHOR_ENVIO_ENV=sandbox
INTEGRATION_ENCRYPTION_KEY=
ENABLE_MELHOR_ENVIO_LABEL_PURCHASE=false
PAGBANK_TOKEN=
PAGBANK_ENV=sandbox
PAGBANK_NOTIFICATION_URL=http://localhost:3000/api/webhooks/pagbank
PAGBANK_REDIRECT_URL=http://localhost:3000/pedido-recebido
```

`NEXT_PUBLIC_SUPABASE_URL` e a anon key podem chegar ao navegador; a segurança desses acessos depende das políticas RLS. `SUPABASE_SERVICE_ROLE_KEY` é exclusiva do servidor e dos scripts administrativos. Nunca use o prefixo `NEXT_PUBLIC_` nela.

## Banco e migrations

As migrations ficam em `supabase/migrations` e devem ser executadas na ordem dos nomes:

1. `20260727170000_schema.sql` — tabelas, índices, histórico e auditoria.
2. `20260727171000_rls_storage.sql` — RLS, políticas e bucket `product-images`.
3. `20260727172000_seed_settings.sql` — categorias e configurações comerciais.
4. `20260727173000_order_functions.sql` — criação transacional e segura de pedidos.
5. `20260727174000_harden_order_writes.sql` — bloqueio de escrita direta em itens, preços, fretes, pagamentos e status.
6. `20260727175000_sandbox_integrations.sql` — OAuth cifrado, cotações, Checkout PagBank, webhook idempotente, estoque e etiquetas.

Para uma stack Supabase local:

```bash
supabase start
supabase db reset
supabase test db
```

Para um projeto Supabase de desenvolvimento já criado:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

Use somente um projeto de desenvolvimento até a homologação. O projeto web não foi publicado por este trabalho.

## Migração dos produtos e imagens

O arquivo `data/products.local.json` continua preservado. O script é idempotente para retomada e roda em modo de prévia por padrão:

```bash
npm run supabase:migrate:products
```

Na base atual, a prévia encontra 110 produtos, 188 imagens e 188 miniaturas. Depois de aplicar as migrations e configurar a service role no terminal:

```bash
npm run supabase:migrate:products -- --confirm
```

O script:

- associa cada produto ao `legacy_id`;
- aplica padrões de peso e dimensões somente quando o campo está vazio;
- arquiva categorias fora de Tênis, Calças e Conjuntos;
- cria variantes de tamanho e cor com estoque distribuído;
- envia as fotos reais para o bucket `product-images`;
- grava a ordem e a imagem de capa;
- retoma registros incompletos sem sobrescrever os campos já migrados;
- não apaga nem altera `data/products.local.json`.

Para atualizar também registros existentes, use deliberadamente:

```bash
npm run supabase:migrate:products -- --confirm --overwrite-existing
```

`--skip-images` permite migrar apenas dados. Evite `--overwrite-existing` depois que a equipe começar a editar os produtos diretamente no painel.

## Administrador

Não existe login demonstrativo. Crie o usuário administrativo no Supabase Auth e defina a senha apenas no provedor. Depois promova esse usuário para `admin_users`:

```powershell
$env:ADMIN_EMAIL="admin@exemplo.com"
$env:ADMIN_DISPLAY_NAME="Diogo"
npm run supabase:promote-admin
npm run supabase:promote-admin -- --confirm
```

O script só promove um usuário Auth já existente; ele não cria, lê ou armazena senha. O painel em `/admin` exige simultaneamente uma sessão válida e um registro ativo em `admin_users`.

## Login de cliente

O checkout exige autenticação por magic link. No Supabase Auth, configure:

- Site URL: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/auth/callback`

Cada cliente consulta somente o próprio cadastro, endereço, pedido, itens, frete, pagamento, etiqueta e histórico. O pedido é criado pela função `create_customer_order`, que recalcula preços no banco e valida produto, variante e estoque; valores enviados pelo navegador não são confiados.

## Segurança

- RLS está habilitado em todas as tabelas da aplicação.
- Visitantes leem apenas categorias, produtos, imagens e variantes publicados.
- Clientes autenticados leem apenas os próprios dados.
- Administradores ativos leem clientes, endereços, todos os pedidos e auditoria.
- Somente administradores alteram catálogo, preço, estoque, frete, pagamento e status.
- Imagens são públicas para leitura no bucket, mas somente administradores podem enviar, alterar ou remover objetos.
- A service role fica em módulos `server-only` e nos scripts executados no servidor.
- A loja não solicita cartão; o processamento de teste acontece no Checkout hospedado do PagBank Sandbox.
- CNPJ real fica somente em `STORE_CNPJ`; o banco guarda no máximo os quatro últimos dígitos.

## Auditoria

Triggers do Postgres gravam `INSERT`, `UPDATE` e `DELETE` em `audit_logs`, incluindo campos alterados, estado anterior, estado posterior, usuário responsável e horário. A cobertura inclui:

- preço e publicação/arquivamento de produtos;
- estoque de variantes;
- pedidos e status;
- cotações e decisões de frete;
- pagamentos.

O histórico específico de status do pedido também é salvo em `order_status_history`.

## Melhor Envio Sandbox

Cadastre um aplicativo Sandbox com o callback de `MELHOR_ENVIO_REDIRECT_URI`. Em `/admin/configuracoes`, um administrador autoriza pelo OAuth; login e senha da conta nunca passam pela aplicação. Access e refresh tokens são cifrados com `INTEGRATION_ENCRYPTION_KEY` e renovados automaticamente.

As cotações usam o CEP 03870-100 e peso/dimensões do catálogo no servidor. A escolha expira em 30 minutos e é invalidada se CEP, carrinho, preço ou dimensões mudarem.

A compra de etiquetas começa desativada. Mantenha `ENABLE_MELHOR_ENVIO_LABEL_PURCHASE=false` até validar CNPJ, inscrição estadual, endereço de origem e chave de NF-e. Não é usada Declaração de Conteúdo para vendas comerciais.

## PagBank Sandbox

O checkout é criado somente depois do frete definido. Produtos, preços, estoque e frete são recalculados no servidor. O cliente é redirecionado ao Checkout PagBank, e a loja nunca coleta dados de cartão.

O webhook em `/api/webhooks/pagbank` é idempotente, consulta o checkout no PagBank e confere referência e total antes de atualizar o pedido. O estoque é reduzido uma única vez. A página de retorno não confirma pagamento.

## Entrega e pagamento

O checkout mantém duas opções:

- análise manual de entrega local grátis em até 5 km;
- cotação por CEP e seleção de serviço retornado pelo Melhor Envio Sandbox.

Nenhuma análise local é aprovada automaticamente. Para entrega local, o Checkout PagBank só pode ser criado depois da aprovação com frete zero. Para entrega convencional, a cotação selecionada compõe o total.

## Testes e validação

```bash
npm run typecheck
npm run lint
npm test
npm run audit:security
npm run build
```

Os testes SQL de RLS estão em `supabase/tests/rls_authorization.test.sql` e devem ser executados com:

```bash
supabase test db
```

O conjunto verifica isolamento entre dois clientes, bloqueio de alterações de preço/status, acesso administrativo global e RLS habilitado.

No ambiente usado para esta implementação, TypeScript, ESLint, 27 testes, auditoria de segurança e o build de produção foram concluídos com sucesso. A prévia de migração confirmou 110 produtos, 188 imagens e 188 miniaturas. As migrations e os testes pgTAP não foram executados contra um banco porque não havia Supabase CLI, Docker, `.env.local` ou credenciais de projeto disponíveis; nenhuma chave foi inventada.

## Estrutura principal

```text
app/                         rotas públicas, administrativas e APIs
components/                  interface reutilizável e responsiva
lib/auth/                    autorização administrativa
lib/supabase/                clientes browser, SSR e service role
repositories/                acesso Supabase para produtos, pedidos e configurações
scripts/                     migração de catálogo e promoção de administrador
supabase/migrations/         schema e políticas versionadas
supabase/tests/              testes pgTAP de autorização/RLS
data/products.local.json     origem preservada para migração e conferência
```

## Netlify

O projeto mantém `netlify.toml` com build Next.js/OpenNext no ambiente Linux do Netlify. As variáveis de ambiente são cadastradas no Netlify e nunca em arquivos versionados.

Enquanto a homologação estiver em revisão, `scripts/netlify-ignore-build.mjs` bloqueia o contexto `production` e permite somente Deploy Previews originados de pull requests. Remova essa trava apenas após autorização explícita para atualizar a URL principal.
