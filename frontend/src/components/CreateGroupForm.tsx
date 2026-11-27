import React, { useState } from "react";

interface MemberDraft {
  display_name: string;
  msisdn: string;
  pin: string;
  hasHelper: boolean;
  helper_phone: string;
  hasBeneficiary: boolean;
  successor_name: string;
  successor_msisdn: string;
}

interface Props {
  apiUrl: string;
  onCreated: (res: { slug: string; shortCode: string; token: string }) => void;
  onBack: () => void;
}

const ARCHETYPES = [
  { id: "SAVINGS_DEC", label: "December Payout Pool", desc: "Save monthly, share in December" },
  { id: "ROSCA", label: "Monthly Turn (Rotational)", desc: "One member takes the pot each month" },
  { id: "BURIAL", label: "Burial Society", desc: "Family funeral cover & support" }
];

function randomPin(): string {
  const nums = ["2481", "3917", "4829", "5731", "6194", "7382", "8459", "9163"];
  return nums[Math.floor(Math.random() * nums.length)];
}

export function CreateGroupForm({ apiUrl, onCreated, onBack }: Props) {
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("SAVINGS_DEC");
  const [monthlyRands, setMonthlyRands] = useState("500");
  const [dueDay, setDueDay] = useState("5");
  const [treasurerPin, setTreasurerPin] = useState("");
  const [consent, setConsent] = useState(false);
  const [members, setMembers] = useState<MemberDraft[]>([
    { display_name: "", msisdn: "", pin: randomPin(), hasHelper: false, helper_phone: "", hasBeneficiary: false, successor_name: "", successor_msisdn: "" }
  ]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function updateMember(idx: number, patch: Partial<MemberDraft>) {
    setMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const initial_members = members.filter((m) => m.display_name.trim() && m.msisdn.trim()).map((m, i) => ({
        display_name: m.display_name.trim(),
        msisdn: m.msisdn.trim(),
        pin: m.pin || "1954",
        rotation_slot: i + 1,
        successor_name: m.hasBeneficiary ? m.successor_name.trim() : "",
        successor_msisdn: m.hasBeneficiary ? m.successor_msisdn.trim() : "",
        proxy_aliases: m.hasHelper && m.helper_phone.trim() ? [m.helper_phone.trim()] : []
      }));

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
      if (!res.ok) { setErr(data.error || "Could not create stokvel book."); setBusy(false); return; }
      onCreated({ slug: data.slug, shortCode: data.short_code, token: data.token });
    } catch {
      setErr("Book server is waking up. Tap Save again in 10 seconds.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink-primary">Start a Stokvel Book</h2>
        <button type="button" onClick={onBack} className="min-h-[56px] px-4 rounded-lg border-2 border-paper-ruled text-base font-semibold">Back</button>
      </div>
      {err && <div className="p-3 rounded-lg bg-stokvel-alertBg text-stokvel-alert text-base font-semibold">{err}</div>}

      <div>
        <label className="block text-base font-semibold mb-1">Stokvel Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Gogo Society" className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg" required />
      </div>

      <div className="space-y-3">
        <div className="text-base font-semibold">Type of Stokvel</div>
        {ARCHETYPES.map((a) => (
          <button key={a.id} type="button" onClick={() => setArchetype(a.id)} className={`w-full min-h-[56px] p-4 rounded-xl border-2 text-left ${archetype === a.id ? "border-stokvel-green bg-stokvel-greenBg" : "border-paper-ruled bg-paper-canvas"}`}>
            <div className="text-base font-bold text-ink-primary">{a.label}</div>
            <div className="text-base text-ink-secondary">{a.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-base font-semibold mb-1">Monthly Amount (R)</label>
          <input type="number" value={monthlyRands} onChange={(e) => setMonthlyRands(e.target.value)} className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg font-bold" required />
        </div>
        <div>
          <label className="block text-base font-semibold mb-1">Due Day of Month</label>
          <input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg font-bold" required />
        </div>
      </div>

      <div>
        <label className="block text-base font-semibold mb-1">Your Treasurer Secret PIN (4â€“6 digits)</label>
        <input type="password" inputMode="numeric" value={treasurerPin} onChange={(e) => setTreasurerPin(e.target.value)} placeholder="e.g. 2580" className="w-full min-h-[56px] px-4 rounded-lg bg-paper-canvas border-2 border-paper-ruled text-lg" required />
      </div>

      <div className="space-y-3">
        <div className="text-base font-bold">Members & Family Helpers</div>
        {members.map((m, idx) => (
          <div key={idx} className="p-4 rounded-xl bg-paper-subtle border border-paper-ruled space-y-3">
            <div className="font-bold text-base">Member #{idx + 1} (Member PIN: {m.pin})</div>
            <input value={m.display_name} onChange={(e) => updateMember(idx, { display_name: e.target.value })} placeholder="Full Name (e.g. Gogo Mokoena)" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" required />
            <input type="tel" inputMode="tel" value={m.msisdn} onChange={(e) => updateMember(idx, { msisdn: e.target.value })} placeholder="Cellphone (e.g. 071 509 9424)" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" required />

            <label className="flex items-center gap-3 min-h-[56px] cursor-pointer">
              <input type="checkbox" checked={m.hasHelper} onChange={(e) => updateMember(idx, { hasHelper: e.target.checked })} className="w-6 h-6 accent-[#0F6B3A]" />
              <span className="text-base font-semibold">Someone else pays for this member</span>
            </label>
            {m.hasHelper && (
              <input type="tel" inputMode="tel" value={m.helper_phone} onChange={(e) => updateMember(idx, { helper_phone: e.target.value })} placeholder="Helper's Phone or Surname on Bank" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" />
            )}

            <label className="flex items-center gap-3 min-h-[56px] cursor-pointer">
              <input type="checkbox" checked={m.hasBeneficiary} onChange={(e) => updateMember(idx, { hasBeneficiary: e.target.checked })} className="w-6 h-6 accent-[#0F6B3A]" />
              <span className="text-base font-semibold">Nominate a family beneficiary for payout</span>
            </label>
            {m.hasBeneficiary && (
              <div className="space-y-2">
                <input value={m.successor_name} onChange={(e) => updateMember(idx, { successor_name: e.target.value })} placeholder="Beneficiary Name (e.g. Thabo Mokoena)" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" />
                <input type="tel" inputMode="tel" value={m.successor_msisdn} onChange={(e) => updateMember(idx, { successor_msisdn: e.target.value })} placeholder="Beneficiary Cellphone" className="w-full min-h-[56px] px-3 rounded-lg bg-paper-card border border-paper-ruled text-base" />
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setMembers([...members, { display_name: "", msisdn: "", pin: randomPin(), hasHelper: false, helper_phone: "", hasBeneficiary: false, successor_name: "", successor_msisdn: "" }])} className="w-full min-h-[56px] rounded-xl border-2 border-dashed border-stokvel-green text-stokvel-green font-bold text-base">
          + Add Another Member
        </button>
      </div>

      <label className="flex items-start gap-3 min-h-[56px] p-3 rounded-lg bg-paper-subtle cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="w-6 h-6 mt-1 accent-[#0F6B3A]" />
        <span className="text-base text-ink-primary">Privacy Promise: Your bank statement stays on this phone. Only member names, phone numbers, and stokvel amounts are saved safely in the EU.</span>
      </label>

      <button type="submit" disabled={busy} className="w-full min-h-[64px] rounded-xl bg-stokvel-green text-white text-lg font-bold">
        {busy ? "Creating Book..." : "Save & Open Stokvel Book"}
      </button>
    </form>
  );
}