import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";


// Foto struk + AI bisa makan waktu; jangan sampai fungsi serverless terputus
// di tengah jalan (di Vercel default-nya pendek).
export const runtime = "nodejs";
export const maxDuration = 60;

// Pastikan GEMINI_API_KEY ada di .env.local (dan di Environment Variables
// Vercel kalau sudah deploy). Setelah mengubah .env.local, RESTART `npm run dev`.
const apiKey = process.env.GEMINI_API_KEY;

// Urutan model: yang pertama dicoba dulu. Kalau model itu 404 / sibuk / kuotanya
// habis, otomatis lanjut ke berikutnya. Bisa dioverride lewat GEMINI_MODEL
// di .env.local tanpa mengubah kode.
const MODELS = [
  ...new Set([
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-2.5-flash",
  ]),
];

// Batas ukuran gambar (setelah decode dari base64).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_ITEMS = 100;

const SYSTEM_PROMPT = `
Anda adalah mesin ekstraksi data struk kasir untuk aplikasi patungan (split bill).
Tugas: ekstrak HANYA nama pesanan (makanan/minuman/barang) dan total harga tiap pesanan dari gambar struk.
Abaikan pajak, service charge, diskon, subtotal, grand total, nomor meja, metode pembayaran, dan alamat toko.

Aturan:
1. Keluaran HANYA array JSON, tanpa markdown dan tanpa penjelasan.
2. Skema: [{"name": "Nama Item", "price": 15000}]
3. price = bilangan bulat rupiah, tanpa "Rp", tanpa titik/koma ribuan, tanpa desimal.
4. Jika kuantitas lebih dari satu (mis. 2x Nasi Goreng @15000), gabungkan jadi satu baris
   dengan total harga: {"name": "2 Nasi Goreng", "price": 30000}.
5. Jika tulisan kurang jelas, tetap berikan tebakan terbaik; jangan mengarang item yang tidak ada.
6. Jika benar-benar tidak ada item pesanan yang terbaca, kembalikan [].
`.trim();

const ITEMS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      price: { type: Type.INTEGER },
    },
    required: ["name", "price"],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Data URL: "data:image/png;base64,iVBORw0..." -> { mimeType, base64Data } */
function parseDataUrl(imageBase64) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(imageBase64);
  if (match) return { mimeType: match[1], base64Data: match[2] };
  // Sudah base64 murni tanpa prefix data URL — asumsikan JPEG.
  return { mimeType: "image/jpeg", base64Data: imageBase64 };
}

/** Ubah 15000 / "15.000" / "Rp 15.000,00" / "15000.00" jadi integer rupiah. */
function toRupiah(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  let s = String(v ?? "").replace(/[^\d.,]/g, "");
  s = s.replace(/[.,]\d{1,2}$/, ""); // buang desimal (.00 / ,50)
  return Number(s.replace(/[.,]/g, "")) || 0;
}

/**
 * Kelompokkan error dari SDK supaya tahu harus berbuat apa:
 *  - "auth"  : API key salah / tidak punya izin -> berhenti, ganti model tidak membantu
 *  - "model" : model tidak ditemukan / sudah dipensiunkan -> langsung coba model lain
 *  - "bad"   : request ditolak (mis. schema/gambar) -> coba lagi tanpa structured output
 *  - "quota" : batas pemakaian (429) -> jangan diulang di model yang sama (malah
 *              menghabiskan jatah); langsung coba model berikutnya yang kuotanya terpisah
 *  - "retry" : server sibuk (5xx) / jaringan -> tunggu sebentar lalu ulangi sekali
 */
function classify(err) {
  const status = Number(err?.status ?? err?.code) || 0;
  const msg = String(err?.message ?? "");
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return "auth";
  }
  if (status === 404 || /is not found|no longer available|has been retired|NOT_FOUND/i.test(msg)) {
    return "model";
  }
  if (status === 400) return "bad";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "quota";
  return "retry"; // 5xx atau error jaringan (tanpa status)
}

async function askGemini(ai, model, mimeType, data, useSchema) {
  const config = { systemInstruction: SYSTEM_PROMPT, temperature: 0 };
  if (useSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = ITEMS_SCHEMA;
  }
  const response = await ai.models.generateContent({
    model,
    contents: [
      { inlineData: { mimeType, data } },
      { text: "Ekstrak daftar pesanan dari struk ini." },
    ],
    config,
  });
  // Di @google/genai, response.text adalah property, bukan method.
  return response.text ?? "";
}

