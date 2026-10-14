import { NextResponse } from "next/server";
import { createReceipt } from "../../lib/receiptRepository";

// Membuat sesi patungan baru dan mengembalikan id-nya.
// (Pemindaian struk AI ada di /api/receipts/scan, bukan di sini.)
export async function POST() {
  try {
    const id = await createReceipt();
    return NextResponse.json({ id });
  } catch (error) {
    console.error("[POST /api/receipts]", error);
    return NextResponse.json(
      { error: "Gagal membuat sesi baru. Cek konfigurasi Supabase kamu." },
      { status: 500 }
    );
  }
}