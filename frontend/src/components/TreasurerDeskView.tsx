import React, { useState } from "react";
import { Upload, Users, BookOpen, RotateCcw, FileDown, Share2, ExternalLink } from "lucide-react";
import { parseStatementLocally } from "../lib/ingestStatement";
import { generateGN404Certificate } from "../lib/pdfExport";
import { buildGroupWhatsAppDigest, buildMemberMagicLink, buildNonPunitiveNudge, chromeIntentUrl, formatZAR, isAndroidWhatsAppWebView } from "../lib/whatsapp";
import type { IngestResult, ParsedTransaction } from "../workers/ingestUtils";

interface Props {
  apiUrl: string;
  slug: string;
  token: string;
  ledger: any;
  onRefresh: () => void;
  onLogout: () => void;
}

export function TreasurerDeskView({ apiUrl, slug, token, ledger, onRefresh, onLogout }: Props) {
  const [tab, setTab] = useState<"UPLOAD" | "MEMBERS" | "BOOK">("UPLOAD");
  const [accountMode, setAccountMode] = useState<"PERSONAL" | "DEDICATED">("PERSONAL");
  const [isParsing, setIsParsing] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [preview, setPreview] = useState<IngestResult | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Assign unmatched deposit modal state
  const [assigningTx, setAssigningTx] = useState<any | null>(null);
  const [rememberAlias, setRememberAlias] = useState(true);

  // Add member quick card
  const [showAddMember, setShowAddMember] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAlias, setNewAlias] = useState("");

  // Manual cash entry
  const [cashMemberId, setCashMemberId] = useState("");
  const [cashRands, setCashRands] = useState("");
  const [cashNote, setCashNote] = useState("");

  const members: any[] = ledger.members || [];

  function autoSelectRows(txs: ParsedTransaction[], mode: "PERSONAL" | "DEDICATED") {
    const next = new Set<number>();
    const targetCents = ledger.group.contribution_cents;
    txs.forEach((tx, idx) => {
      if (mode === "DEDICATED") {
        if (tx.category !== "PERSONAL_EXPENSE" && tx.category !== "SELF_TRANSFER") next.add(idx);
        return;
      }
      // Personal Account Quarantine: NEVER auto-tick debits/personal expenses
      if (tx.direction !== "CREDIT") return;
      const matchesMember = members.some((m) =>
        (tx.extracted_msisdn && (tx.extracted_msisdn === m.msisdn_norm || tx.extracted_msisdn === m.successor_msisdn)) ||
        (m.proxy_aliases || []).some((a: string) => a && tx.raw_description.toUpperCase().includes(a.toUpperCase())) ||
        tx.raw_description.toUpperCase().includes(m.display_name.toUpperCase())
      );
      const exactMultiple = targetCents > 0 && tx.amount_cents % targetCents === 0 && tx.amount_cents <= targetCents * 4;
      if (matchesMember || exactMultiple) next.add(idx);
    });
    setSelectedIndexes(next);
  }

  async function runParse(file: File, password?: string) {
    setErr(""); setMsg(""); setIsParsing(true);
    try {
      const res = await parseStatementLocally(file, password);
      if (res.status === "NEED_PASSWORD") { setPendingFile(file); setNeedPassword(true); return; }
      if (res.status === "SCANNED_PDF_REJECTED") { setErr(res.message || "Scan rejected"); return; }
      setNeedPassword(false);
      setPreview(res);
      autoSelectRows(res.transactions, accountMode);
    } catch (e: any) {
      setErr(e?.message || "Could not read statement");
    } finally {
      setIsParsing(false);
    }
  }

  async function commitSelected() {
    if (!preview) return;
    setErr(""); setMsg("");
    const chosen = preview.transactions
      .filter((_, idx) => selectedIndexes.has(idx))
      .map((tx) => ({
        ...tx,
        category: tx.category === "PERSONAL_EXPENSE" ? "UNCLASSIFIED" : tx.category
      }));
    if (chosen.length === 0) { setErr("Tick at least one stokvel payment first."); return; }

    const res = await fetch(`${apiUrl}/v1/groups/${slug}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bank_code: preview.bankCode, file_sha256: preview.fileSha256, transactions: chosen })
    });
    const d = await res.json();
    if (!res.ok) { setErr(d.error || "Import failed"); return; }
    setPreview(null);
    setMsg(`Saved ${d.inserted} stokvel payments (${d.skipped} duplicates skipped).`);
    onRefresh();
  }

  async function assignToMember(memberId: string) {
    if (!assigningTx) return;
    const kw = assigningTx.extracted_msisdn || assigningTx.raw_description.slice(0, 22);
    const res = await fetch(`${apiUrl}/v1/groups/${slug}/transactions/${assigningTx.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ member_id: memberId, save_alias: rememberAlias, alias_keyword: kw, reason_note: "Treasurer matched deposit" })
    });
    if (res.ok) { setAssigningTx(null); onRefresh(); }
  }

  async function rollbackBatch(batchId: string) {
    if (!window.confirm("Remove this entire statement upload and undo its balances?")) return;
    const res = await fetch(`${apiUrl}/v1/groups/${slug}/batches/${batchId}/rollback`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) { setMsg("Last statement upload removed cleanly."); onRefresh(); }
  }

  async function addMemberSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${apiUrl}/v1/groups/${slug}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ display_name: newName, msisdn: newPhone, pin: "1954", proxy_aliases: newAlias ? [newAlias] : [] })
    });
    if (res.ok) { setNewName(""); setNewPhone(""); setNewAlias(""); setShowAddMember(false); onRefresh(); }
  }

  async function recordCashAdvance(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${apiUrl}/v1/groups/${slug}/advances`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ member_id: cashMemberId, amount_cents: Math.round(parseFloat(cashRands || "0") * 100), interest_cents: 0, fee_cents: 0, reason_note: cashNote })
    });
    if (res.ok) { setCashRands(""); setCashNote(""); setMsg("Cash payout/advance recorded (0% interest)."); onRefresh(); }
  }

  async function exportCertificate() {
    const blob = await generateGN404Certificate(ledger);
    const file = new File([blob], `${ledger.group.slug}-Certificate.pdf`, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `${ledger.group.name} Year-End Book` });
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    }
  }

  const unmatchedCredits = (ledger.transactions || []).filter((t: any) => t.direction === "CREDIT" && t.category !== "INTEREST" && !t.matched_member_id);
  const paidCount = members.filter((m) => m.settled_cents >= ledger.group.contribution_cents).length;

  return (
    <div className="space-y-5">
      {isAndroidWhatsAppWebView() && (
        <div className="p-4 rounded-xl bg-stokvel-amberBg border-2 border-stokvel-amber text-stokvel-amber space-y-2">
          <div className="font-bold text-base">WhatsApp blocks PDF picking on some phones.</div>
          <a href={chromeIntentUrl()} className="min-h-[56px] w-full rounded-xl bg-stokvel-amber text-white font-bold text-base flex items-center justify-center gap-2">
            Open in Chrome to Upload PDF <ExternalLink className="w-5 h-5" />
          </a>
        </div>
      )}

      {/* Treasurer Header */}
      <div className="bg-paper-card border border-paper-ruled rounded-xl p-4 flex flex-wrap justify-between items-center gap-3">
        <div>
          <div className="text-xl font-bold text-ink-primary">{ledger.group.name} â€” Treasurer Office</div>
          <div className="text-base text-ink-secondary font-semibold">Group Code: <span className="font-bold text-stokvel-green">{ledger.group.short_code}</span> â€¢ Pot: {formatZAR(ledger.cash_tie.expected_balance_cents)}</div>
        </div>
        <button onClick={onLogout} className="min-h-[56px] px-4 rounded-xl border-2 border-paper-ruled text-base font-bold">Close Book</button>
      </div>

      {/* 3 Tab Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => setTab("UPLOAD")} className={`min-h-[56px] px-4 rounded-xl font-bold text-base border-2 flex items-center justify-center gap-2 ${tab === "UPLOAD" ? "bg-stokvel-green text-white border-stokvel-green" : "bg-paper-card border-paper-ruled"}`}>
          <Upload className="w-5 h-5" /> Add Bank Statement
        </button>
        <button onClick={() => setTab("MEMBERS")} className={`min-h-[56px] px-4 rounded-xl font-bold text-base border-2 flex items-center justify-center gap-2 ${tab === "MEMBERS" ? "bg-stokvel-green text-white border-stokvel-green" : "bg-paper-card border-paper-ruled"}`}>
          <Users className="w-5 h-5" /> Members ({unmatchedCredits.length} unlinked)
        </button>
        <button onClick={() => setTab("BOOK")} className={`min-h-[56px] px-4 rounded-xl font-bold text-base border-2 flex items-center justify-center gap-2 ${tab === "BOOK" ? "bg-stokvel-green text-white border-stokvel-green" : "bg-paper-card border-paper-ruled"}`}>
          <BookOpen className="w-5 h-5" /> Yearly Book & Fixes
        </button>
      </div>

      {err && <div className="p-4 rounded-xl bg-stokvel-alertBg border border-stokvel-alert text-stokvel-alert text-base font-bold">{err}</div>}
      {msg && <div className="p-4 rounded-xl bg-stokvel-greenBg border border-stokvel-green text-stokvel-green text-base font-bold">{msg}</div>}

      {/* TAB 1: 3-STEP STATEMENT UPLOAD WITH PERSONAL ACCOUNT QUARANTINE */}
      {tab === "UPLOAD" && (
        <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-5">
          <div className="space-y-3">
            <div className="text-lg font-bold">Step 1: Which bank account is this PDF from?</div>
            <button type="button" onClick={() => { setAccountMode("PERSONAL"); if (preview) autoSelectRows(preview.transactions, "PERSONAL"); }} className={`w-full min-h-[64px] p-4 rounded-xl border-2 text-left ${accountMode === "PERSONAL" ? "border-stokvel-green bg-stokvel-greenBg" : "border-paper-ruled bg-paper-canvas"}`}>
              <div className="font-bold text-base">My Personal Bank Account (Safe Default)</div>
              <div className="text-base text-ink-secondary">Hides all your personal Checkers, airtime & card shopping automatically.</div>
            </button>
            <button type="button" onClick={() => { setAccountMode("DEDICATED"); if (preview) autoSelectRows(preview.transactions, "DEDICATED"); }} className={`w-full min-h-[64px] p-4 rounded-xl border-2 text-left ${accountMode === "DEDICATED" ? "border-stokvel-green bg-stokvel-greenBg" : "border-paper-ruled bg-paper-canvas"}`}>
              <div className="font-bold text-base">Dedicated Stokvel Bank Account</div>
              <div className="text-base text-ink-secondary">Includes bank fees, interest, and group payouts.</div>
            </button>
          </div>

          <label className="min-h-[64px] w-full rounded-xl bg-stokvel-green text-white font-bold text-lg flex items-center justify-center gap-2 cursor-pointer px-4">
            <Upload className="w-6 h-6" /> {isParsing ? "Reading Statement on Your Phone..." : "Choose Bank Statement (PDF / CSV)"}
            <input type="file" accept=".pdf,.csv,.ofx,.zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) runParse(f); e.target.value = ""; }} />
          </label>

          {needPassword && pendingFile && (
            <div className="p-4 rounded-xl bg-stokvel-amberBg border border-stokvel-amber space-y-3">
              <div className="font-bold text-base">This PDF has a password (stays only on your phone):</div>
              <input type="password" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="Type PDF password (e.g. last 6 of ID)" className="w-full min-h-[56px] px-4 rounded-lg bg-paper-card border border-paper-ruled text-lg" />
              <button onClick={() => runParse(pendingFile, pdfPassword)} className="w-full min-h-[56px] rounded-xl bg-stokvel-amber text-white font-bold text-base">Unlock PDF</button>
            </div>
          )}

          {preview && (
            <div className="space-y-4 pt-3 border-t border-paper-ruled">
              <div className="text-lg font-bold text-stokvel-green">
                Step 2: Tick Only Stokvel Payments ({preview.bankCode})
              </div>
              <p className="text-base text-ink-secondary">
                {accountMode === "PERSONAL" ? "All personal card swipes and shopping were safely removed." : "Review transactions below."} Tick the stokvel payments to save:
              </p>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {preview.transactions.map((tx, idx) => {
                  if (accountMode === "PERSONAL" && tx.direction !== "CREDIT") return null;
                  const checked = selectedIndexes.has(idx);
                  return (
                    <button key={idx} type="button" onClick={() => {
                      const next = new Set(selectedIndexes);
                      if (checked) next.delete(idx); else next.add(idx);
                      setSelectedIndexes(next);
                    }} className={`w-full min-h-[56px] p-3.5 rounded-xl border-2 text-left flex items-center justify-between gap-3 ${checked ? "border-stokvel-green bg-stokvel-greenBg" : "border-paper-ruled bg-paper-canvas"}`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" readOnly checked={checked} className="w-6 h-6 mt-1 accent-[#0F6B3A]" />
                        <div>
                          <div className="font-bold text-base">{tx.tx_date} â€¢ {tx.direction === "CREDIT" ? "Money In" : tx.category}</div>
                          <div className="text-base text-ink-secondary break-words">{tx.raw_description}</div>
                        </div>
                      </div>
                      <div className="text-lg font-extrabold tabular-nums whitespace-nowrap">{formatZAR(tx.amount_cents)}</div>
                    </button>
                  );
                })}
              </div>
              <button onClick={commitSelected} className="w-full min-h-[64px] rounded-xl bg-stokvel-green text-white font-bold text-lg">
                Step 3: Save {selectedIndexes.size} Checked Payments
              </button>
            </div>
          )}

          <a href={buildGroupWhatsAppDigest(ledger.group.name, ledger.group.short_code, ledger.cash_tie.expected_balance_cents, paidCount, members.length, ledger.group.slug)} className="w-full min-h-[56px] rounded-xl border-2 border-stokvel-green text-stokvel-green font-bold text-base flex items-center justify-center gap-2">
            <Share2 className="w-5 h-5" /> Send Update to WhatsApp Group
          </a>
        </div>
      )}

      {/* TAB 2: MEMBERS, HELPERS & TAP-TO-ASSIGN UNLINKED DEPOSITS */}
      {tab === "MEMBERS" && (
        <div className="space-y-4">
          {unmatchedCredits.length > 0 && (
            <div className="bg-stokvel-amberBg border-2 border-stokvel-amber rounded-xl p-4 space-y-3">
              <div className="text-lg font-bold text-stokvel-amber">Unlinked Money In ({unmatchedCredits.length})</div>
              {unmatchedCredits.map((tx: any) => (
                <div key={tx.id} className="p-3 rounded-lg bg-paper-card border border-paper-ruled space-y-2">
                  <div className="flex justify-between font-bold text-base">
                    <span>{tx.tx_date}</span>
                    <span className="tabular-nums">{formatZAR(tx.amount_cents)}</span>
                  </div>
                  <div className="text-base text-ink-secondary">{tx.raw_description}</div>
                  <button onClick={() => setAssigningTx(tx)} className="w-full min-h-[56px] rounded-xl bg-stokvel-amber text-white font-bold text-base">
                    Tap to Choose Which Member Paid
                  </button>
                </div>
              ))}
            </div>
          )}

          {assigningTx && (
            <div className="bg-paper-card border-2 border-stokvel-green rounded-xl p-5 space-y-3">
              <div className="text-lg font-bold">Who paid {formatZAR(assigningTx.amount_cents)}?</div>
              <label className="flex items-center gap-3 min-h-[56px]">
                <input type="checkbox" checked={rememberAlias} onChange={(e) => setRememberAlias(e.target.checked)} className="w-6 h-6 accent-[#0F6B3A]" />
                <span className="text-base font-semibold">Remember this relative for next month</span>
              </label>
              <div className="space-y-2">
                {members.map((m) => (
                  <button key={m.id} onClick={() => assignToMember(m.id)} className="w-full min-h-[56px] p-3 rounded-xl border-2 border-paper-ruled text-left font-bold text-base hover:bg-stokvel-greenBg">
                    {m.display_name} ({m.msisdn_norm})
                  </button>
                ))}
              </div>
              <button onClick={() => setAssigningTx(null)} className="w-full min-h-[56px] rounded-xl border-2 border-paper-ruled font-bold">Cancel</button>
            </div>
          )}

          <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-3">
            <div className="flex justify-between items-center gap-3">
              <div className="text-lg font-bold">Members & Helpers</div>
              <button onClick={() => setShowAddMember(!showAddMember)} className="min-h-[56px] px-4 rounded-xl bg-stokvel-green text-white font-bold text-base">+ Add Member</button>
            </div>
            {showAddMember && (
              <form onSubmit={addMemberSubmit} className="p-4 rounded-xl bg-paper-subtle space-y-3">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Member Full Name" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" required />
                <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Cellphone Number" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" required />
                <input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="Helper Phone/Surname (optional)" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" />
                <button type="submit" className="w-full min-h-[56px] rounded-xl bg-stokvel-green text-white font-bold text-base">Save Member</button>
              </form>
            )}
            {members.map((m) => {
              const owing = Math.max(0, ledger.group.contribution_cents - m.settled_cents);
              return (
                <div key={m.id} className="p-4 rounded-xl bg-paper-subtle border border-paper-ruled space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="text-lg font-bold">{m.display_name}</div>
                      <div className="text-base text-ink-secondary">{m.msisdn_norm} â€¢ Paid: {formatZAR(m.settled_cents)}</div>
                      {m.successor_name && <div className="text-base text-ink-secondary">Beneficiary: {m.successor_name}</div>}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-base font-bold ${owing === 0 ? "bg-stokvel-greenBg text-stokvel-green" : "bg-stokvel-amberBg text-stokvel-amber"}`}>
                      {owing === 0 ? "âœ“ Paid" : `Still Needed: ${formatZAR(owing)}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <a href={`https://wa.me/?text=${encodeURIComponent(`Hi ${m.display_name}, open our ${ledger.group.name} book here: ${buildMemberMagicLink(slug, m.msisdn_norm)}`)}`} className="min-h-[56px] rounded-xl border-2 border-stokvel-green text-stokvel-green font-bold text-base flex items-center justify-center">
                      Send Member Book Link
                    </a>
                    {owing > 0 && (
                      <a href={buildNonPunitiveNudge(m.msisdn_norm, m.display_name, ledger.group.name, owing)} className="min-h-[56px] rounded-xl bg-stokvel-amber text-white font-bold text-base flex items-center justify-center">
                        Send Friendly Reminder
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: YEAR-END BOOK & SAFETY FIXES */}
      {tab === "BOOK" && (
        <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-5">
          <div className="text-lg font-bold">Year-End Book & Safety Fixes</div>
          <button onClick={exportCertificate} className="w-full min-h-[64px] rounded-xl bg-stokvel-green text-white font-bold text-lg flex items-center justify-center gap-2">
            <FileDown className="w-6 h-6" /> Create Year-End Stokvel Certificate
          </button>

          <div className="space-y-2 pt-3 border-t border-paper-ruled">
            <div className="font-bold text-base">Recent Statement Uploads</div>
            {(ledger.batches || []).filter((b: any) => b.status === "COMMITTED").map((b: any) => (
              <div key={b.id} className="p-3 rounded-lg bg-paper-subtle flex flex-wrap justify-between items-center gap-2">
                <span className="text-base">{b.bank_code} ({b.tx_inserted_count} rows) â€¢ {b.created_at}</span>
                <button onClick={() => rollbackBatch(b.id)} className="min-h-[56px] px-4 rounded-xl bg-stokvel-alertBg border border-stokvel-alert text-stokvel-alert font-bold text-base inline-flex items-center gap-2">
                  <RotateCcw className="w-5 h-5" /> Remove Last Statement Upload
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={recordCashAdvance} className="space-y-3 pt-3 border-t border-paper-ruled">
            <div className="font-bold text-base">Record Payout / 0% Member Advance</div>
            <div className="space-y-2">
              {members.map((m) => (
                <button key={m.id} type="button" onClick={() => setCashMemberId(m.id)} className={`w-full min-h-[56px] px-4 rounded-xl border-2 text-left font-bold ${cashMemberId === m.id ? "border-stokvel-green bg-stokvel-greenBg" : "border-paper-ruled"}`}>
                  {m.display_name}
                </button>
              ))}
            </div>
            <input type="number" value={cashRands} onChange={(e) => setCashRands(e.target.value)} placeholder="Amount (R)" className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border border-paper-ruled text-base" required />
            <input value={cashNote} onChange={(e) => setCashNote(e.target.value)} placeholder="Reason (e.g. December Payout)" className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border border-paper-ruled text-base" required />
            <button type="submit" disabled={!cashMemberId} className="w-full min-h-[56px] rounded-xl bg-ink-primary text-white font-bold text-base disabled:opacity-40">
              Record Cash Payout (0% Interest)
            </button>
          </form>
        </div>
      )}
    </div>
  );
}