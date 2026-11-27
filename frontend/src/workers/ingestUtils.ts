import Papa from "papaparse";

export interface ParsedTransaction {
  tx_date: string;
  direction: "CREDIT" | "DEBIT";
  amount_cents: number;
  balance_cents: number | null;
  category: "CONTRIBUTION" | "BANK_FEE" | "INTEREST" | "PAYOUT" | "SELF_TRANSFER" | "UNCLASSIFIED" | "PERSONAL_EXPENSE";
  raw_description: string;
  extracted_msisdn: string;
  occ_index: number;
}

export interface IngestResult {
  status: "OK" | "NEED_PASSWORD" | "SCANNED_PDF_REJECTED" | "CHECKSUM_ERROR";
  bankCode: string;
  fileSha256: string;
  transactions: ParsedTransaction[];
  message?: string;
}

export interface HeaderToken {
  text: string;
  tx: number;
  ty: number;
  width: number;
  rightEdge: number;
}

export interface FusedHeaderColumn {
  label: string;
  leftX: number;
  rightEdge: number;
  role: "date" | "desc" | "debit" | "credit" | "amount" | "balance" | "ignore";
}

export function fuseVerticalHeaderBand(tokens: HeaderToken[]): FusedHeaderColumn[] {
  const sorted = [...tokens].sort((a, b) => a.tx - b.tx || b.ty - a.ty);
  const clusters: HeaderToken[][] = [];
  for (const tok of sorted) {
    if (!tok.text.trim()) continue;
    const match = clusters.find((g) => {
      const gLeft = Math.min(...g.map((t) => t.tx));
      const gRight = Math.max(...g.map((t) => t.rightEdge));
      const ySpan = Math.max(...g.map((t) => Math.abs(t.ty - tok.ty)));
      return ySpan <= 18 && tok.tx <= gRight + 10 && tok.rightEdge >= gLeft - 10;
    });
    if (match) match.push(tok);
    else clusters.push([tok]);
  }
  return clusters.map((g) => {
    g.sort((a, b) => b.ty - a.ty || a.tx - b.tx);
    const label = g.map((t) => t.text.trim()).join(" ").replace(/\s+/g, " ").toUpperCase();
    const leftX = Math.min(...g.map((t) => t.tx));
    const rightEdge = Math.max(...g.map((t) => t.rightEdge));
    let role: FusedHeaderColumn["role"] = "ignore";
    if (/\b(DATE|DATUM)\b/.test(label)) role = "date";
    else if (/\b(DESCRIPTION|DETAILS|PARTICULARS|NARRATIVE|TRANSACTION)\b/.test(label)) role = "desc";
    else if (/\b(MONEY\s*IN|CREDIT|CREDITS|DEPOSIT|DEPOSITS|INFLOW)\b/.test(label)) role = "credit";
    else if (/\b(MONEY\s*OUT|DEBIT|DEBITS|PAYMENT|PAYMENTS|WITHDRAWAL|OUTFLOW)\b/.test(label)) role = "debit";
    else if (/\b(BALANCE|SALDO)\b/.test(label)) role = "balance";
    else if (/\b(AMOUNT|VALUE|RAND|ZAR)\b/.test(label)) role = "amount";
    return { label, leftX, rightEdge, role };
  }).filter((c) => c.role !== "ignore");
}

const STRICT_BANK_FEE_REGEX =
  /^(?:FEE\s*:|FEES\s*:|BANK\s+FEE\b|MONTHLY\s+(?:ADMIN|ACCOUNT|SERVICE)\s+FEE\b|ADMIN\s+FEE\b|SERVICE\s+FEE\b|SMS\s+NOTIFICATION\s+FEE\b|TRANSACTIONAL\s+SMS\b|CASH\s+DEPOSIT\s+FEE\b|PAYSHAP\s+FEE\b|IMMEDIATE\s+(?:PMT|PAYMENT)\s+FEE\b|EFT\s+FEE\b|ATM\s+WITHDRAWAL\s+FEE\b)|\b(?:BANK\s+CHARGES?|HONOURING\s+FEE|DECLINED\s+TX\s+FEE|VAT\s+ON\s+FEES?)\b/i;

const STRICT_INTEREST_REGEX =
  /^(?:INTEREST\s+(?:RECEIVED|PAID|CAPITALISED|CREDIT)|CREDIT\s+INTEREST)\b|\b(?:SAVINGS\s+INTEREST|STOKVEL\s+INTEREST)\b/i;

const PERSONAL_RETAIL_NOISE_REGEX =
  /\b(?:CHECKERS|SHOPRITE|PICK\s*N\s*PAY|WOOLWORTHS|SPAR|BOXER|USAVE|MAKRO|GAME|CLICKS|DIS-?CHEM|ENGEN|SHELL|SASOL|BP|TOTALENERGIES|CALTEX|UBER|BOLT|MR\s*D|TAKEALOT|KFC|NANDOS|MCDONALDS|VAS\s*-\s*MOBILE|AIRTIME|DATA\s+BUNDLE|ELECTRICITY|PREPAID|POS\s+PURCHASE|CARD\s+PURCHASE)\b/i;

export function classifyCategory(desc: string, direction: "CREDIT" | "DEBIT"): ParsedTransaction["category"] {
  const d = desc.trim();
  if (direction === "CREDIT") return STRICT_INTEREST_REGEX.test(d) ? "INTEREST" : "CONTRIBUTION";
  if (/(GOALSAVE|SAVINGS POCKET|OWN ACCOUNT)/i.test(d)) return "SELF_TRANSFER";
  if (STRICT_BANK_FEE_REGEX.test(d)) return "BANK_FEE";
  if (PERSONAL_RETAIL_NOISE_REGEX.test(d)) return "PERSONAL_EXPENSE";
  return "PAYOUT";
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
    out.push({ tx_date: txDate, direction, amount_cents: cents, balance_cents: null, category: classifyCategory(desc, direction), raw_description: desc, extracted_msisdn: extractMSISDN(desc), occ_index: idx });
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
    out.push({ tx_date: txDate, direction, amount_cents: cents, balance_cents: balCents, category: classifyCategory(desc, direction), raw_description: desc.trim(), extracted_msisdn: extractMSISDN(desc), occ_index: idx });
  }
  return out;
}