/** Satu model: structured output dulu; kalau ditolak (400) ulangi tanpa schema. */
async function tryModel(ai, model, mimeType, data) {
  let lastErr;
  for (const useSchema of [true, false]) {
    let attempt = 0;
    while (true) {
      try {
        return await askGemini(ai, model, mimeType, data, useSchema);
      } catch (err) {
        lastErr = err;
        const kind = classify(err);
        console.error(
          `[scan] ${model} (schema=${useSchema}) gagal [${kind}] status=${err?.status ?? "-"}:`,
          err?.message ?? err
        );
        if (kind === "bad") break; // lanjut: coba tanpa schema
        if (kind === "retry" && ++attempt < 2) {
          await sleep(900 * attempt);
          continue;
        }
        throw err; // auth / model / sudah dua kali dicoba
      }
    }
  }
  throw lastErr;
}

function fail(err, extra = {}) {
  const kind = classify(err);
  const dev = process.env.NODE_ENV !== "production";
  const detail = dev ? { detail: String(err?.message ?? err).slice(0, 500) } : {};

  if (kind === "auth") {
    return NextResponse.json(
      { error: "Kunci API AI belum benar. Hubungi admin aplikasi.", code: "AI_AUTH", ...detail, ...extra },
      { status: 500 }
    );
  }
  if (kind === "bad") {
    return NextResponse.json(
      { error: "Foto tidak bisa diproses AI. Coba foto ulang (JPG/PNG).", code: "AI_BAD_REQUEST", ...detail, ...extra },
      { status: 422 }
    );
  }
  if (kind === "quota") {
    return NextResponse.json(
      { error: "Batas pemakaian AI sedang penuh. Tunggu sekitar satu menit lalu coba lagi.", code: "AI_QUOTA", ...detail, ...extra },
      { status: 429 }
    );
  }
  return NextResponse.json(
    { error: "AI sedang sibuk. Coba lagi beberapa saat lagi.", code: "AI_BUSY", ...detail, ...extra },
    { status: 503 }
  );
}

export async function POST(req) {
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }
    const { imageBase64 } = body ?? {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "Tidak ada gambar." }, { status: 400 });
    }

    const { mimeType, base64Data } = parseDataUrl(imageBase64);

    const approxFileBytes = (base64Data.length * 3) / 4;
    if (approxFileBytes > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Ukuran foto kegedean. Coba foto ulang atau kompres dulu (maks ~8MB)." },
        { status: 413 }
      );
    }

    if (!apiKey) {
      console.error("GEMINI_API_KEY belum dikonfigurasi (.env.local / Environment Variables). Restart server setelah menambahkannya.");
      return NextResponse.json(
        { error: "Konfigurasi server AI belum selesai.", code: "AI_NO_KEY" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Coba tiap model berurutan sampai ada yang berhasil.
    let text = "";
    let lastErr = null;
    for (const model of MODELS) {
      try {
        text = await tryModel(ai, model, mimeType, base64Data);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (classify(err) === "auth") break; // ganti model tidak akan membantu
      }
    }
    if (lastErr) return fail(lastErr);

    // Jaga-jaga kalau model tetap membungkus dengan ```json
    const cleanJson = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      console.error("[scan] AI returned non-JSON output:", text);
      return NextResponse.json(
        { error: "AI belum bisa membaca struk ini. Coba foto yang lebih dekat dan terang.", code: "AI_BAD_OUTPUT" },
        { status: 422 }
      );
    }

    // Toleran: array langsung, atau dibungkus {items:[...]} / {data:[...]}
    const list = Array.isArray(parsed) ? parsed : parsed?.items ?? parsed?.data;
    if (!Array.isArray(list)) {
      console.error("[scan] AI output wasn't an array:", parsed);
      return NextResponse.json(
        { error: "Format hasil AI tidak sesuai. Coba lagi.", code: "AI_BAD_OUTPUT" },
        { status: 422 }
      );
    }

    const items = list
      .map((item) => ({
        name: typeof item?.name === "string" ? item.name.trim() : "",
        price: toRupiah(item?.price),
      }))
      .filter((item) => item.name && item.price > 0)
      .slice(0, MAX_ITEMS);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "AI tidak menemukan item pesanan di struk ini. Coba foto lebih jelas atau isi manual.", code: "AI_NO_ITEMS" },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("[scan] Unexpected error:", error);
    return NextResponse.json({ error: "Gagal memproses struk." }, { status: 500 });
  }
}