import React, { useEffect, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { useLedgerStore } from "./store/useLedgerStore";
import { PinPadLogin } from "./components/PinPadLogin";
import { CreateGroupForm } from "./components/CreateGroupForm";
import { MemberBookView } from "./components/MemberBookView";
import { TreasurerDeskView } from "./components/TreasurerDeskView";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

export default function App() {
  const { slug, msisdn, memberId, token, role, lang, expiresAt, cachedLedger, setSession, setLang, setCachedLedger, logout } = useLedgerStore();
  const [ledger, setLedger] = useState<any>(cachedLedger);
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const urlSlug = params.get("g") || window.location.pathname.match(/^\/g\/([^/]+)/)?.[1] || slug || "";
  const urlPhone = params.get("m") || msisdn || "";

  useEffect(() => {
    fetch(`${API_URL}/healthz`).catch(() => {});
  }, []);

  useEffect(() => {
    if (expiresAt && Date.now() > expiresAt) {
      logout();
      return;
    }
    if (token && slug) refreshLedger();
  }, [token, slug]);

  async function refreshLedger() {
    if (!token || !slug) return;
    try {
      const res = await fetch(`${API_URL}/v1/groups/${slug}/ledger`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        setLedger(d);
        setCachedLedger(d);
      }
    } catch {}
  }

  return (
    <div className="min-h-screen bg-paper-canvas text-ink-primary px-4 py-5 max-w-2xl mx-auto">
      <header className="mb-5 flex items-center gap-3">
        <BookOpenCheck className="w-8 h-8 text-stokvel-green shrink-0" />
        <h1 className="text-xl font-extrabold text-ink-primary">Our Stokvel Book</h1>
      </header>

      {!token ? (
        creating ? (
          <CreateGroupForm
            apiUrl={API_URL}
            onCreated={(r) => {
              setCreating(false);
              setSession({ slug: r.slug, shortCode: r.shortCode, token: r.token, role: "TREASURER", remember: true });
            }}
            onBack={() => setCreating(false)}
          />
        ) : (
          <PinPadLogin
            apiUrl={API_URL}
            initialSlug={urlSlug}
            initialMsisdn={urlPhone}
            onUnlock={(r) => setSession(r)}
            onOpenCreate={() => setCreating(true)}
          />
        )
      ) : !ledger ? (
        <div className="bg-paper-card border border-paper-ruled rounded-xl p-6 text-lg font-semibold text-ink-secondary">
          Opening your stokvel book...
        </div>
      ) : role === "TREASURER" ? (
        <TreasurerDeskView
          apiUrl={API_URL}
          slug={slug}
          token={token}
          ledger={ledger}
          onRefresh={refreshLedger}
          onLogout={logout}
        />
      ) : (
        <MemberBookView
          ledger={ledger}
          memberId={memberId || ledger.member_id || ""}
          lang={lang}
          onChangeLang={setLang}
          onSwitchPerson={logout}
        />
      )}
    </div>
  );
}