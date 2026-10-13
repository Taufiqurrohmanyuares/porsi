// Kecilkan foto struk di browser sebelum dikirim ke /api/receipts/scan.
// Foto HP bisa 3–10 MB; hasil kompres ±300 KB–1 MB, jauh lebih cepat dibaca AI
// dan aman dari batas ukuran request di hosting (Vercel ±4,5 MB).
//
// Pakai:  const dataUrl = await compressToDataUrl(file);
//         fetch("/api/receipts/scan", { method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ imageBase64: dataUrl }) });

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function compressToDataUrl(file, maxSide = 2000, quality = 0.85) {
  try {
    // createImageBitmap otomatis memutar foto sesuai orientasi EXIF di browser modern.
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // PNG transparan -> latar putih, bukan hitam
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // Browser tidak bisa decode formatnya (mis. HEIC di Chrome): kirim apa adanya.
    return readAsDataUrl(file);
  }
}