import { jsPDF } from "jspdf";
import { formatZAR } from "./whatsapp";

export async function generateGN404Certificate(ledger: any): Promise<Blob> {
  const doc = new jsPDF();
  const { group, cash_tie, members } = ledger;
  const payloadStr = JSON.stringify({ id: group.id, year: group.cycle_year, bal: cash_tie.expected_balance_cents });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payloadStr));
  const checksum = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

  doc.setFontSize(16);
  doc.text(`${group.name} — Annual Financial Statement (GN 404)`, 14, 20);
  doc.setFontSize(10);
  doc.text(`Cycle Year: ${group.cycle_year} | Language: English | Archetype: ${group.archetype}`, 14, 28);
  doc.text(`Non-Custodial Verification Checksum: ${checksum}`, 14, 34);

  doc.setFontSize(11);
  doc.text(`Total Member Credits: ${formatZAR(cash_tie.member_credits_cents)}`, 14, 46);
  doc.text(`Bank Interest Distributed: ${formatZAR(cash_tie.bank_interest_cents)}`, 14, 53);
  doc.text(`Less Bank Fees: -${formatZAR(cash_tie.bank_fees_cents)}`, 14, 60);
  doc.text(`Less Verified Payouts: -${formatZAR(cash_tie.verified_payouts_cents)}`, 14, 67);
  doc.text(`Net Cash-Tie Balance: ${formatZAR(cash_tie.expected_balance_cents)}`, 14, 75);

  let y = 90;
  doc.setFontSize(10);
  doc.text("Member Seat | Proxy/Successor | Total Settled", 14, y);
  y += 7;
  for (const m of members || []) {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(`${m.display_name} | ${m.successor_name || "Self"} | ${formatZAR(m.settled_cents)}`, 14, y);
    y += 6;
  }
  return doc.output("blob");
}
