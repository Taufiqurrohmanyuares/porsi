"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { calculateSplit } from "../lib/calculateSplit";
import "../porsi.css";
import { calculateSplit } from "../lib/calculateSplit";
import { compressToDataUrl } from "../lib/compressImage";

// ==========================================
// Helper kecil
// ==========================================

// Semua class di porsi.css diawali "pf-". cx("btn", "btn-primary") -> "pf-btn pf-btn-primary"
const cx = (...names) =>
  names
    .filter(Boolean)
    .flatMap((n) => String(n).split(" "))
    .map((n) => `pf-${n}`)
    .join(" ");

// Format ribuan manual (bukan toLocaleString) supaya server dan browser selalu sama.
const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const rp = (n) => `Rp ${num(n)}`;

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

function luminance(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Pilih teks putih atau gelap, mana yang kontrasnya lebih baik di atas warna ini.
function textOn(hex) {
  const L = luminance(hex);
  const white = 1.05 / (L + 0.05);
  const dark = (L + 0.05) / (luminance("#16142E") + 0.05);
  return white >= dark ? "#FFFFFF" : "#16142E";
}

const personColor = (index) => PALETTE[index % PALETTE.length];

function titleCase(s) {
  const t = String(s).trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

function nameCase(s) {
  return String(s)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

// Nilai pajak/service/diskon (persen atau rupiah) jadi nominal rupiah.
function resolveAmount(mode, value, subtotal) {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return mode === "amount" ? safe : subtotal * (safe / 100);
}

const pctText = (v) => String(v).replace(".", ",");

function focusId(id) {
  setTimeout(() => {
    try {
      document.getElementById(id)?.focus();
    } catch {
      // abaikan
    }
  }, 30);
}

function initials(name) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function initialAssignmentsMap(initialState) {
  const map = {};
  (initialState?.items ?? []).forEach((item) => {
    map[item.id] = new Set();
  });
  (initialState?.assignments ?? []).forEach(({ itemId, participantId }) => {
    if (!map[itemId]) map[itemId] = new Set();
    map[itemId].add(participantId);
  });
  return map;
}

const STEPS = [
  { n: 1, key: "items", label: "Struk" },
  { n: 2, key: "assign", label: "Peserta" },
  { n: 3, key: "summary", label: "Hasil" },
];

const MAX_IMAGE_MB = 25;
const SCAN_LABELS = ["Mendeteksi baris item", "Membaca nama dan harga", "Merapikan daftar item"];

// ==========================================
// Ikon
// ==========================================

function makeIcon(paths, defaultWidth = 2) {
  function Icon({ strokeWidth = defaultWidth, className = "", style }) {
    return (
      <svg
        className={cx("ic", className)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={style}
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

const IcCheck = makeIcon(<path d="m5 12.5 4.5 4.5L19 7.5" />);
const IcLink = makeIcon(
  <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
);
const IcCamera = makeIcon(
  <>
    <path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .8.2L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </>
);
const IcAlert = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </>
);
const IcInfo = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5v.01" />
  </>
);
const IcClose = makeIcon(<path d="M6 6l12 12M18 6 6 18" />, 2.2);
const IcPencil = makeIcon(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />);
const IcTrash = makeIcon(
  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
);
const IcChev = makeIcon(<path d="m6 9 6 6 6-6" />, 2.2);
const IcReceipt = makeIcon(
  <>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6" />
  </>,
  1.8
);
const IcUsers = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.1.7 3.5 2.6 3.5 5.6" />
  </>
);
const IcImage = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
  </>
);
const IcSend = makeIcon(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />);
const IcCopy = makeIcon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </>
);
const IcBack = makeIcon(<path d="m15 6-6 6 6 6" />, 2.2);
const IcArrow = makeIcon(<path d="M5 12h14M13 6l6 6-6 6" />, 2.2);
const IcReset = makeIcon(
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
  2.2
);

function Logo() {
  return (
    <>
      <svg className={cx("logo-ic")} viewBox="0 0 28 32" fill="none" aria-hidden="true">
        <path
          d="M5 2.5h18A2.5 2.5 0 0 1 25.5 5v23.4l-3.1-2.1-3.1 2.1-3.1-2.1-3.1 2.1-3.1-2.1-3.1 2.1V5A2.5 2.5 0 0 1 5 2.5Z"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        <rect className={cx("lgs")} x="8.4" y="8" width="11.2" height="2.6" rx="1.3" />
        <rect className={cx("lgs")} x="8.4" y="13.6" width="4.2" height="2.6" rx="1.3" />
        <rect className={cx("lgf")} x="14.4" y="13.2" width="5.2" height="3.4" rx="1.7" />
        <rect className={cx("lgs")} x="8.4" y="19.2" width="4.2" height="2.6" rx="1.3" />
        <rect className={cx("lgf")} x="14.4" y="18.8" width="5.2" height="3.4" rx="1.7" />
      </svg>
      <span className={cx("wm")} aria-hidden="true">
        <span>P</span>
        <svg className={cx("wm-o")} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle className={cx("lgf")} cx="10" cy="10" r="3.2" />
        </svg>
        <span>R</span>
        <span>S</span>
        <span>I</span>
      </span>
    </>
  );
}

// ==========================================
// Kolom isian pajak / service / diskon
// ==========================================

function formatFee(mode, value) {
  if (!(value > 0)) return "";
  return mode === "amount" ? num(value) : pctText(value);
}

function parseFee(mode, text) {
  if (mode === "amount") return parseInt(text.replace(/\D/g, "") || "0", 10);
  const v = parseFloat(text.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function FeeInput({ id, mode, value, label, onChange }) {
  const [text, setText] = useState(() => formatFee(mode, value));

  // Ikut berubah kalau nilainya diubah dari luar (preset, ganti satuan).
  useEffect(() => {
    setText((prev) => (parseFee(mode, prev) === value ? prev : formatFee(mode, value)));
  }, [mode, value]);

  function handleChange(e) {
    const raw = e.target.value;
    let next;
    if (mode === "amount") {
      const digits = raw.replace(/\D/g, "").slice(0, 9);
      next = digits ? num(parseInt(digits, 10)) : "";
    } else {
      next = raw.replace(/[^0-9.,]/g, "").slice(0, 5);
      // Persen tidak boleh lebih dari 100 (server juga menolaknya).
      if (parseFee("percent", next) > 100) next = "100";
    }
    setText(next);
    onChange(parseFee(mode, next));
  }

  return (
    <div className={cx("field")}>
      {mode === "amount" && <span className={cx("aff")}>Rp</span>}
      <input
        id={id}
        type="text"
        inputMode={mode === "amount" ? "numeric" : "decimal"}
        autoComplete="off"
        placeholder="0"
        aria-label={label}
        value={text}
        onChange={handleChange}
      />
      {mode === "percent" && <span className={cx("aff")}>%</span>}
    </div>
  );
}

function FeeRow({ def, onMode, onValue }) {
  const isPct = def.mode === "percent";
  return (
    <div className={cx("fee")}>
      <div className={cx("fee-h")}>
        <span className={cx("fee-l")}>
          <b>{def.label}</b>
          <small>{def.hint}</small>
        </span>
        <span className={cx("seg")} role="group" aria-label={`Satuan ${def.label}`}>
          <button type="button" className={cx(isPct && "on")} aria-pressed={isPct} onClick={() => onMode("percent")}>
            %
          </button>
          <button type="button" className={cx(!isPct && "on")} aria-pressed={!isPct} onClick={() => onMode("amount")}>
            Rp
          </button>
        </span>
      </div>
      <div className={cx("fee-row")}>
        <FeeInput
          id={`fee-${def.key}`}
          mode={def.mode}
          value={def.value}
          label={`${def.label} ${isPct ? "dalam persen" : "dalam rupiah"}`}
          onChange={onValue}
        />
        <span className={cx("fee-amt")}>{def.amount > 0 ? `${def.isDiscount ? "-" : ""}${rp(def.amount)}` : "Rp 0"}</span>
      </div>
      {def.presets.length > 0 && (
        <div className={cx("presets")}>
          {def.presets.map((p) => {
            const on = isPct && def.value === p.value;
            return (
              <button
                key={p.label}
                type="button"
                className={cx("pre", on && "on")}
                aria-pressed={on}
                onClick={() => {
                  onMode("percent");
                  onValue(p.value);
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// Komponen utama
// ==========================================

export default function PatunginApp({ receiptId, initialState }) {
  const [screen, setScreen] = useState("items");

  const [items, setItems] = useState(initialState?.items ?? []);
  const [participants, setParticipants] = useState(initialState?.participants ?? []);
  const [assignments, setAssignments] = useState(() => initialAssignmentsMap(initialState));
  const [splitMode, setSplitMode] = useState(initialState?.splitMode ?? "itemized");

  const [taxMode, setTaxMode] = useState(initialState?.taxMode ?? "percent");
  const [taxValue, setTaxValue] = useState(initialState?.taxValue ?? initialState?.taxPercent ?? 0);
  const [serviceMode, setServiceMode] = useState(initialState?.serviceMode ?? "percent");
  const [serviceValue, setServiceValue] = useState(
    initialState?.serviceValue ?? initialState?.servicePercent ?? 0
  );
  const [discountMode, setDiscountMode] = useState(initialState?.discountMode ?? "amount");
  const [discountAmount, setDiscountAmount] = useState(initialState?.discountAmount ?? 0);

  // Form item
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState(""); // hanya digit
  const [itemError, setItemError] = useState("");
  const [editId, setEditId] = useState(null);

  // Form peserta
  const [personName, setPersonName] = useState("");
  const [personError, setPersonError] = useState("");

  // Tampilan
  const [feesOpen, setFeesOpen] = useState(false);
  const [openRows, setOpenRows] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [scanBanner, setScanBanner] = useState(false);
  const [scannedIds, setScannedIds] = useState(() => new Set());
  const [toast, setToast] = useState(null);

  // Scan struk
  const [scan, setScan] = useState(null); // null | "choose" | "busy"
  const [scanStep, setScanStep] = useState(0);
  const [scanError, setScanError] = useState("");
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const timers = useRef({});
  const undoRef = useRef(null);
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((id) => clearTimeout(id));
  }, []);

  const showToast = useCallback((msg, actionLabel, undo) => {
    clearTimeout(timers.current.toast);
    undoRef.current = undo || null;
    setToast({ msg, action: actionLabel || "" });
    timers.current.toast = setTimeout(() => setToast(null), 5200);
  }, []);

  // ---------- Auto-save to Supabase (debounced) ----------
  const [saveStatus, setSaveStatus] = useState("idle");
  const isFirstRender = useRef(true);
  const abortControllerRef = useRef(null); // Mencegah Race Condition di API

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!receiptId) return;

    setSaveStatus("saving");

    // Batalkan request sebelumnya jika user mengetik lagi sebelum 800ms
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const timeout = setTimeout(async () => {
      const payload = {
        items: items.map(({ id, name, price }) => ({ id, name, price })),
        participants: participants.map(({ id, name }) => ({ id, name })),
        assignments: Object.entries(assignments).flatMap(([itemId, set]) =>
          [...set].map((participantId) => ({ itemId, participantId }))
        ),
        taxMode,
        taxValue,
        serviceMode,
        serviceValue,
        discountMode,
        discountAmount,
        splitMode,
      };

      try {
        const res = await fetch(`/api/receipts/${receiptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortControllerRef.current.signal, // Menyematkan Abort Signal
        });
        if (!res.ok) throw new Error("save failed");
        setSaveStatus("saved");
      } catch (err) {
        if (err.name !== "AbortError") {
          setSaveStatus("error");
          console.error("Gagal menyimpan data:", err);
        }
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [items, participants, assignments, taxMode, taxValue, serviceMode, serviceValue, discountMode, discountAmount, splitMode, receiptId]);

  // ---------- Perhitungan ----------
  const { results, grandTotal } = useMemo(
    () =>
      calculateSplit({
        items, participants, assignments, splitMode,
        taxMode, taxValue, serviceMode, serviceValue, discountMode, discountAmount,
      }),
    [items, participants, assignments, splitMode, taxMode, taxValue, serviceMode, serviceValue, discountMode, discountAmount]
  );

  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.price, 0), [items]);

  // Nominal pajak/service/diskon: yang mentah dipakai buat membagi per orang,
  // yang dibulatkan dipakai buat tampilan (selisih pembulatan diserap supaya
  // baris-barisnya pas dengan total).
  const fee = useMemo(() => {
    const rawTax = resolveAmount(taxMode, taxValue, subtotal);
    const rawSvc = resolveAmount(serviceMode, serviceValue, subtotal);
    const rawDisc = Math.min(resolveAmount(discountMode, discountAmount, subtotal), subtotal + rawTax + rawSvc);
    let tax = Math.round(rawTax);
    let svc = Math.round(rawSvc);
    let disc = Math.round(rawDisc);
    const adj = grandTotal - (Math.round(subtotal) + tax + svc - disc);
    if (adj) {
      if (tax > 0) tax += adj;
      else if (svc > 0) svc += adj;
      else if (disc > 0) disc -= adj;
    }
    return { rawTax, rawSvc, rawDisc, tax, svc, disc };
  }, [taxMode, taxValue, serviceMode, serviceValue, discountMode, discountAmount, subtotal, grandTotal]);

  const subtotalR = Math.round(subtotal);

  const sumLines = useMemo(() => {
    const lines = [{ label: "Subtotal", value: rp(subtotalR), cls: "" }];
    if (fee.tax > 0) lines.push({ label: `Pajak${taxMode === "percent" ? ` ${pctText(taxValue)}%` : ""}`, value: rp(fee.tax), cls: "" });
    if (fee.svc > 0) lines.push({ label: `Service${serviceMode === "percent" ? ` ${pctText(serviceValue)}%` : ""}`, value: rp(fee.svc), cls: "" });
    if (fee.disc > 0) lines.push({ label: `Diskon${discountMode === "percent" ? ` ${pctText(discountAmount)}%` : ""}`, value: `-${rp(fee.disc)}`, cls: "minus" });
    return lines;
  }, [subtotalR, fee, taxMode, taxValue, serviceMode, serviceValue, discountMode, discountAmount]);

  const unassigned = items.filter((it) => !assignments[it.id] || assignments[it.id].size === 0);
  const nUn = unassigned.length;
  const ready2 = participants.length >= 2 && (splitMode === "equal" || nUn === 0);
  const hasItems = items.length > 0;

  // Rincian per orang (layar hasil)
  const breakdown = useMemo(
    () =>
      results.map((r, idx) => {
        const lines = [];
        let itemCount = 0;
        if (splitMode === "equal") {
          lines.push({ kind: "item", label: "Bagian rata dari subtotal", amount: Math.round(r.raw) });
        } else {
          items.forEach((it) => {
            const ids = [...(assignments[it.id] || [])];
            if (!ids.includes(r.id)) return;
            itemCount += 1;
            lines.push({
              kind: "item",
              label: it.name + (ids.length > 1 ? ` (dibagi ${ids.length})` : ""),
              amount: Math.round(it.price / ids.length),
            });
          });
        }
        const prop = subtotal > 0 ? r.raw / subtotal : 0;
        const tax = Math.round(prop * fee.rawTax);
        const svc = Math.round(prop * fee.rawSvc);
        const disc = Math.round(prop * fee.rawDisc);
        if (tax > 0) lines.push({ kind: "tax", label: "Pajak", amount: tax });
        if (svc > 0) lines.push({ kind: "svc", label: "Service", amount: svc });
        if (disc > 0) lines.push({ kind: "disc", label: "Diskon", amount: disc });

        // Serap selisih pembulatan di baris terbesar supaya rincian = total.
        const signed = (l) => (l.kind === "disc" ? -l.amount : l.amount);
        const diff = r.rounded - lines.reduce((s, l) => s + signed(l), 0);
        if (diff !== 0 && lines.length) {
          const target =
            [...lines].filter((l) => l.kind === "item").sort((a, b) => b.amount - a.amount)[0] || lines[0];
          target.amount += target.kind === "disc" ? -diff : diff;
        }

        const color = personColor(idx);
        return {
          id: r.id,
          name: r.name,
          color,
          textColor: textOn(color),
          total: r.rounded,
          sub: splitMode === "equal" ? "Bagi rata" : `${itemCount} item`,
          lines,
        };
      }),
    [results, items, assignments, splitMode, subtotal, fee]
  );

  const donutBg = useMemo(() => {
    if (!breakdown.length || grandTotal <= 0) return "#DCD9EE";
    let acc = 0;
    const stops = [];
    breakdown.forEach((b) => {
      const end = acc + (b.total / grandTotal) * 100;
      const gap = Math.max(acc, end - 0.7);
      stops.push(`${b.color} ${acc.toFixed(2)}% ${gap.toFixed(2)}%`);
      stops.push(`#FFFFFF ${gap.toFixed(2)}% ${end.toFixed(2)}%`);
      acc = end;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [breakdown, grandTotal]);

  const summaryText = useMemo(() => {
    const parts = [];
    if (fee.tax > 0) parts.push(`pajak ${rp(fee.tax)}`);
    if (fee.svc > 0) parts.push(`service ${rp(fee.svc)}`);
    if (fee.disc > 0) parts.push(`diskon -${rp(fee.disc)}`);
    const lines = ["*Patungan makan bareng*", `Total struk: ${rp(grandTotal)}`, ""];
    results.forEach((r) => lines.push(`${r.name}: ${rp(r.rounded)}`));
    lines.push("");
    if (parts.length) lines.push(`Sudah termasuk ${parts.join(", ")}.`);
    lines.push(splitMode === "equal" ? "Dibagi rata." : "Dibagi sesuai pesanan.");
    lines.push("Dihitung pakai Porsi");
    return lines.join("\n");
  }, [fee, grandTotal, results, splitMode]);

  // ---------- Navigasi ----------
  function goStep(n) {
    if (n === 2 && !hasItems) return;
    if (n === 3 && !(hasItems && ready2)) return;
    setScreen(STEPS[n - 1].key);
    setConfirmReset(false);
  }

  const stepIndex = STEPS.find((s) => s.key === screen).n;

  // Setiap pindah langkah: balik ke atas dan fokus ke judul.
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    window.scrollTo(0, 0);
    document.getElementById("step-title")?.focus({ preventScroll: true });
  }, [screen]);

  // ---------- Item ----------
  function submitItem(e) {
    e.preventDefault();
    const name = titleCase(itemName);
    const price = parseInt(itemPrice || "0", 10);
    if (!name) {
      setItemError("Isi nama item dulu.");
      focusId("f-name");
      return;
    }
    if (!price) {
      setItemError("Isi harga, minimal Rp 1.");
      focusId("f-price");
      return;
    }
    if (editId) {
      setItems((prev) => prev.map((it) => (it.id === editId ? { ...it, name, price } : it)));
      setScannedIds((prev) => {
        const next = new Set(prev);
        next.delete(editId);
        return next;
      });
    } else {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev, { id, name, price }]);
      setAssignments((prev) => ({ ...prev, [id]: new Set() }));
    }
    setItemName("");
    setItemPrice("");
    setItemError("");
    setEditId(null);
    focusId("f-name");
  }

  function editItem(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setEditId(id);
    setItemName(it.name);
    setItemPrice(String(Math.round(it.price)));
    setItemError("");
    setTimeout(() => {
      const el = document.getElementById("f-name");
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus({ preventScroll: true });
      }
    }, 30);
  }

  function cancelEdit() {
    setEditId(null);
    setItemName("");
    setItemPrice("");
    setItemError("");
  }

  function removeItem(id) {
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const removed = items[idx];
    const removedAssign = assignments[id];
    setItems((prev) => prev.filter((x) => x.id !== id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editId === id) cancelEdit();
    showToast(`"${removed.name}" dihapus.`, "Urungkan", () => {
      setItems((prev) => {
        const list = prev.slice();
        list.splice(Math.min(idx, list.length), 0, removed);
        return list;
      });
      setAssignments((prev) => ({ ...prev, [id]: removedAssign || new Set() }));
    });
  }

  // ---------- Pajak, service, diskon ----------
  const feeSetters = {
    tax: { mode: taxMode, setMode: setTaxMode, value: taxValue, setValue: setTaxValue },
    svc: { mode: serviceMode, setMode: setServiceMode, value: serviceValue, setValue: setServiceValue },
    disc: { mode: discountMode, setMode: setDiscountMode, value: discountAmount, setValue: setDiscountAmount },
  };

  function changeFeeMode(key, mode) {
    const f = feeSetters[key];
    if (f.mode === mode) return;
    f.setMode(mode);
    f.setValue(0); // satuan beda, angka lama tidak relevan lagi
  }

  const feeDefs = [
    {
      key: "tax", label: "Pajak", hint: "PB1 atau PPN, dihitung dari subtotal",
      mode: taxMode, value: taxValue, amount: fee.tax,
      presets: [{ label: "10%", value: 10 }],
    },
    {
      key: "svc", label: "Service charge", hint: "Dihitung dari subtotal",
      mode: serviceMode, value: serviceValue, amount: fee.svc,
      presets: [{ label: "5%", value: 5 }, { label: "7,5%", value: 7.5 }],
    },
    {
      key: "disc", label: "Diskon", hint: "Dipotong dari total setelah pajak dan service",
      mode: discountMode, value: discountAmount, amount: fee.disc, isDiscount: true,
      presets: [],
    },
  ];

  const feeParts = [];
  if (fee.tax > 0) feeParts.push(`Pajak ${taxMode === "percent" ? `${pctText(taxValue)}%` : rp(fee.tax)}`);
  if (fee.svc > 0) feeParts.push(`Service ${serviceMode === "percent" ? `${pctText(serviceValue)}%` : rp(fee.svc)}`);
  if (fee.disc > 0) feeParts.push(`Diskon ${discountMode === "percent" ? `${pctText(discountAmount)}%` : rp(fee.disc)}`);
  const feesSummary = feeParts.length ? feeParts.join(", ") : "Belum diisi. Ketuk untuk menambahkan.";

  // ---------- Peserta & penandaan ----------
  function submitPerson(e) {
    e.preventDefault();
    const name = nameCase(personName);
    if (!name) {
      setPersonError("Isi nama peserta dulu.");
      focusId("p-name");
      return;
    }
    if (participants.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setPersonError(`Nama "${name}" sudah ada. Tambahkan inisial, misal "${name} B".`);
      focusId("p-name");
      return;
    }
    setParticipants((prev) => [...prev, { id: crypto.randomUUID(), name }]);
    setPersonName("");
    setPersonError("");
    focusId("p-name");
  }

  function removeParticipant(id) {
    const idx = participants.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const person = participants[idx];
    const prevAssignments = assignments;
    setParticipants((prev) => prev.filter((p) => p.id !== id));
    setAssignments((prev) => {
      const next = {};
      for (const [itemId, set] of Object.entries(prev)) {
        const newSet = new Set(set);
        newSet.delete(id);
        next[itemId] = newSet;
      }
      return next;
    });
    showToast(`${person.name} dikeluarkan.`, "Urungkan", () => {
      setParticipants((prev) => {
        const list = prev.slice();
        list.splice(Math.min(idx, list.length), 0, person);
        return list;
      });
      setAssignments((prev) => {
        const next = { ...prev };
        Object.entries(prevAssignments).forEach(([itemId, set]) => {
          if (set.has(id) && next[itemId]) next[itemId] = new Set([...next[itemId], id]);
        });
        return next;
      });
    });
  }

  function toggleAssignment(itemId, participantId) {
    setAssignments((prev) => {
      const set = new Set(prev[itemId] || []);
      if (set.has(participantId)) set.delete(participantId);
      else set.add(participantId);
      return { ...prev, [itemId]: set };
    });
  }

  function toggleAll(itemId) {
    setAssignments((prev) => {
      const cur = prev[itemId] || new Set();
      const all = participants.length > 0 && participants.every((p) => cur.has(p.id));
      return { ...prev, [itemId]: all ? new Set() : new Set(participants.map((p) => p.id)) };
    });
  }

  function assignRest() {
    const everyone = participants.map((p) => p.id);
    const count = unassigned.length;
    setAssignments((prev) => {
      const next = { ...prev };
      unassigned.forEach((it) => {
        next[it.id] = new Set(everyone);
      });
      return next;
    });
    showToast(`${count} item ditandai untuk semua orang.`);
  }

  // ---------- Scan struk ----------
  function openScan() {
    setScanError("");
    setScan("choose");
    focusId("scan-primary");
  }

  function closeScan() {
    clearTimeout(timers.current.s1);
    clearTimeout(timers.current.s2);
    setScan(null);
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // supaya foto yang sama bisa dipilih lagi
    if (!file) return;

    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setScanError(`Ukuran foto kegedean (maks ${MAX_IMAGE_MB}MB). Coba foto ulang atau kompres dulu.`);
      setScan("choose");
      return;
    }

    setScanError("");
    setScan("busy");
    setScanStep(0);
    timers.current.s1 = setTimeout(() => setScanStep((s) => Math.max(s, 1)), 800);
    timers.current.s2 = setTimeout(() => setScanStep((s) => Math.max(s, 2)), 1600);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      await new Promise((resolve, reject) => {
        reader.onload = resolve;
        reader.onerror = reject;
      });

      const imageBase64 = await compressToDataUrl(file);

      const res = await fetch("/api/receipts/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Gagal memindai struk.");
      }

      const { data } = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("AI tidak menemukan item pesanan di struk ini.");
      }

      const newItems = data.map((item) => ({
        id: crypto.randomUUID(),
        name: item.name || "Item Tidak Terbaca",
        price: Number(item.price) || 0,
      }));

      setItems((prev) => [...prev, ...newItems]);
      setAssignments((prev) => {
        const next = { ...prev };
        newItems.forEach((i) => (next[i.id] = new Set()));
        return next;
      });
      setScannedIds((prev) => new Set([...prev, ...newItems.map((i) => i.id)]));

      clearTimeout(timers.current.s1);
      clearTimeout(timers.current.s2);
      setScanStep(3);
      timers.current.s3 = setTimeout(() => {
        setScan(null);
        setScanBanner(true);
        showToast(`${newItems.length} item terbaca. Periksa lagi sebelum lanjut.`);
      }, 450);
    } catch (err) {
      clearTimeout(timers.current.s1);
      clearTimeout(timers.current.s2);
      setScanError(err.message || "Koneksi gagal, coba lagi.");
      setScan("choose");
    }
  }

  // ---------- Hasil ----------
  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      showToast("Ringkasan disalin. Tinggal tempel di chat.");
    } catch {
      setPreviewOpen(true);
      showToast("Browser menolak akses salin. Salin manual dari pratinjau pesan.");
    }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
    showToast("Link tagihan disalin. Teman bisa membukanya untuk ikut menandai.");
  }

  async function startNewReceipt() {
    if (!confirmReset) {
      setConfirmReset(true);
      clearTimeout(timers.current.reset);
      timers.current.reset = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    try {
      const res = await fetch("/api/receipts", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Gagal membuat struk baru.");
      window.location.assign(`/r/${body.id}`); // muat ulang penuh supaya state bersih
    } catch (err) {
      setConfirmReset(false);
      showToast(err.message || "Gagal membuat struk baru, coba lagi.");
    }
  }

  // ---------- Turunan tampilan ----------
  const personIndex = (id) => participants.findIndex((p) => p.id === id);

  const barState =
    screen === "items"
      ? {
          hint: hasItems ? "" : "Tambah minimal 1 item untuk lanjut",
          caption: `Total, ${items.length} item`,
          disabled: !hasItems,
          cta: "Lanjut ke peserta",
          next: () => goStep(2),
        }
      : (() => {
          const reason =
            participants.length < 2
              ? participants.length === 0 ? "Tambahkan minimal 2 peserta" : "Tambahkan 1 peserta lagi"
              : splitMode === "itemized" && nUn > 0 ? `Tandai ${nUn} item lagi` : "";
          return {
            hint: reason,
            caption: `Total, ${participants.length} orang`,
            disabled: !!reason,
            cta: "Lihat hasil",
            next: () => goStep(3),
          };
        })();

  const peopleHint =
    participants.length === 0 ? "Tambahkan minimal 2 orang."
    : participants.length === 1 ? "Tambahkan 1 orang lagi."
    : `${participants.length} peserta`;
  const peopleHintCls = participants.length >= 2 ? "ok" : participants.length === 1 ? "warn" : "";

  const nAssigned = items.length - nUn;
  const assignPct = items.length ? Math.round((nAssigned / items.length) * 100) : 0;

  const perEqual = participants.length ? Math.round(grandTotal / participants.length) : 0;

  const saveText = saveStatus === "saving" ? "Menyimpan…" : saveStatus === "error" ? "Gagal menyimpan" : "Tersimpan";

  // ==========================================
  // Render
  // ==========================================
  return (
    <div className="pf">
      {/* Input file untuk scan (disembunyikan, dipicu dari lembar scan) */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
      <input ref={galleryRef} type="file" accept="image/*" onChange={handleScanFile} style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

      <header className={cx("top")}>
        <Link href="/" className={cx("brand")} aria-label="Porsi, kembali ke beranda">
          <Logo />
        </Link>
        <span className={cx("save", saveStatus === "saving" && "busy", saveStatus === "error" && "bad")} role="status">
          {saveStatus === "error" ? <IcAlert /> : <IcCheck strokeWidth={2.6} />}
          <span>{saveText}</span>
        </span>
        <button type="button" className={cx("btn-link")} onClick={copyLink}>
          <IcLink />
          Salin link
        </button>
      </header>

      <nav className={cx("stepper")} aria-label="Langkah">
        <ol>
          {STEPS.map((st) => {
            const cur = stepIndex === st.n;
            const done = stepIndex > st.n;
            const can = st.n === 1 || (st.n === 2 && hasItems) || (st.n === 3 && hasItems && ready2);
            return (
              <li key={st.n} className={cx("stp", cur && "cur", done && "done")}>
                <button type="button" onClick={() => goStep(st.n)} disabled={!can} aria-current={cur ? "step" : undefined}>
                  <span className={cx("dot")}>{done ? <IcCheck strokeWidth={3} /> : st.n}</span>
                  {st.label}
                </button>
                {st.n < 3 && <span className={cx("ln", done && "done")} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={cx("shell")}>
        <div className={cx("main")}>
          <section className={cx("card")}>
            {/* ================= LANGKAH 1: STRUK ================= */}
            {screen === "items" && (
              <>
                <h1 id="step-title" className={cx("h1")} tabIndex={-1}>Masukkan item struk</h1>
                <p className={cx("sub")}>Foto struknya, atau ketik manual. Semua bisa dikoreksi nanti.</p>

                <div className={cx("scan")}>
                  <span className={cx("scan-ic")} aria-hidden="true"><IcCamera /></span>
                  <div className={cx("scan-tx")}>
                    <b>Scan foto struk</b>
                    <span>Item dan harga terbaca otomatis.</span>
                  </div>
                  <button type="button" className={cx("btn", "btn-primary")} onClick={openScan}>Scan struk</button>
                </div>

                <div className={cx("or")}>atau ketik manual</div>

                <form onSubmit={submitItem} noValidate>
                  <div className={cx("add-grid")}>
                    <div className={cx("g-name")}>
                      <label className={cx("lbl")} htmlFor="f-name">Nama item</label>
                      <div className={cx("field")}>
                        <input
                          id="f-name" type="text" autoComplete="off" maxLength={40}
                          placeholder="Contoh: Nasi goreng"
                          value={itemName}
                          onChange={(e) => { setItemName(e.target.value); setItemError(""); }}
                        />
                      </div>
                    </div>
                    <div className={cx("g-price")}>
                      <label className={cx("lbl")} htmlFor="f-price">Harga</label>
                      <div className={cx("field")}>
                        <span className={cx("aff")}>Rp</span>
                        <input
                          id="f-price" type="text" inputMode="numeric" autoComplete="off" placeholder="0"
                          value={itemPrice ? num(parseInt(itemPrice, 10)) : ""}
                          onChange={(e) => { setItemPrice(e.target.value.replace(/\D/g, "").slice(0, 9)); setItemError(""); }}
                        />
                      </div>
                    </div>
                  </div>
                  {itemError && (
                    <p className={cx("err")} role="alert"><IcAlert />{itemError}</p>
                  )}
                  <div className={cx("add-actions")}>
                    <button type="submit" className={cx("btn", "btn-secondary")}>{editId ? "Simpan perubahan" : "Tambah item"}</button>
                    {editId && <button type="button" className={cx("btn", "btn-ghost")} onClick={cancelEdit}>Batal</button>}
                  </div>
                </form>

                {scanBanner && (
                  <div className={cx("note")}>
                    <IcInfo />
                    <p><b>Hasil scan perlu dicek.</b> Ketuk ikon pensil untuk mengoreksi nama atau harga.</p>
                    <button type="button" className={cx("icon-btn")} aria-label="Tutup catatan" onClick={() => setScanBanner(false)}>
                      <IcClose />
                    </button>
                  </div>
                )}

                {hasItems ? (
                  <ul className={cx("items")} aria-label="Daftar item">
                    {items.map((it) => (
                      <li key={it.id} className={cx("it", editId === it.id && "editing")}>
                        <span className={cx("it-n")}>
                          {it.name}
                          {scannedIds.has(it.id) && <span className={cx("tag")}>Dari scan</span>}
                        </span>
                        <span className={cx("it-a")}>{rp(it.price)}</span>
                        <div className={cx("it-ctl")}>
                          <div className={cx("it-act")}>
                            <button type="button" className={cx("icon-btn")} aria-label={`Ubah ${it.name}`} onClick={() => editItem(it.id)}>
                              <IcPencil />
                            </button>
                            <button type="button" className={cx("icon-btn", "del")} aria-label={`Hapus ${it.name}`} onClick={() => removeItem(it.id)}>
                              <IcTrash />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={cx("empty")}>
                    <IcReceipt />
                    <b>Belum ada item</b>
                    <p>Scan struk atau tambah item di atas.</p>
                  </div>
                )}

                <div className={cx("fees")}>
                  <button type="button" className={cx("fees-h")} aria-expanded={feesOpen} onClick={() => setFeesOpen((o) => !o)}>
                    <span className={cx("fees-t")}>
                      <b>Pajak, service &amp; diskon</b>
                      <span>{feesSummary}</span>
                    </span>
                    <span className={cx("chev", feesOpen && "open")}><IcChev /></span>
                  </button>
                  {feesOpen && (
                    <div>
                      {feeDefs.map((def) => (
                        <FeeRow
                          key={def.key}
                          def={def}
                          onMode={(m) => changeFeeMode(def.key, m)}
                          onValue={(v) => feeSetters[def.key].setValue(v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ================= LANGKAH 2: PESERTA ================= */}
            {screen === "assign" && (
              <>
                <h1 id="step-title" className={cx("h1")} tabIndex={-1}>Siapa saja yang ikut?</h1>
                <p className={cx("sub")}>Tambahkan peserta, lalu tandai siapa memesan apa.</p>

                <section aria-labelledby="h-peserta">
                  <h2 className={cx("h2")} id="h-peserta" style={{ marginBottom: 12 }}>Peserta</h2>
                  <form className={cx("padd")} onSubmit={submitPerson} noValidate>
                    <label className={cx("sr")} htmlFor="p-name">Nama peserta</label>
                    <div className={cx("field")}>
                      <input
                        id="p-name" type="text" autoComplete="off" maxLength={16}
                        placeholder="Nama peserta, misal Sari"
                        value={personName}
                        onChange={(e) => { setPersonName(e.target.value); setPersonError(""); }}
                      />
                    </div>
                    <button type="submit" className={cx("btn", "btn-secondary")}>Tambah</button>
                  </form>
                  {personError && <p className={cx("err")} role="alert"><IcAlert />{personError}</p>}
                  {participants.length > 0 && (
                    <ul className={cx("chips")} aria-label="Daftar peserta">
                      {participants.map((p, i) => (
                        <li key={p.id} className={cx("pchip")}>
                          <span className={cx("av")} style={{ "--c": personColor(i), "--t": textOn(personColor(i)) }} aria-hidden="true">
                            {initials(p.name)}
                          </span>
                          {p.name}
                          <button type="button" className={cx("icon-btn")} aria-label={`Keluarkan ${p.name}`} onClick={() => removeParticipant(p.id)}>
                            <IcClose style={{ width: 16, height: 16 }} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={cx("hint", peopleHintCls)} aria-live="polite">{peopleHint}</p>
                </section>

                <section className={cx("blk")} aria-labelledby="h-cara">
                  <h2 className={cx("h2")} id="h-cara" style={{ marginBottom: 12 }}>Cara bagi tagihan</h2>
                  <div className={cx("modes")} role="radiogroup" aria-labelledby="h-cara">
                    <button type="button" role="radio" aria-checked={splitMode === "itemized"} className={cx("mode", splitMode === "itemized" && "on")} onClick={() => setSplitMode("itemized")}>
                      <b>Sesuai pesanan</b>
                      <span>Tiap orang bayar item yang dia pesan.</span>
                      <span className={cx("ck")} aria-hidden="true"><IcCheck strokeWidth={3.2} /></span>
                    </button>
                    <button type="button" role="radio" aria-checked={splitMode === "equal"} className={cx("mode", splitMode === "equal" && "on")} onClick={() => setSplitMode("equal")}>
                      <b>Bagi rata</b>
                      <span>Total dibagi sama rata ke semua orang.</span>
                      <span className={cx("ck")} aria-hidden="true"><IcCheck strokeWidth={3.2} /></span>
                    </button>
                  </div>
                </section>

                {splitMode === "itemized" && (
                  <section className={cx("blk")} aria-labelledby="h-siapa">
                    <div className={cx("h-row")}>
                      <h2 className={cx("h2")} id="h-siapa">Siapa pesan apa?</h2>
                      <span className={cx("cnt")}>{nAssigned} dari {items.length} item ditandai</span>
                    </div>
                    <div className={cx("prog")} aria-hidden="true"><span style={{ width: `${assignPct}%` }} /></div>
                    <ul className={cx("acs")}>
                      {items.map((it) => {
                        const ids = [...(assignments[it.id] || [])].filter((id) => personIndex(id) >= 0);
                        const k = ids.length;
                        const allOn = participants.length > 0 && participants.every((p) => ids.includes(p.id));
                        const firstName = k === 1 ? participants[personIndex(ids[0])].name : "";
                        const caption =
                          k === 0 ? "Belum ada yang dipilih"
                          : k === 1 ? `${firstName} membayar sendiri`
                          : `Dibagi ${k} orang, ${it.price % k ? "sekitar " : ""}${rp(Math.round(it.price / k))} per orang`;
                        return (
                          <li key={it.id} className={cx("ac", k === 0 && "bad")}>
                            <div className={cx("ac-h")}>
                              <span className={cx("ac-n")}>{it.name}</span>
                              <span className={cx("ac-a")}>{rp(it.price)}</span>
                            </div>
                            {participants.length === 0 ? (
                              <p className={cx("ac-none")}>Tambahkan peserta dulu untuk menandai item ini.</p>
                            ) : (
                              <div className={cx("pcs")} role="group" aria-label={`Siapa memesan ${it.name}`}>
                                <button type="button" className={cx("pc2", "all", allOn && "on")} aria-pressed={allOn} onClick={() => toggleAll(it.id)}>
                                  <IcUsers />Semua
                                </button>
                                {participants.map((p, i) => {
                                  const on = ids.includes(p.id);
                                  return (
                                    <button
                                      key={p.id} type="button"
                                      className={cx("pc2", on && "on")}
                                      style={{ "--c": personColor(i), "--t": textOn(personColor(i)) }}
                                      aria-pressed={on}
                                      onClick={() => toggleAssignment(it.id, p.id)}
                                    >
                                      <span className={cx("av")} style={{ width: 26, height: 26, fontSize: 12 }} aria-hidden="true">{initials(p.name)}</span>
                                      {p.name}
                                      <IcCheck className="ck" strokeWidth={3.2} />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <p className={cx("ac-cap", k === 0 && "warn")}>{caption}</p>
                          </li>
                        );
                      })}
                    </ul>
                    {participants.length >= 2 && nUn > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <button type="button" className={cx("linkbtn")} onClick={assignRest}>
                          Tandai {nUn} item sisanya untuk semua orang
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {splitMode === "equal" && (
                  <section className={cx("eq")} aria-live="polite">
                    <p>
                      {participants.length >= 2
                        ? `${rp(grandTotal)} dibagi rata ke ${participants.length} orang`
                        : `Total struk ${rp(grandTotal)}`}
                    </p>
                    <b>{participants.length >= 2 ? `± ${rp(perEqual)}` : "Belum ada peserta"}</b>
                    <p>
                      {participants.length >= 2
                        ? "per orang. Selisih beberapa rupiah dibagi adil supaya totalnya pas."
                        : "Tambahkan minimal 2 orang untuk melihat porsi masing-masing."}
                    </p>
                  </section>
                )}
              </>
            )}

            {/* ================= LANGKAH 3: HASIL ================= */}
            {screen === "summary" && (
              <>
                <h1 id="step-title" className={cx("h1")} tabIndex={-1}>Ringkasan pembayaran</h1>
                <p className={cx("sub")}>
                  {splitMode === "equal"
                    ? "Total struk dibagi rata ke semua peserta."
                    : "Pajak, service, dan diskon sudah dibagi sesuai porsi belanja masing-masing."}
                </p>

                <div className={cx("res-top")}>
                  <div className={cx("donut")} style={{ background: donutBg }} aria-hidden="true">
                    <span className={cx("donut-c")}>
                      <small>Total struk</small>
                      <b>{rp(grandTotal)}</b>
                    </span>
                  </div>
                  <div className={cx("res-meta")}>
                    <span className={cx("big")}>Dibagi ke {participants.length} orang</span>
                    <p>{splitMode === "equal" ? "Bagi rata" : "Sesuai pesanan"}. Total struk {rp(grandTotal)}.</p>
                    <span className={cx("okline")}>
                      <IcCheck strokeWidth={3} />Jumlah semua porsi cocok dengan struk
                    </span>
                  </div>
                </div>

                <ul className={cx("plist")} aria-label="Porsi tiap orang">
                  {breakdown.map((b) => {
                    const open = !!openRows[b.id];
                    return (
                      <li key={b.id} className={cx("pitem")}>
                        <button type="button" className={cx("prow")} aria-expanded={open} onClick={() => setOpenRows((o) => ({ ...o, [b.id]: !o[b.id] }))}>
                          <span className={cx("av", "lg")} style={{ "--c": b.color, "--t": b.textColor }} aria-hidden="true">{initials(b.name)}</span>
                          <span className={cx("pn")}>
                            <b>{b.name}</b>
                            <small>{b.sub}</small>
                          </span>
                          <span className={cx("pamt")}>{rp(b.total)}</span>
                          <span className={cx("chev", open && "open")}><IcChev /></span>
                        </button>
                        {open && (
                          <div className={cx("pdet")}>
                            {b.lines.map((l, i) => (
                              <div key={i} className={cx("dl", l.kind === "disc" && "minus")}>
                                <span>{l.label}</span>
                                <span>{l.kind === "disc" ? `-${rp(l.amount)}` : rp(l.amount)}</span>
                              </div>
                            ))}
                            <div className={cx("dl", "sum-l")}>
                              <span>Total {b.name}</span>
                              <span>{rp(b.total)}</span>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <div className={cx("tot-card", "narrow-only")}>
                  <div className={cx("sum")}>
                    {sumLines.map((l) => (
                      <div key={l.label} className={cx(l.cls)}><span>{l.label}</span><span>{l.value}</span></div>
                    ))}
                  </div>
                  <div className={cx("tot")}><b>Total struk</b><span>{rp(grandTotal)}</span></div>
                </div>

                <div className={cx("share")}>
                  <a className={cx("btn", "btn-primary")} href={`https://wa.me/?text=${encodeURIComponent(summaryText)}`} target="_blank" rel="noopener noreferrer">
                    <IcSend />Bagikan ke WhatsApp
                  </a>
                  <button type="button" className={cx("btn", "btn-secondary")} onClick={copySummary}>
                    <IcCopy />Salin ringkasan
                  </button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className={cx("linkbtn")} aria-expanded={previewOpen} onClick={() => setPreviewOpen((o) => !o)}>
                    {previewOpen ? "Sembunyikan pratinjau pesan" : "Lihat pratinjau pesan"}
                  </button>
                  {previewOpen && <pre className={cx("msg")}>{summaryText}</pre>}
                </div>

                <div className={cx("foot-actions")}>
                  <button type="button" className={cx("btn", "btn-ghost")} onClick={() => goStep(2)}>
                    <IcBack />Ubah pesanan
                  </button>
                  <button type="button" className={cx("btn", "btn-ghost", confirmReset && "danger")} onClick={startNewReceipt}>
                    <IcReset />{confirmReset ? "Ketuk lagi untuk mulai baru" : "Hitung struk baru"}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Bilah bawah: total berjalan + tombol lanjut */}
          {screen !== "summary" && (
            <div className={cx("bar", screen === "assign" && "has-back")}>
              {screen === "assign" && (
                <button type="button" className={cx("btn", "btn-ghost", "bar-back")} aria-label="Kembali ke langkah sebelumnya" onClick={() => goStep(1)}>
                  <IcBack /><span>Kembali</span>
                </button>
              )}
              <div className={cx("bar-txt")} aria-live="polite">
                {barState.hint ? (
                  <span className={cx("bar-hint")}><IcAlert />{barState.hint}</span>
                ) : (
                  <>
                    <span className={cx("bar-cap")}>{barState.caption}</span>
                    <span className={cx("bar-val")}>{rp(grandTotal)}</span>
                  </>
                )}
              </div>
              <button type="button" className={cx("btn", "btn-primary")} disabled={barState.disabled} onClick={barState.next}>
                {barState.cta}<IcArrow />
              </button>
            </div>
          )}
        </div>

        {/* Struk di samping (hanya layar lebar) */}
        <aside className={cx("rail")} aria-label="Rincian struk">
          <div className={cx("rc")}>
            <div className={cx("rc-head")}>
              <b>Struk</b>
              <span>{hasItems ? `${items.length} item` : "Kosong"}</span>
            </div>
            {hasItems ? (
              <ul className={cx("rc-list")}>
                {items.map((it) => (
                  <li key={it.id}>
                    <span className={cx("rc-n")}>{it.name}</span>
                    <span className={cx("rc-a")}>{num(it.price)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cx("rc-empty")}>Item yang kamu tambahkan muncul di sini.</p>
            )}
            <div className={cx("sum")}>
              {sumLines.map((l) => (
                <div key={l.label} className={cx(l.cls)}><span>{l.label}</span><span>{l.value}</span></div>
              ))}
            </div>
            <div className={cx("tot")}><b>Total</b><span>{rp(grandTotal)}</span></div>
          </div>
        </aside>
      </div>

      {toast && (
        <div className={cx("toast", screen === "summary" && "low")} role="status">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                const undo = undoRef.current;
                undoRef.current = null;
                setToast(null);
                if (undo) undo();
              }}
            >
              {toast.action}
            </button>
          )}
        </div>
      )}

      {/* Lembar scan struk */}
      {scan && (
        <div className={cx("scrim")} onKeyDown={(e) => { if (e.key === "Escape" && scan === "choose") closeScan(); }}>
          <div className={cx("sheet")} role="dialog" aria-modal="true" aria-labelledby="scan-title">
            {scan === "choose" && (
              <>
                <h2 id="scan-title">Scan foto struk</h2>
                <p>Pastikan seluruh struk terlihat dan tidak buram.</p>
                <div className={cx("vf")} aria-hidden="true">
                  <span className={cx("corner", "tl")} /><span className={cx("corner", "tr")} />
                  <span className={cx("corner", "bl")} /><span className={cx("corner", "br")} />
                  <div className={cx("bar-l", "l")} /><div className={cx("bar-l", "m")} />
                  <div className={cx("bar-l", "l")} /><div className={cx("bar-l", "s")} />
                </div>
                {scanError && <p className={cx("err", "scan-err")} role="alert"><IcAlert />{scanError}</p>}
                <div className={cx("sheet-act")}>
                  <button type="button" id="scan-primary" className={cx("btn", "btn-primary")} onClick={() => cameraRef.current?.click()}>
                    <IcCamera />Ambil foto
                  </button>
                  <button type="button" className={cx("btn", "btn-secondary")} onClick={() => galleryRef.current?.click()}>
                    <IcImage />Pilih dari galeri
                  </button>
                  <button type="button" className={cx("btn", "btn-ghost")} onClick={closeScan}>Batal</button>
                </div>
                <small>Foto dikirim ke layanan AI untuk dibaca. Hasilnya bisa kamu koreksi.</small>
              </>
            )}
            {scan === "busy" && (
              <>
                <h2 id="scan-title">Membaca struk…</h2>
                <p>Sebentar ya, jangan tutup halaman ini.</p>
                <div className={cx("vf")} aria-hidden="true">
                  <span className={cx("corner", "tl")} /><span className={cx("corner", "tr")} />
                  <span className={cx("corner", "bl")} /><span className={cx("corner", "br")} />
                  <div className={cx("bar-l", "l")} /><div className={cx("bar-l", "m")} />
                  <div className={cx("bar-l", "l")} /><div className={cx("bar-l", "s")} />
                  <span className={cx("beam")} />
                </div>
                <ul className={cx("pg")} aria-live="polite">
                  {SCAN_LABELS.map((label, i) => {
                    const done = scanStep > i;
                    return (
                      <li key={label} className={cx(done ? "done" : scanStep === i ? "now" : "")}>
                        <span className={cx("st")}>{done && <IcCheck strokeWidth={4} />}</span>
                        {label}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}