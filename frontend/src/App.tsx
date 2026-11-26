import React, { useEffect, useState } from "react";
import { ShieldCheck, Upload, AlertTriangle, RotateCcw, Share2, FileDown, ExternalLink } from "lucide-react";
import { useLedgerStore } from "./store/useLedgerStore";
import { buildGroupWhatsAppDigest, buildNonPunitiveNudge, chromeIntentUrl, formatZAR, isAndroidWhatsAppWebView } from "./lib/whatsapp";
import { generateGN404Certificate } from "./lib/pdfExport";
import { parseStatementLocally } from "./lib/ingestStatement";
import { CreateGroupForm } from "./components/CreateGroupForm";
import type { IngestResult } from "./workers/ingestUtils";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

export default function App() {
  const { slug, token, role, cachedLedger, setSession, setCachedLedger, logout } = useLedgerStore();
  const [apiStatus, setApiStatus] = useState<"waking" | "online">("waking");
  const [ledger, setLedger] = useState<any>(cachedLedger);
  const [viewMode, setViewMode] = useState<"LOGIN" | "CREATE">("LOGIN");
  const [pin, setPin] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [authRole, setAuthRole] = useState<"MEMBER" | "TREASURER">("MEMBER");
  const [inputSlug, setInputSlug] = useState(() => new URLSearchParams(window.location.search).get("g") || slug || "");
  const [errorMsg, setErrorMsg] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<IngestResult | null>(null);
  const [needPassword, setNeedPassword] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/healthz`).then((r) => { if (r.ok) setApiStatus("online"); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (token && slug) refreshLedger(slug, token);
  }, [token, slug]);

  async function refreshLedger(s: string, t: string) {
    try {
      const res = await fetch(`${API_URL}/v1/groups/${s}/ledger`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) { const d = await res.json(); setLedger(d); setCachedLedger(d); setApiStatus("online"); setErrorMsg(""); }
    } catch {}
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setErrorMsg("");
    try {
      const res = await fetch(`${API_URL}/v1/groups/${inputSlug}/auth`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msisdn, pin, role: authRole })
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Login failed"); return; }
      setSession(inputSlug, data.token, data.role);
    } catch (err: any) {
      setErrorMsg(err?.message || "Network error contacting vault");
    }
  }

  async function runLocalParse(file: File, password?: string) {
    setErrorMsg("");
    setIsParsing(true);
    try {
      const r = await parseStatementLocally(file, password);
      if (r.status === "NEED_PASSWORD") {
        setPendingFile(file);
        setNeedPassword(true);
      } else if (r.status === "SCANNED_PDF_REJECTED") {
        setErrorMsg(r.message || "Scanned PDF rejected.");
      } else {
        setNeedPassword(false);
        setPreviewResult(r);
      }
    } catch (err: any) {
      setErrorMsg("Parse error: " + (err?.message || "Could not read file"));
    } finally {
      setIsParsing(false);
    }
  }

  async function commitPreviewBatch() {
    if (!previewResult || !token || !slug) return;
    setErrorMsg("");
    try {
      const res = await fetch(`${API_URL}/v1/groups/${slug}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bank_code: previewResult.bankCode, file_sha256: previewResult.fileSha256, transactions: previewResult.transactions })
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Import failed"); return; }
      setPreviewResult(null);
      refreshLedger(slug, token);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to commit batch");
    }
  }

  async function handleUndoBatch(batchId: string) {
    const res = await fetch(`${API_URL}/v1/groups/${slug}/batches/${batchId}/rollback`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) refreshLedger(slug, token);
  }

  async function handleAssignMember(txId: string, memberId: string, desc: string) {
    if (!memberId) return;
    const alias = prompt("Proxy keyword to remember for future months (or leave blank):", desc.slice(0, 20)) || "";
    const res = await fetch(`${API_URL}/v1/groups/${slug}/transactions/${txId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ member_id: memberId, save_alias: !!alias, alias_keyword: alias, reason_note: "Treasurer linked proxy deposit" })
    });
    if (res.ok) refreshLedger(slug, token);
  }

  async function handleExportPDF() {
    if (!ledger) return;
    const blob = await generateGN404Certificate(ledger);
    const file = new File([blob], `${ledger.group.slug}-GN404.pdf`, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `${ledger.group.name} GN 404 Statement` });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
    }
  }

  return (
    <div className="min-h-screen bg-[#0A1120] text-slate-100 px-4 py-6 max-w-3xl mx-auto">
      {isAndroidWhatsAppWebView() && (
        <div className="mb-4 p-3 rounded bg-amber-900/50 border border-amber-500 text-xs flex items-center justify-between">
          <span>WhatsApp browser may block PDF uploads.</span>
          <a href={chromeIntentUrl()} className="px-2 py-1 bg-amber-500 text-black font-bold rounded inline-flex items-center gap-1">Open in Chrome <ExternalLink className="w-3 h-3" /></a>
        </div>
      )}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-emerald-400 flex items-center gap-2"><ShieldCheck className="w-6 h-6" /> StokvelLedger</h1>
          <p className="text-xs text-slate-400">Zero-Custody • Parsed Locally • {apiStatus === "waking" ? "Syncing vault..." : "Vault Online"}</p>
        </div>
        {token && <button onClick={logout} className="text-xs px-3 py-1.5 rounded bg-[#131E32] border border-slate-700">Lock Vault</button>}
      </header>
      {errorMsg && <div className="mb-4 p-3 rounded bg-amber-950 border border-amber-500 text-amber-200 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {errorMsg}</div>}
      {!token ? (
        <div className="space-y-4">
          <div className="flex gap-2 text-xs">
            <button onClick={() => setViewMode("LOGIN")} className={`px-3 py-1.5 rounded ${viewMode === "LOGIN" ? "bg-emerald-600" : "bg-[#131E32]"}`}>Unlock Existing Group</button>
            <button onClick={() => setViewMode("CREATE")} className={`px-3 py-1.5 rounded ${viewMode === "CREATE" ? "bg-emerald-600" : "bg-[#131E32]"}`}>+ Create New Stokvel</button>
          </div>
          {viewMode === "CREATE" ? (
            <CreateGroupForm apiUrl={API_URL} onCreated={(s, t) => { setErrorMsg(""); setSession(s, t, "TREASURER"); }} />
          ) : (
            <form onSubmit={handleLogin} className="bg-[#131E32] p-5 rounded-lg border border-slate-800 space-y-4">
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => setAuthRole("MEMBER")} className={`px-3 py-1.5 rounded ${authRole === "MEMBER" ? "bg-emerald-600" : "bg-slate-800"}`}>Member View</button>
                <button type="button" onClick={() => setAuthRole("TREASURER")} className={`px-3 py-1.5 rounded ${authRole === "TREASURER" ? "bg-emerald-600" : "bg-slate-800"}`}>Treasurer Admin</button>
              </div>
              <input value={inputSlug} onChange={(e) => setInputSlug(e.target.value)} placeholder="Group Slug" className="w-full p-2.5 rounded bg-[#0A1120] border border-slate-700 text-sm" required />
              {authRole === "MEMBER" && <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="Registered Phone (e.g. 0715099424)" className="w-full p-2.5 rounded bg-[#0A1120] border border-slate-700 text-sm" required />}
              <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4 to 6-Digit PIN" className="w-full p-2.5 rounded bg-[#0A1120] border border-slate-700 text-sm" required />
              <button type="submit" className="w-full py-2.5 rounded bg-emerald-600 font-semibold text-sm">Unlock Ledger</button>
            </form>
          )}
        </div>
      ) : ledger ? (
        <div className="space-y-6">
          <div className="bg-[#131E32] p-4 rounded-lg border border-emerald-700/50">
            <div className="text-xs text-slate-400">{ledger.group.name} • Slug: <span className="text-emerald-300 font-mono">{ledger.group.slug}</span></div>
            <div className="text-2xl font-bold text-emerald-400 my-1">{formatZAR(ledger.cash_tie.expected_balance_cents)}</div>
            <div className="text-xs text-slate-300">Credits ({formatZAR(ledger.cash_tie.member_credits_cents)}) − Fees ({formatZAR(ledger.cash_tie.bank_fees_cents)}) + Interest ({formatZAR(ledger.cash_tie.bank_interest_cents)}) − Payouts ({formatZAR(ledger.cash_tie.verified_payouts_cents)})</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <a href={buildGroupWhatsAppDigest(ledger.group.name, ledger.cash_tie.expected_balance_cents, (ledger.members || []).filter((m: any) => m.settled_cents >= ledger.group.contribution_cents).length, (ledger.members || []).length, ledger.group.slug)} className="px-3 py-1.5 rounded bg-emerald-600 text-xs font-semibold inline-flex items-center gap-1"><Share2 className="w-3.5 h-3.5" /> WhatsApp Digest</a>
              <button onClick={handleExportPDF} className="px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-xs font-semibold inline-flex items-center gap-1"><FileDown className="w-3.5 h-3.5" /> GN 404 PDF</button>
            </div>
          </div>
          {role === "TREASURER" && (
            <div className="bg-[#131E32] p-4 rounded-lg border border-slate-800 space-y-3">
              <div className="font-semibold text-sm flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> Import Bank Statement (PDF / CSV / OFX)</div>
              <input type="file" accept=".pdf,.csv,.ofx,.zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) runLocalParse(f); e.target.value = ""; }} className="text-xs block w-full" />
              {isParsing && <div className="text-xs text-emerald-300">Parsing statement locally in your browser...</div>}
              {needPassword && pendingFile && (
                <div className="flex gap-2">
                  <input type="password" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="PDF Password (discarded locally)" className="flex-1 p-2 rounded bg-[#0A1120] border border-amber-500 text-xs" />
                  <button onClick={() => runLocalParse(pendingFile, pdfPassword)} className="px-3 py-2 rounded bg-amber-500 text-black text-xs font-bold">Unlock</button>
                </div>
              )}
              {previewResult && (
                <div className="p-3 rounded bg-[#0A1120] border border-slate-700 space-y-2">
                  <div className="text-xs text-emerald-400 font-semibold">{previewResult.bankCode} • {previewResult.transactions.length} rows extracted</div>
                  {previewResult.status === "CHECKSUM_ERROR" && <div className="text-xs text-amber-400">{previewResult.message}</div>}
                  <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-slate-300">
                    {previewResult.transactions.slice(0, 8).map((tx, i) => (
                      <div key={i} className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="truncate mr-2">{tx.tx_date} • {tx.raw_description}</span>
                        <span className={tx.direction === "CREDIT" ? "text-emerald-400" : "text-amber-400"}>{tx.direction === "CREDIT" ? "+" : "-"}{formatZAR(tx.amount_cents)}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={commitPreviewBatch} className="px-4 py-2 rounded bg-emerald-600 text-xs font-bold">Reconcile & Commit</button>
                </div>
              )}
              {(ledger.batches || []).filter((b: any) => b.status === "COMMITTED").slice(0, 2).map((b: any) => (
                <div key={b.id} className="flex justify-between text-xs text-slate-400">
                  <span>{b.bank_code} ({b.tx_inserted_count} new) • {b.created_at}</span>
                  <button onClick={() => handleUndoBatch(b.id)} className="text-amber-400 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Undo Import</button>
                </div>
              ))}
            </div>
          )}
          <div className="bg-[#131E32] p-4 rounded-lg border border-slate-800 space-y-2">
            <h3 className="font-semibold text-sm">Members & Proxy Lineage</h3>
            {(ledger.members || []).map((m: any) => {
              const owing = Math.max(0, ledger.group.contribution_cents - m.settled_cents);
              return (
                <div key={m.id} className="flex justify-between p-2.5 rounded bg-[#0A1120] border border-slate-800 text-xs">
                  <div><div className="font-semibold">{m.display_name}</div><div className="text-slate-400">{m.msisdn_norm}{m.successor_name ? ` • Successor: ${m.successor_name}` : ""}</div></div>
                  <div className="text-right">
                    <div className={owing === 0 ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{owing === 0 ? "Safe • Paid" : `Buffer Needed: ${formatZAR(owing)}`}</div>
                    {role === "TREASURER" && owing > 0 && <a href={buildNonPunitiveNudge(m.msisdn_norm, m.display_name, ledger.group.name, owing)} className="text-emerald-400 underline">Nudge</a>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-[#131E32] p-4 rounded-lg border border-slate-800 space-y-2">
            <h3 className="font-semibold text-sm">Transactions (Audit Provenance)</h3>
            {(ledger.transactions || []).map((t: any) => (
              <div key={t.id} className="p-2.5 rounded bg-[#0A1120] border border-slate-800 flex justify-between items-center gap-2 text-xs">
                <div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 ${t.source_tag === "BANK VERIFIED" ? "bg-emerald-900 text-emerald-300" : "bg-amber-900 text-amber-300"}`}>[{t.source_tag}]</span>
                  <span>{t.tx_date} • {t.raw_description}</span>
                  {t.payer_proxy_label && <div className="text-emerald-400 mt-0.5">{t.payer_proxy_label}</div>}
                  {role === "TREASURER" && !t.matched_member_id && t.direction === "CREDIT" && (
                    <select onChange={(e) => handleAssignMember(t.id, e.target.value, t.raw_description)} defaultValue="" className="mt-1 p-1 rounded bg-slate-800 text-[11px]">
                      <option value="" disabled>Link unmatched payer to member...</option>
                      {(ledger.members || []).map((m: any) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                    </select>
                  )}
                </div>
                <div className="font-bold whitespace-nowrap">{formatZAR(t.amount_cents)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="text-sm text-slate-400">Loading...</div>}
    </div>
  );
}
