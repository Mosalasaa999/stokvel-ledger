import Papa from "papaparse";

export interface ParsedTransaction {
  tx_date: string;
  direction: "CREDIT" | "DEBIT";
  amount_cents: number;
  balance_cents: number | null;
  category: "CONTRIBUTION" | "BANK_FEE" | "INTEREST" | "PAYOUT" | "SELF_TRANSFER" | "UNCLASSIFIED";
  raw_description: string;
  extracted_msisdn: string;
  occ_index: number;
}

export interface IngestResult {
  status: "OK" | "NEED_PASSWORD" | "SCANNED_PDF_REJECTED" | "CHECKSUM_ERROR";
  bankCode: string;
  fileSha256: string;
  transactions: ParsedTransaction[];
  checksumDivergentIndex?: number;
  message?: string;
}

export function parseZARCents(raw: string): { cents: number; negative: boolean } {
  const s = raw.trim();
  if (!s || s === "-" || s === "--") return { cents: 0, negative: false };
  const negative = s.startsWith("-") || s.endsWith("-") || /\bDR\b/i.test(s);
  const cleaned = s.replace(/[R\s]/gi, "").replace(/^ZAR/i, "").replace(/[-+]|DR|CR/gi, "");
  const m = cleaned.match(/^([\d.,]*?)[.,](\d{2})$/);
  if (!m) {
    const whole = parseInt(cleaned.replace(/[.,]/g, ""), 10);
    return { cents: isNaN(whole) ? 0 : whole * 100, negative };
  }
  const wholeStr = m[1].replace(/[.,]/g, "") || "0";
  const cents = parseInt(wholeStr, 10) * 100 + parseInt(m[2], 10);
  return { cents: isNaN(cents) ? 0 : cents, negative };
}

