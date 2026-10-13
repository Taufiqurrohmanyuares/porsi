/**
 * Pure split-calculation logic, kept separate from React components so it
 * can be unit tested without rendering anything.
 *
 * @param {object} state
 * @param {{id:number, name:string, price:number}[]} state.items
 * @param {{id:number, name:string}[]} state.participants
 * @param {Record<number, Set<number>>} state.assignments - itemId -> set of participant ids
 * @param {"itemized"|"equal"} state.splitMode
 * @param {number} state.taxValue
 * @param {"percent"|"amount"} state.taxMode
 * @param {number} state.serviceValue
 * @param {"percent"|"amount"} state.serviceMode
 * @param {number} state.discountAmount - nilai diskon (persen atau rupiah, tergantung discountMode)
 * @param {"percent"|"amount"} [state.discountMode="amount"]
 */

/** A charge/discount is either "X% of subtotal" or a flat rupiah amount — never both at once. */
function resolveChargeAmount(mode, value, subtotal) {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  if (mode === "amount") return safeValue;
  return subtotal * (safeValue / 100);
}

export function calculateSplit(state) {
  const {
    items,
    participants,
    assignments,
    splitMode,
    taxValue,
    taxMode,
    serviceValue,
    serviceMode,
    discountAmount,
    discountMode = "amount",
  } = state;

  const subtotal = items.reduce((sum, i) => sum + i.price, 0);

  const rawByParticipant = new Map(participants.map((p) => [p.id, 0]));

  if (splitMode === "equal") {
    // Semua orang nanggung porsi subtotal yang sama besar, gak peduli
    // siapa pesan apa. Assignment per-item diabaikan total di mode ini.
    if (participants.length > 0) {
      const equalShare = subtotal / participants.length;
      participants.forEach((p) => rawByParticipant.set(p.id, equalShare));
    }
  } else {
    items.forEach((item) => {
      const assignees = [...(assignments[item.id] || [])];
      if (assignees.length === 0) return;
      const share = item.price / assignees.length;
      assignees.forEach((pid) => {
        rawByParticipant.set(pid, (rawByParticipant.get(pid) || 0) + share);
      });
    });
  }

  const taxAmount = resolveChargeAmount(taxMode, taxValue, subtotal);
  const serviceAmount = resolveChargeAmount(serviceMode, serviceValue, subtotal);
  const discountValue = resolveChargeAmount(discountMode, discountAmount, subtotal);
  const clampedDiscount = Math.min(discountValue, subtotal + taxAmount + serviceAmount);
  const extraTotal = taxAmount + serviceAmount - clampedDiscount;
  const grandTotal = subtotal + taxAmount + serviceAmount - clampedDiscount;

  // Catatan: di mode "equal", setiap peserta punya raw share yang identik,
  // jadi proportion di bawah ini juga otomatis identik untuk semua orang —
  // gak perlu logika terpisah buat "bagi rata"-nya pajak/service/diskon,
  // itu udah otomatis kebagi rata sebagai efek dari raw share yang rata.
  const results = participants.map((p) => {
    const raw = rawByParticipant.get(p.id) || 0;
    const proportion = subtotal > 0 ? raw / subtotal : 0;
    const final = raw + proportion * extraTotal;
    return { id: p.id, name: p.name, raw, final };
  });

  // Rounding reconciliation: individually rounded shares can drift a
  // rupiah or two away from the rounded grand total. Nudge the largest
  // share so the parts always sum to the same total shown on screen.
  const roundedResults = results.map((r) => ({ ...r, rounded: Math.round(r.final) }));
  const roundedGrandTotal = Math.round(grandTotal);
  const sumRounded = roundedResults.reduce((s, r) => s + r.rounded, 0);
  const diff = roundedGrandTotal - sumRounded;
  if (diff !== 0 && roundedResults.length > 0) {
    const biggest = roundedResults.reduce((a, b) => (b.final > a.final ? b : a));
    biggest.rounded += diff;
  }

  return { results: roundedResults, grandTotal: roundedGrandTotal };
}

export function formatRupiah(n) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}