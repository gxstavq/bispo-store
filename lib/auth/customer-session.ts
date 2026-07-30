import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { clientIpAddress } from "@/lib/security/client-ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getOrCreateCheckoutUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (user && !userError) return { supabase, user, created: false };

  await enforceRateLimit({
    scope: "guest-checkout-session",
    identifier: await clientIpAddress(),
    limit: 5,
    windowSeconds: 60 * 60,
  });

  const service = createSupabaseServiceClient();
  const guestId = randomUUID();
  const guestEmail = `checkout-${guestId}@guest.invalid`;
  const guestPassword = randomBytes(32).toString("base64url");
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: guestEmail,
    password: guestPassword,
    email_confirm: true,
    user_metadata: {
      guest_checkout: true,
    },
    app_metadata: {
      guest_checkout: true,
    },
  });
  if (createError || !created.user) {
    throw new Error("Não foi possível iniciar uma sessão segura de checkout.");
  }

  const { data: signed, error: signInError } = await supabase.auth.signInWithPassword({
    email: guestEmail,
    password: guestPassword,
  });
  if (signInError || !signed.user) {
    await service.auth.admin.deleteUser(created.user.id);
    throw new Error("Não foi possível iniciar uma sessão segura de checkout.");
  }
  return { supabase, user: signed.user, created: true };
}

async function checkedUpdate(
  table: string,
  values: Record<string, unknown>,
  column: string,
  userId: string,
) {
  const service = createSupabaseServiceClient();
  const { error } = await service.from(table).update(values).eq(column, userId);
  if (error) throw new Error(`Não foi possível vincular ${table} à conta verificada.`);
}

export async function claimGuestCheckoutOrders(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.email_confirmed_at || user.is_anonymous) return;

  const service = createSupabaseServiceClient();
  const { data: customers, error } = await service
    .from("customers")
    .select("id, user_id")
    .eq("email", email)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Não foi possível localizar os pedidos deste e-mail.");
  if (!customers?.length) return;

  let target = customers.find((customer) => customer.user_id === user.id) ?? null;
  for (const source of customers) {
    if (source.user_id === user.id) continue;
    const { data: sourceAuth, error: sourceAuthError } =
      await service.auth.admin.getUserById(source.user_id);
    if (
      sourceAuthError
      || sourceAuth.user?.app_metadata?.guest_checkout !== true
    ) {
      continue;
    }

    await checkedUpdate(
      "shipping_quotes",
      { customer_user_id: user.id },
      "customer_user_id",
      source.user_id,
    );
    await checkedUpdate(
      "shipping_quotes",
      { created_by: user.id },
      "created_by",
      source.user_id,
    );
    await checkedUpdate(
      "shipping_decisions",
      { decided_by: user.id },
      "decided_by",
      source.user_id,
    );
    await checkedUpdate(
      "shipment_labels",
      { created_by: user.id },
      "created_by",
      source.user_id,
    );
    await checkedUpdate(
      "order_status_history",
      { changed_by: user.id },
      "changed_by",
      source.user_id,
    );
    await checkedUpdate(
      "audit_logs",
      { actor_user_id: user.id },
      "actor_user_id",
      source.user_id,
    );

    if (!target) {
      const { data: reassigned, error: reassignError } = await service
        .from("customers")
        .update({ user_id: user.id })
        .eq("id", source.id)
        .select("id, user_id")
        .single();
      if (reassignError || !reassigned) {
        throw new Error("Não foi possível vincular o pedido à conta verificada.");
      }
      target = reassigned;
    } else {
      const [{ error: addressError }, { error: orderError }] = await Promise.all([
        service.from("addresses").update({ customer_id: target.id }).eq("customer_id", source.id),
        service.from("orders").update({ customer_id: target.id }).eq("customer_id", source.id),
      ]);
      if (addressError || orderError) {
        throw new Error("Não foi possível reunir os pedidos desta conta.");
      }
      const { error: deleteCustomerError } = await service
        .from("customers")
        .delete()
        .eq("id", source.id);
      if (deleteCustomerError) {
        throw new Error("Não foi possível concluir a vinculação do pedido.");
      }
    }

    const { error: deleteUserError } = await service.auth.admin.deleteUser(source.user_id);
    if (deleteUserError) {
      throw new Error("O pedido foi vinculado, mas a sessão temporária não pôde ser encerrada.");
    }
  }
}
