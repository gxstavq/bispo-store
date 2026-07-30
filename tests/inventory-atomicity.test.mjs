import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "20260729203000_atomic_order_inventory_reservations.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  join(
    root,
    "supabase",
    "rollback",
    "20260729203000_atomic_order_inventory_reservations.rollback.sql",
  ),
  "utf8",
);
const orderRoute = readFileSync(join(root, "app", "api", "orders", "route.ts"), "utf8");

class Mutex {
  #tail = Promise.resolve();

  async acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => next);
    await previous;
    return release;
  }
}

class AtomicInventoryHarness {
  constructor(entries) {
    this.stock = new Map(entries);
    this.variantLocks = new Map();
    this.idempotencyLocks = new Map();
    this.orders = new Map();
    this.keys = new Map();
    this.reservations = new Map();
    this.addresses = new Set();
    this.payments = new Map();
    this.sequence = 0;
  }

  lock(map, key) {
    if (!map.has(key)) map.set(key, new Mutex());
    return map.get(key);
  }

  fingerprint(cart, payload = "same") {
    return JSON.stringify({
      payload,
      cart: cart
        .map(({ variantId, quantity }) => ({ variantId, quantity }))
        .sort((left, right) => left.variantId.localeCompare(right.variantId)),
    });
  }

