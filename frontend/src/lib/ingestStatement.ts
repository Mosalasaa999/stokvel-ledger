import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { unzipSync, strFromU8 } from "fflate";
import {
  IngestResult, ParsedTransaction, classifyCategory, detectBankCode,
  extractMSISDN, normalizeDateISO, parseCSVText, parseOFX, parseZARCents, sha256Hex
} from "../workers/ingestUtils";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function parseStatementLocally(file: File, password?: string): Promise<IngestResult> {
  const buffer = await file.arrayBuffer();
  const fileSha256 = await sha256Hex(buffer);
  const bytes = new Uint8Array(buffer);

  const isPDF = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isZIP = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  if (isZIP) {
    const files = unzipSync(bytes);
    const ofxName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".ofx"));
    if (ofxName) {
      const text = strFromU8(files[ofxName]);
      return { status: "OK", bankCode: detectBankCode(text), fileSha256, transactions: parseOFX(text) };
    }
  }

  if (!isPDF) {
    const text = new TextDecoder().decode(bytes);
    const txs = file.name.toLowerCase().endsWith(".ofx") || text.includes("<OFX>") ? parseOFX(text) : parseCSVText(text);
    return { status: "OK", bankCode: detectBankCode(text), fileSha256, transactions: txs };
  }

  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer, password }).promise;
    let sampleTextChars = 0;
    let hasRasterImages = false;
    let fullHeaderText = "";

    interface Cell { str: string; tx: number; rightEdge: number; ty: number; }
    const allVisualRows: Cell[][] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      if (p <= 3) {
        const opList = await page.getOperatorList();
        if (opList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)) hasRasterImages = true;
      }
      const yMap = new Map<number, Cell[]>();
      for (const item of content.items as any[]) {
        const str = (item.str || "").trim();
        if (!str) continue;
        if (p <= 3) sampleTextChars += str.length;
        fullHeaderText += " " + str;
        const tx = item.transform[4];
        const ty = Math.round(item.transform[5] / 2.5) * 2.5;
        const rightEdge = tx + (item.width || 0);
        if (!yMap.has(ty)) yMap.set(ty, []);
        yMap.get(ty)!.push({ str, tx, rightEdge, ty });
      }
      const ys = Array.from(yMap.keys()).sort((a, b) => b - a);
      for (const y of ys) allVisualRows.push(yMap.get(y)!.sort((a, b) => a.tx - b.tx));
    }

    if (sampleTextChars / Math.min(3, pdf.numPages) < 40 && hasRasterImages) {
      return {
        status: "SCANNED_PDF_REJECTED", bankCode: "SCANNED_IMAGE", fileSha256, transactions: [],
        message: "Scanned/photographed PDF detected. Export the native digital PDF from your banking app."
      };
    }

    let colAnchors: { key: string; x: number; rightEdge: number }[] = [];
    for (const row of allVisualRows) {
      const joined = row.map((c) => c.str.toUpperCase()).join(" ");
      if (joined.includes("DATE") && (joined.includes("BALANCE") || joined.includes("DESC") || joined.includes("DETAIL"))) {
        colAnchors = row.map((c) => {
          const u = c.str.toUpperCase();
          if (u.includes("DATE") || u.includes("DATUM")) return { key: "date", x: c.tx, rightEdge: c.rightEdge };
          if (u.includes("DESC") || u.includes("DETAIL") || u.includes("PARTICULAR")) return { key: "desc", x: c.tx, rightEdge: c.rightEdge };
          if (u.includes("MONEY OUT") || u.includes("DEBIT") || u.includes("PAYMENT")) return { key: "debit", x: c.tx, rightEdge: c.rightEdge };
          if (u.includes("MONEY IN") || u.includes("CREDIT") || u.includes("DEPOSIT")) return { key: "credit", x: c.tx, rightEdge: c.rightEdge };
          if (u.includes("AMOUNT")) return { key: "amount", x: c.tx, rightEdge: c.rightEdge };
          if (u.includes("BALANCE") || u.includes("SALDO")) return { key: "balance", x: c.tx, rightEdge: c.rightEdge };
          return { key: "ignore", x: c.tx, rightEdge: c.rightEdge };
        }).filter((c) => c.key !== "ignore");
        break;
      }
    }

    const transactions: ParsedTransaction[] = [];
    let current: ParsedTransaction | null = null;
    const occ: Record<string, number> = {};

    for (const row of allVisualRows) {
      if (colAnchors.length === 0) break;
      const bucket: Record<string, string> = { date: "", desc: "", debit: "", credit: "", amount: "", balance: "" };
      for (const cell of row) {
        const isNum = /^[-+R\s\d.,]+(?:DR|CR)?$/i.test(cell.str) && /\d/.test(cell.str);
        let best = colAnchors[0];
        let minDist = Infinity;
        for (const anc of colAnchors) {
          const dist = isNum && (anc.key === "debit" || anc.key === "credit" || anc.key === "amount" || anc.key === "balance")
            ? Math.abs(cell.rightEdge - anc.rightEdge)
            : Math.abs(cell.tx - anc.x);
          if (dist < minDist) { minDist = dist; best = anc; }
        }
        bucket[best.key] = (bucket[best.key] + " " + cell.str).trim();
      }
      const isoDate = normalizeDateISO(bucket.date);
      if (isoDate) {
        if (current) transactions.push(current);
        let direction: "CREDIT" | "DEBIT" = "CREDIT";
        let cents = 0;
        if (bucket.credit || bucket.debit) {
          const cr = parseZARCents(bucket.credit);
          const dr = parseZARCents(bucket.debit);
          if (cr.cents > 0) { direction = "CREDIT"; cents = cr.cents; }
          else if (dr.cents > 0) { direction = "DEBIT"; cents = dr.cents; }
        } else if (bucket.amount) {
          const v = parseZARCents(bucket.amount);
          direction = v.negative ? "DEBIT" : "CREDIT";
          cents = v.cents;
        }
        const balObj = bucket.balance ? parseZARCents(bucket.balance) : null;
        const balCents = balObj ? (balObj.negative ? -balObj.cents : balObj.cents) : null;
        if (cents > 0) {
          const desc = bucket.desc.trim();
          const k = `${isoDate}|${direction}|${cents}|${desc.toUpperCase()}`;
          const idx = occ[k] ?? 0;
          occ[k] = idx + 1;
          current = {
            tx_date: isoDate, direction, amount_cents: cents, balance_cents: balCents,
            category: classifyCategory(desc, direction), raw_description: desc,
            extracted_msisdn: extractMSISDN(desc), occ_index: idx
          };
        } else {
          current = null;
        }
      } else if (current && bucket.desc && !/(PAGE \d+ OF \d+|VAT NUMBER|OPENING BALANCE|CLOSING BALANCE)/i.test(bucket.desc)) {
        current.raw_description += " " + bucket.desc.trim();
        if (!current.extracted_msisdn) current.extracted_msisdn = extractMSISDN(current.raw_description);
        current.category = classifyCategory(current.raw_description, current.direction);
      }
    }
    if (current) transactions.push(current);

    for (let i = 1; i < transactions.length; i++) {
      const prev = transactions[i - 1];
      const curr = transactions[i];
      if (prev.balance_cents !== null && curr.balance_cents !== null) {
        const expected = prev.balance_cents + (curr.direction === "CREDIT" ? curr.amount_cents : -curr.amount_cents);
        if (expected !== curr.balance_cents) {
          return {
            status: "CHECKSUM_ERROR", bankCode: detectBankCode(fullHeaderText), fileSha256, transactions,
            checksumDivergentIndex: i,
            message: `Running balance checksum diverged at row ${i + 1} (${curr.tx_date}). Verify rows below before committing.`
          };
        }
      }
    }

    return { status: "OK", bankCode: detectBankCode(fullHeaderText), fileSha256, transactions };
  } catch (err: any) {
    if (err?.name === "PasswordException") {
      return { status: "NEED_PASSWORD", bankCode: "ENCRYPTED_PDF", fileSha256, transactions: [], message: "PDF is password-protected." };
    }
    throw err;
  }
}
