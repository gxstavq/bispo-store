import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const STOCK_RESERVATION_MINUTES = 120;

export function stockReservationExpiration(now = Date.now()) {
  return new Date(now + STOCK_RESERVATION_MINUTES * 60 * 1000).toISOString();
}

export async function reserveOrderStock(orderId: string, expiresAt: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("reserve_order_stock", {
    target_order_id: orderId,
    reservation_expires_at: expiresAt,
  });
  if (error) throw new Error(`Não foi possível reservar o estoque: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    expiresAt: String(row?.expires_at ?? expiresAt),
    reservedItems: Number(row?.reserved_items ?? 0),
  };
}

export async function releaseOrderStockReservation(orderId: string, reason: string) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc("release_order_stock_reservation", {
    target_order_id: orderId,
    requested_reason: reason,
  });
  if (error) throw new Error(`Não foi possível liberar a reserva de estoque: ${error.message}`);
}