  activeReserved(variantId, exceptOrderId) {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      if (
        reservation.variantId === variantId
        && reservation.orderId !== exceptOrderId
        && reservation.status === "active"
      ) {
        total += reservation.quantity;
      }
    }
    return total;
  }

  async create({ key, cart, payload = "same", failMidway = false }) {
    const releaseKey = await this.lock(this.idempotencyLocks, key).acquire();
    try {
      const fingerprint = this.fingerprint(cart, payload);
      const existingId = this.keys.get(key);
      if (existingId) {
        const existing = this.orders.get(existingId);
        if (existing.fingerprint !== fingerprint) {
          throw new Error("idempotency_key_reused_with_different_payload");
        }
        return existing;
      }

      const aggregated = new Map();
      for (const item of cart) {
        aggregated.set(item.variantId, (aggregated.get(item.variantId) ?? 0) + item.quantity);
      }
      const variantIds = [...aggregated.keys()].sort();
      const releases = [];
      try {
        for (const variantId of variantIds) {
          releases.push(await this.lock(this.variantLocks, variantId).acquire());
        }

        for (const variantId of variantIds) {
          const physical = this.stock.get(variantId);
          const requested = aggregated.get(variantId);
          if (
            physical === undefined
            || physical - this.activeReserved(variantId) < requested
          ) {
            throw new Error("insufficient_available_stock");
          }
        }

        const orderId = `order-${++this.sequence}`;
        const stagedReservations = variantIds.map((variantId) => ({
          id: `${orderId}:${variantId}`,
          orderId,
          variantId,
          quantity: aggregated.get(variantId),
          status: "active",
        }));
        if (failMidway) throw new Error("synthetic_mid_transaction_failure");

        const order = {
          id: orderId,
          key,
          fingerprint,
          cart,
          stockDeducted: false,
          paymentStatus: "awaiting_payment",
        };
        this.orders.set(orderId, order);
        this.keys.set(key, orderId);
        this.addresses.add(orderId);
        for (const reservation of stagedReservations) {
          this.reservations.set(reservation.id, reservation);
        }
        return order;
      } finally {
        for (const release of releases.reverse()) release();
      }
    } finally {
      releaseKey();
    }
  }

  release(orderId, paymentStatus) {
    const order = this.orders.get(orderId);
    order.paymentStatus = paymentStatus;
    for (const reservation of this.reservations.values()) {
      if (reservation.orderId === orderId && reservation.status === "active") {
        reservation.status = paymentStatus === "expired" ? "expired" : "released";
      }
    }
  }

  async pay(orderId) {
    const order = this.orders.get(orderId);
    const ids = [...new Set(order.cart.map((item) => item.variantId))].sort();
    const releases = [];
    try {
      for (const id of ids) releases.push(await this.lock(this.variantLocks, id).acquire());
      if (!order.stockDeducted) {
        for (const item of order.cart) {
          this.stock.set(item.variantId, this.stock.get(item.variantId) - item.quantity);
        }
        order.stockDeducted = true;
        for (const reservation of this.reservations.values()) {
          if (reservation.orderId === orderId && reservation.status === "active") {
            reservation.status = "consumed";
          }
        }
      }
      order.paymentStatus = "paid";
      this.payments.set(orderId, "paid");
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

function outcomes(results) {
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled"),
    rejected: results.filter((result) => result.status === "rejected"),
  };
}

test("migration corrige a ambiguidade e mantém locks determinísticos no Postgres", () => {
  assert.match(migration, /update public\.inventory_reservations as reservations/);
  assert.match(migration, /reservations\.expires_at <= now\(\)/);
  assert.match(migration, /reservations\.expires_at > now\(\)/);
  assert.doesNotMatch(migration, /and expires_at <= now\(\)/);
  assert.match(migration, /group by items\.variant_id\s+order by items\.variant_id/);
  assert.match(migration, /from public\.product_variants as variants[\s\S]*for update/);
  assert.match(migration, /variant_stock - already_reserved < item_record\.quantity/);
});

test("criação e reserva ficam na mesma chamada e ambas as RPCs públicas permanecem", () => {
  assert.match(
    migration,
    /private\.create_customer_order_unreserved_idempotent[\s\S]*public\.reserve_order_stock/,
  );
  assert.match(
    migration,
    /private\.create_customer_order_unreserved_legacy[\s\S]*public\.reserve_order_stock/,
  );
  assert.match(
    migration,
    /create function public\.create_customer_order\([\s\S]*requested_idempotency_key text/,
  );
  assert.match(
    migration,
    /create function public\.create_customer_order\([\s\S]*order_notes text default null/,
  );
  assert.match(migration, /to authenticated/);
  assert.doesNotMatch(migration, /integration_credentials|oauth_states|access_token|refresh_token/i);
});

test("estoque 1 com duas chaves tem exatamente um vencedor em 50 execuções", async () => {
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const db = new AtomicInventoryHarness([["v1", 1]]);
    const result = outcomes(await Promise.allSettled([
      db.create({ key: `a-${iteration}`, cart: [{ variantId: "v1", quantity: 1 }] }),
      db.create({ key: `b-${iteration}`, cart: [{ variantId: "v1", quantity: 1 }] }),
    ]));
    assert.equal(result.fulfilled.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason.message, /insufficient_available_stock/);
    assert.equal([...db.reservations.values()].filter((row) => row.status === "active").length, 1);
    assert.equal(db.stock.get("v1"), 1);
    assert.equal(db.orders.size, 1);
    assert.equal(db.addresses.size, 1);
  }
});

test("estoque 1 com 20 chamadas simultâneas cria somente uma reserva", async () => {
  const db = new AtomicInventoryHarness([["v1", 1]]);
  const result = outcomes(await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) =>
      db.create({ key: `key-${index}`, cart: [{ variantId: "v1", quantity: 1 }] })),
  ));
  assert.equal(result.fulfilled.length, 1);
  assert.equal(result.rejected.length, 19);
  assert.equal(db.orders.size, 1);
  assert.equal([...db.reservations.values()].filter((row) => row.status === "active").length, 1);
});

