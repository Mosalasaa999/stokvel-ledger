import React, { useState } from "react";
import { Delete } from "lucide-react";

interface Props {
  apiUrl: string;
  initialSlug: string;
  initialMsisdn: string;
  onUnlock: (res: { slug: string; shortCode: string; msisdn: string; memberId: string; token: string; role: "TREASURER" | "MEMBER"; remember: boolean }) => void;
  onOpenCreate: () => void;
}

export function PinPadLogin({ apiUrl, initialSlug, initialMsisdn, onUnlock, onOpenCreate }: Props) {
  const [groupCode, setGroupCode] = useState(initialSlug);
  const [resolvedSlug, setResolvedSlug] = useState(initialSlug);
  const [groupLabel, setGroupLabel] = useState("");
  const [msisdn, setMsisdn] = useState(initialMsisdn);
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"MEMBER" | "TREASURER">("MEMBER");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolveGroupIfNeeded(): Promise<string | null> {
    const clean = groupCode.trim();
    if (!clean) { setErr("Please enter your 6-letter Stokvel Code."); return null; }
    if (resolvedSlug && clean === resolvedSlug) return resolvedSlug;
    const res = await fetch(`${apiUrl}/v1/groups/code/${encodeURIComponent(clean)}`);
    if (!res.ok) { setErr("We could not find that Stokvel Code."); return null; }
    const d = await res.json();
    setResolvedSlug(d.slug);
    setGroupLabel(d.name);
    return d.slug;
  }

  function pressDigit(d: string) {
    if (navigator.vibrate) navigator.vibrate(15);
    if (pin.length < 6) setPin((p) => p + d);
  }

  async function handleSubmit() {
    setErr("");
    if (pin.length < 4) { setErr("Tap your 4-digit PIN."); return; }
    if (role === "MEMBER" && msisdn.trim().length < 9) { setErr("Enter your cellphone number."); return; }
    setBusy(true);
    try {
      const slugToUse = await resolveGroupIfNeeded();
      if (!slugToUse) { setBusy(false); return; }
      const res = await fetch(`${apiUrl}/v1/groups/${slugToUse}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msisdn, pin, role })
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Could not open book."); setPin(""); setBusy(false); return; }
      onUnlock({
        slug: slugToUse, shortCode: groupCode, msisdn,
        memberId: data.member_id || "", token: data.token, role: data.role, remember
      });
    } catch {
      setErr("Still waking up the book. Please tap Open Book again in 5 seconds.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-ink-primary">
          {groupLabel ? groupLabel : "Open Your Stokvel Book"}
        </h2>
        <p className="text-base text-ink-secondary">
          {role === "MEMBER" ? "Enter your cellphone and 4-digit PIN." : "Treasurer Office Login"}
        </p>
      </div>

      {err && <div className="p-3 rounded-lg bg-stokvel-alertBg border border-stokvel-alert text-stokvel-alert text-base font-semibold">{err}</div>}

      {!initialSlug && (
        <div>
          <label className="block text-base font-semibold text-ink-primary mb-1">Stokvel Code (e.g. MOSA-1F)</label>
          <input
            value={groupCode}
            onChange={(e) => { setGroupCode(e.target.value.toUpperCase()); setResolvedSlug(""); }}
            placeholder="MOSA-1F"
            className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg font-bold uppercase"
          />
        </div>
      )}

      {role === "MEMBER" && (
        <div>
          <label className="block text-base font-semibold text-ink-primary mb-1">Your Cellphone Number</label>
          <input
            type="tel"
            inputMode="tel"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            placeholder="071 509 9424"
            className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg font-semibold"
          />
        </div>
      )}

      <div>
        <div className="text-base font-semibold text-ink-primary mb-2 text-center">Your Secret PIN</div>
        <div className="flex justify-center gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? "bg-stokvel-green border-stokvel-green" : "border-ink-muted bg-paper-canvas"}`} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
          {["1","2","3","4","5","6","7","8","9"].map((d) => (
            <button key={d} type="button" onClick={() => pressDigit(d)} className="min-h-[64px] rounded-xl bg-paper-subtle border-2 border-paper-ruled text-xl font-bold text-ink-primary active:bg-stokvel-greenBg">
              {d}
            </button>
          ))}
          <button type="button" onClick={() => setPin("")} className="min-h-[64px] rounded-xl bg-paper-subtle border-2 border-paper-ruled text-base font-bold text-ink-secondary">
            Clear
          </button>
          <button type="button" onClick={() => pressDigit("0")} className="min-h-[64px] rounded-xl bg-paper-subtle border-2 border-paper-ruled text-xl font-bold text-ink-primary active:bg-stokvel-greenBg">
            0
          </button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Backspace" className="min-h-[64px] rounded-xl bg-paper-subtle border-2 border-paper-ruled flex items-center justify-center text-ink-primary">
            <Delete className="w-6 h-6" />
          </button>
        </div>
      </div>

      <label className="flex items-center gap-3 min-h-[56px] p-3 rounded-lg bg-paper-subtle border border-paper-ruled cursor-pointer">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-6 h-6 accent-[#0F6B3A]" />
        <span className="text-base font-semibold text-ink-primary">Keep me signed in on this phone</span>
      </label>

      <button type="button" disabled={busy} onClick={handleSubmit} className="w-full min-h-[64px] rounded-xl bg-stokvel-green text-white text-lg font-bold">
        {busy ? "Opening Book..." : "Open My Stokvel Book"}
      </button>

      <div className="pt-2 border-t border-paper-ruled flex flex-col gap-3">
        <button type="button" onClick={() => { setRole(role === "MEMBER" ? "TREASURER" : "MEMBER"); setPin(""); setErr(""); }} className="min-h-[56px] w-full rounded-lg border-2 border-paper-ruled text-base font-semibold text-ink-secondary">
          {role === "MEMBER" ? "I am the Treasurer (Admin)" : "Back to Member View"}
        </button>
        <button type="button" onClick={onOpenCreate} className="min-h-[56px] w-full rounded-lg bg-paper-subtle text-base font-bold text-stokvel-green">
          + Start a Brand-New Stokvel Book
        </button>
      </div>
    </div>
  );
}