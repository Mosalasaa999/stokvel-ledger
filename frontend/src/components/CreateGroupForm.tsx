import React, { useState } from "react";

interface Props {
  apiUrl: string;
  onCreated: (slug: string, token: string) => void;
}

export function CreateGroupForm({ apiUrl, onCreated }: Props) {
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("SAVINGS_DEC");
  const [monthlyRands, setMonthlyRands] = useState("500");
  const [dueDay, setDueDay] = useState("5");
  const [treasurerPin, setTreasurerPin] = useState("");
  const [consent, setConsent] = useState(false);
  const [membersText, setMembersText] = useState("Gogo Mokoena, 0715099424, 1234, Thabo Mokoena, 0715099424");
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const initial_members = membersText.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const [display_name = "", msisdn = "", pin = "0000", successor_name = "", alias = ""] = line.split(",").map((s) => s.trim());
      return {
        display_name, msisdn, pin, successor_name,
        successor_msisdn: alias || msisdn,
        proxy_aliases: alias ? [alias] : []
      };
    });
    const res = await fetch(`${apiUrl}/v1/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, archetype,
        contribution_cents: Math.round(parseFloat(monthlyRands || "0") * 100),
        due_day_of_month: parseInt(dueDay || "5", 10),
        grace_days: 3, late_fine_cents: 0, cycle_year: new Date().getFullYear(),
        treasurer_pin: treasurerPin, eu_popia_consent: consent, initial_members
      })
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Could not create group"); return; }
    onCreated(data.slug, data.token);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#131E32] p-5 rounded-lg border border-slate-800 space-y-3 text-sm">
      <h2 className="font-semibold text-base text-emerald-400">Create New Stokvel Vault</h2>
      {err && <div className="p-2 rounded bg-amber-950 text-amber-300 text-xs">{err}</div>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stokvel Name (e.g. Alex Gogo Society)" className="w-full p-2.5 rounded bg-[#0A1120] border border-slate-700" required />
      <div className="grid grid-cols-3 gap-2">
        <select value={archetype} onChange={(e) => setArchetype(e.target.value)} className="p-2.5 rounded bg-[#0A1120] border border-slate-700 text-xs">
          <option value="SAVINGS_DEC">Dec Lump-Sum</option>
          <option value="ROSCA">Rotational</option>
          <option value="BURIAL">Burial Society</option>
          <option value="INVESTMENT">Investment</option>
        </select>
        <input type="number" value={monthlyRands} onChange={(e) => setMonthlyRands(e.target.value)} placeholder="R / month" className="p-2.5 rounded bg-[#0A1120] border border-slate-700 text-xs" required />
        <input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="Due day" className="p-2.5 rounded bg-[#0A1120] border border-slate-700 text-xs" required />
      </div>
      <input type="password" inputMode="numeric" value={treasurerPin} onChange={(e) => setTreasurerPin(e.target.value)} placeholder="Treasurer PIN (4-6 digits)" className="w-full p-2.5 rounded bg-[#0A1120] border border-slate-700" required />
      <div>
        <label className="text-xs text-slate-400 block mb-1">Members (1 per line: Name, Phone, PIN, Successor, Proxy Keyword)</label>
        <textarea rows={4} value={membersText} onChange={(e) => setMembersText(e.target.value)} className="w-full p-2 rounded bg-[#0A1120] border border-slate-700 text-xs font-mono" />
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>I consent to EU-region hosting (POPIA Sec 72). No SA IDs or raw statements leave this browser.</span>
      </label>
      <button type="submit" className="w-full py-2.5 rounded bg-emerald-600 font-semibold">Launch Stokvel Ledger</button>
    </form>
  );
}
