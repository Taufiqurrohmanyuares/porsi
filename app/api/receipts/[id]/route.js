import { NextResponse } from "next/server";
import { getReceiptState, saveReceiptState } from "../../../lib/receiptRepository";

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const state = await getReceiptState(id);
    if (!state) {
      return NextResponse.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json(state);
  } catch (error) {
    console.error(`[GET /api/receipts/${id}]`, error);
    return NextResponse.json(
      { error: "Gagal memuat sesi. Cek konfigurasi Supabase kamu." },
      { status: 500 }
    );
  }
}

function validatePayload(body) {
  if (!body || typeof body !== "object") return "Payload kosong atau bukan objek.";
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
  } = body;

  if (splitMode !== "itemized" && splitMode !== "equal") {
    return 'splitMode harus "itemized" atau "equal".';
  }

  if (!Array.isArray(items)) return "items harus berupa array.";
  if (!Array.isArray(participants)) return "participants harus berupa array.";
  if (!Array.isArray(assignments)) return "assignments harus berupa array.";

  for (const item of items) {
    if (typeof item.id !== "string" || !item.id) return "Setiap item butuh id (string).";
    if (typeof item.name !== "string" || !item.name.trim()) return "Setiap item butuh name.";
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0) {
      return `Harga item "${item.name}" harus angka lebih dari 0.`;
    }
  }
  for (const p of participants) {
    if (typeof p.id !== "string" || !p.id) return "Setiap peserta butuh id (string).";
    if (typeof p.name !== "string" || !p.name.trim()) return "Setiap peserta butuh name.";
  }
  const itemIds = new Set(items.map((i) => i.id));
  const participantIds = new Set(participants.map((p) => p.id));
  for (const a of assignments) {
    if (!itemIds.has(a.itemId)) return `assignment mengacu ke item yang tidak ada: ${a.itemId}.`;
    if (!participantIds.has(a.participantId)) {
      return `assignment mengacu ke peserta yang tidak ada: ${a.participantId}.`;
    }
  }

  for (const [modeLabel, mode, valueLabel, value] of [
    ["taxMode", taxMode, "taxValue", taxValue],
    ["serviceMode", serviceMode, "serviceValue", serviceValue],
    ["discountMode", discountMode, "discountAmount", discountAmount],
  ]) {
    if (mode !== "percent" && mode !== "amount") {
      return `${modeLabel} harus "percent" atau "amount".`;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `${valueLabel} harus angka >= 0.`;
    }
    if (mode === "percent" && value > 100) {
      return `${valueLabel} gak boleh lebih dari 100 kalau modenya persen.`;
    }
  }

  return null;
}

export async function PUT(request, { params }) {
  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body request bukan JSON valid." }, { status: 400 });
  }

  const validationError = validatePayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    await saveReceiptState(id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[PUT /api/receipts/${id}]`, error);
    return NextResponse.json(
      { error: "Gagal menyimpan sesi. Cek konfigurasi Supabase kamu." },
      { status: 500 }
    );
  }
}