test("mesma chave retorna o mesmo pedido e payload divergente é rejeitado", async () => {
  const db = new AtomicInventoryHarness([["v1", 1]]);
  const calls = await Promise.all(
    Array.from({ length: 20 }, () =>
      db.create({ key: "same-key", cart: [{ variantId: "v1", quantity: 1 }] })),
  );
  assert.equal(new Set(calls.map((order) => order.id)).size, 1);
  assert.equal(db.orders.size, 1);
  await assert.rejects(
    db.create({
      key: "same-key",
      cart: [{ variantId: "v1", quantity: 1 }],
      payload: "different",
    }),
    /idempotency_key_reused_with_different_payload/,
  );
});

test("carrinho multivariante sem estoque reverte pedido, endereço e todas as reservas", async () => {
  const db = new AtomicInventoryHarness([["v1", 1], ["v2", 0]]);
  await assert.rejects(
    db.create({
      key: "multi",
      cart: [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 1 },
      ],
    }),
    /insufficient_available_stock/,
  );
  assert.equal(db.orders.size, 0);
  assert.equal(db.addresses.size, 0);
  assert.equal(db.payments.size, 0);
  assert.equal(db.reservations.size, 0);
});

test("variantes em ordem inversa não causam deadlock", async () => {
  const db = new AtomicInventoryHarness([["a", 1], ["b", 1]]);
  const race = Promise.allSettled([
    db.create({
      key: "forward",
      cart: [
        { variantId: "a", quantity: 1 },
        { variantId: "b", quantity: 1 },
      ],
    }),
    db.create({
      key: "reverse",
      cart: [
        { variantId: "b", quantity: 1 },
        { variantId: "a", quantity: 1 },
      ],
    }),
  ]);
  const result = await Promise.race([
    race,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("deadlock_timeout")), 1000)),
  ]);
  const summary = outcomes(result);
  assert.equal(summary.fulfilled.length, 1);
  assert.equal(summary.rejected.length, 1);
  assert.doesNotMatch(summary.rejected[0].reason.message, /deadlock/);
});

test("falha no meio da transação não deixa estado parcial", async () => {
  const db = new AtomicInventoryHarness([["v1", 2]]);
  await assert.rejects(
    db.create({
      key: "rollback",
      cart: [{ variantId: "v1", quantity: 1 }],
      failMidway: true,
    }),
    /synthetic_mid_transaction_failure/,
  );
  assert.equal(db.orders.size, 0);
  assert.equal(db.addresses.size, 0);
  assert.equal(db.reservations.size, 0);
  assert.equal(db.stock.get("v1"), 2);
});

test("cancelamento, recusa e expiração liberam reservas", async () => {
  for (const status of ["cancelled", "declined", "expired"]) {
    const db = new AtomicInventoryHarness([["v1", 1]]);
    const order = await db.create({
      key: status,
      cart: [{ variantId: "v1", quantity: 1 }],
    });
    db.release(order.id, status);
    const reservation = [...db.reservations.values()][0];
    assert.equal(reservation.status, status === "expired" ? "expired" : "released");
  }
});

test("pagamento consome a reserva e baixa o estoque apenas uma vez", async () => {
  const db = new AtomicInventoryHarness([["v1", 1]]);
  const order = await db.create({
    key: "paid",
    cart: [{ variantId: "v1", quantity: 1 }],
  });
  await Promise.all([db.pay(order.id), db.pay(order.id)]);
  assert.equal(db.stock.get("v1"), 0);
  assert.equal([...db.reservations.values()][0].status, "consumed");
  assert.equal(db.orders.get(order.id).stockDeducted, true);
});

test("erro de estoque é controlado na API e rollback não apaga dados", () => {
  assert.match(orderRoute, /insufficient_available_stock/);
  assert.match(orderRoute, /status: 409/);
  assert.doesNotMatch(
    rollback,
    /drop table|drop column|truncate\s|delete from public\.(orders|products|product_variants|customers)/i,
  );
  assert.match(rollback, /create_customer_order_unreserved_idempotent/);
  assert.match(rollback, /create_customer_order_unreserved_legacy/);
  assert.doesNotMatch(rollback, /drop function public\.reserve_order_stock/);
});
