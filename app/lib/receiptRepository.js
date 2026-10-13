import { supabase, isSupabaseConfigured } from "./supabaseClient";

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local (lihat .env.local.example)."
    );
  }
}

/** Creates a new, empty split session and returns its id. */
export async function createReceipt() {
  assertConfigured();
  const { data, error } = await supabase.from("receipts").insert({}).select("id").single();
  if (error) throw error;
  return data.id;
}

/**
 * Loads everything needed to render a session: the charges (tax/service/
 * discount), its items, its participants, and the item<->participant
 * assignments — reshaped into the same shape PatunginApp's state uses.
 * Returns null if the receipt doesn't exist.
 */
export async function getReceiptState(receiptId) {
  assertConfigured();

  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .maybeSingle();
  if (receiptError) throw receiptError;
  if (!receipt) return null;

  const [{ data: items, error: itemsError }, { data: participants, error: participantsError }] =
    await Promise.all([
      supabase
        .from("receipt_items")
        .select("id, name, price, position")
        .eq("receipt_id", receiptId)
        .order("position", { ascending: true }),
      supabase
        .from("participants")
        .select("id, name, position")
        .eq("receipt_id", receiptId)
        .order("position", { ascending: true }),
    ]);
  if (itemsError) throw itemsError;
  if (participantsError) throw participantsError;

  const itemIds = items.map((i) => i.id);
  let assignments = [];
  if (itemIds.length > 0) {
    const { data: assignmentRows, error: assignmentsError } = await supabase
      .from("item_assignments")
      .select("item_id, participant_id")
      .in("item_id", itemIds);
    if (assignmentsError) throw assignmentsError;
    assignments = assignmentRows.map((row) => ({
      itemId: row.item_id,
      participantId: row.participant_id,
    }));
  }

  return {
    items: items.map(({ id, name, price }) => ({ id, name, price: Number(price) })),
    participants: participants.map(({ id, name }) => ({ id, name })),
    assignments,
    splitMode: receipt.split_mode,
    taxMode: receipt.tax_mode,
    taxValue: Number(receipt.tax_value),
    serviceMode: receipt.service_mode,
    serviceValue: Number(receipt.service_value),
    discountMode: receipt.discount_mode ?? "amount",
    discountAmount: Number(receipt.discount_amount),
  };
}

/**
 * Menggunakan PostgreSQL RPC untuk menyimpan seluruh state dalam
 * satu transaksi Atomic tunggal. Mencegah data corrupt jika ada
 * lebih dari 1 orang yang menyimpan di waktu yang sama.
 */
export async function saveReceiptState(receiptId, state) {
  assertConfigured();
  const {
    items,
    participants,
    assignments,
    splitMode,
    taxMode,
    taxValue,
    serviceMode,
    serviceValue,
    discountMode,
    discountAmount,
  } = state;

  // Sisipkan index posisi sebelum dikirim ke database
  const participantsWithPosition = participants.map((p, index) => ({
    ...p,
    position: index,
  }));
  
  const itemsWithPosition = items.map((item, index) => ({
    ...item,
    position: index,
  }));

  // Panggil fungsi RPC yang sudah kita buat di Supabase SQL Editor
  const { error } = await supabase.rpc("save_receipt_state", {
    p_receipt_id: receiptId,
    p_split_mode: splitMode,
    p_tax_mode: taxMode,
    p_tax_value: taxValue,
    p_service_mode: serviceMode,
    p_service_value: serviceValue,
    p_discount_amount: discountAmount,
    p_participants: participantsWithPosition,
    p_items: itemsWithPosition,
    p_assignments: assignments,
  });

  if (error) {
    console.error("Gagal menyimpan state patungan:", error);
    throw error;
  }

  // discount_mode disimpan terpisah supaya fungsi RPC save_receipt_state
  // yang sudah ada di Supabase tidak perlu diubah.
  const { error: discountModeError } = await supabase
    .from("receipts")
    .update({ discount_mode: discountMode })
    .eq("id", receiptId);

  if (discountModeError) {
    console.error("Gagal menyimpan mode diskon:", discountModeError);
    throw discountModeError;
  }
}