export function normalizeDateISO(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
  };
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/);
  if (m) {
    const mon = months[m[2].toUpperCase()];
    if (!mon) return null;
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${mon}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export function extractMSISDN(desc: string): string {
  const m = desc.match(/(?:\+27|27|0)[\s-]?([6-8][0-9])[\s-]?([0-9]{3})[\s-]?([0-9]{4})/);
  return m ? `0${m[1]}${m[2]}${m[3]}` : "";
}

export function classifyCategory(desc: string, direction: "CREDIT" | "DEBIT"): ParsedTransaction["category"] {
  const u = desc.toUpperCase();
  if (direction === "DEBIT") {
    if (/(FEE|VAS - MOBILE|SMS NOTIFICATION|MONTHLY ADMIN|SERVICE CHARGE|VAT)/.test(u)) return "BANK_FEE";
    if (/(GOALSAVE|SAVINGS POCKET|OWN ACCOUNT)/.test(u)) return "SELF_TRANSFER";
    return "PAYOUT";
  }
  if (/(INTEREST|DIVIDEND|VITALITY REWARD)/.test(u)) return "INTEREST";
  if (/(FROM GOALSAVE|OWN ACCOUNT TRANSFER)/.test(u)) return "SELF_TRANSFER";
  return "UNCLASSIFIED";
}

export function detectBankCode(text: string): string {
  const u = text.toUpperCase();
  if (u.includes("GOTYME") || u.includes("TYMEBANK")) return "GOTYME";
  if (u.includes("STANDARD BANK") || u.includes("MYMO")) return "STANDARD_BANK";
  if (u.includes("CAPITEC")) return "CAPITEC";
  if (u.includes("FIRST NATIONAL BANK") || u.includes("FNB")) return "FNB";
  if (u.includes("ABSA")) return "ABSA";
  if (u.includes("NEDBANK")) return "NEDBANK";
  if (u.includes("DISCOVERY BANK")) return "DISCOVERY";
  if (u.includes("AFRICAN BANK")) return "AFRICAN_BANK";
  if (u.includes("BANK ZERO")) return "BANK_ZERO";
  return "UNKNOWN_SA_BANK";
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseOFX(text: string): ParsedTransaction[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const out: ParsedTransaction[] = [];
  const occ: Record<string, number> = {};
  for (const blk of blocks) {
    const dt = blk.match(/<DTPOSTED>(\d{8})/i)?.[1];
    const amtRaw = blk.match(/<TRNAMT>([^\r\n<]+)/i)?.[1];
    const name = blk.match(/<NAME>([^\r\n<]+)/i)?.[1] ?? "";
    const memo = blk.match(/<MEMO>([^\r\n<]+)/i)?.[1] ?? "";
    if (!dt || !amtRaw) continue;
    const txDate = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const { cents, negative } = parseZARCents(amtRaw);
    if (cents <= 0) continue;
    const direction = negative ? "DEBIT" : "CREDIT";
    const desc = `${name} ${memo}`.trim();
    const key = `${txDate}|${direction}|${cents}|${desc.toUpperCase()}`;
    const idx = occ[key] ?? 0;
    occ[key] = idx + 1;
    out.push({
      tx_date: txDate, direction, amount_cents: cents, balance_cents: null,
      category: classifyCategory(desc, direction), raw_description: desc,
      extracted_msisdn: extractMSISDN(desc), occ_index: idx
    });
  }
  return out;
}

export function parseCSVText(rawText: string): ParsedTransaction[] {
  const lines = rawText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => {
    const u = l.toUpperCase();
    return u.includes("DATE") && (u.includes("AMOUNT") || u.includes("CREDIT") || u.includes("MONEY IN")) && (u.includes("DESC") || u.includes("DETAIL") || u.includes("BALANCE"));
  });
  if (headerIdx === -1) return [];
  const parsed = Papa.parse<Record<string, string>>(lines.slice(headerIdx).join("\n"), { header: true, skipEmptyLines: true });
  const out: ParsedTransaction[] = [];
  const occ: Record<string, number> = {};
  for (const row of parsed.data) {
    const keys = Object.keys(row);
    const dateKey = keys.find((k) => /date|datum/i.test(k));
    const descKey = keys.find((k) => /desc|detail|narrative|particular/i.test(k));
    const creditKey = keys.find((k) => /credit|money in|deposit/i.test(k));
    const debitKey = keys.find((k) => /debit|money out|payment/i.test(k));
    const amtKey = keys.find((k) => /^amount$/i.test(k.trim()));
    const balKey = keys.find((k) => /balance|saldo/i.test(k));
    if (!dateKey || !row[dateKey]) continue;
    const txDate = normalizeDateISO(row[dateKey]);
    if (!txDate) continue;
    const desc = (descKey ? row[descKey] : "") || "Bank Entry";
    let direction: "CREDIT" | "DEBIT" = "CREDIT";
    let cents = 0;
    if (creditKey && debitKey) {
      const cr = parseZARCents(row[creditKey] || "");
      const dr = parseZARCents(row[debitKey] || "");
      if (cr.cents > 0) { direction = "CREDIT"; cents = cr.cents; }
      else if (dr.cents > 0) { direction = "DEBIT"; cents = dr.cents; }
    } else if (amtKey) {
      const val = parseZARCents(row[amtKey] || "");
      direction = val.negative ? "DEBIT" : "CREDIT";
      cents = val.cents;
    }
    if (cents <= 0) continue;
    const bal = balKey && row[balKey] ? parseZARCents(row[balKey]) : null;
    const balCents = bal ? (bal.negative ? -bal.cents : bal.cents) : null;
    const key = `${txDate}|${direction}|${cents}|${desc.toUpperCase()}`;
    const idx = occ[key] ?? 0;
    occ[key] = idx + 1;
    out.push({
      tx_date: txDate, direction, amount_cents: cents, balance_cents: balCents,
      category: classifyCategory(desc, direction), raw_description: desc.trim(),
      extracted_msisdn: extractMSISDN(desc), occ_index: idx
    });
  }
  return out;
}
