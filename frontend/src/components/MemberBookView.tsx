import React, { useState } from "react";
import { Volume2, Square, Share2, CheckCircle2, Clock } from "lucide-react";
import { DICT, LANG_LABELS, SupportedLang } from "../lib/i18n";
import { speakStokvelBook, stopStokvelSpeech } from "../lib/tts";
import { buildGroupWhatsAppDigest, formatZAR } from "../lib/whatsapp";

interface Props {
  ledger: any;
  memberId: string;
  lang: SupportedLang;
  onChangeLang: (l: SupportedLang) => void;
  onSwitchPerson: () => void;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function MemberBookView({ ledger, memberId, lang, onChangeLang, onSwitchPerson }: Props) {
  const t = DICT[lang];
  const [speaking, setSpeaking] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [showBankDetails, setShowBankDetails] = useState(false);

  const members: any[] = ledger.members || [];
  const me = members.find((m) => m.id === memberId) || members[0];
  const myOwing = me ? Math.max(0, ledger.group.contribution_cents - me.settled_cents) : 0;
  const payoutMonth = me?.rotation_slot ? `${MONTHS[(me.rotation_slot - 1) % 12]} ${ledger.group.cycle_year}` : `December ${ledger.group.cycle_year}`;
  const paidCount = members.filter((m) => m.settled_cents >= ledger.group.contribution_cents).length;

  const myTxs = (ledger.transactions || []).filter((tx: any) => me && tx.matched_member_id === me.id);
  const visibleTxs = showAllPayments ? myTxs : myTxs.slice(0, 3);

  function toggleSpeech() {
    if (speaking) {
      stopStokvelSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speakStokvelBook({
      memberName: me?.display_name || "Member",
      groupName: ledger.group.name,
      potCents: ledger.cash_tie.expected_balance_cents,
      stillNeededCents: myOwing,
      payoutMonth,
      helperName: me?.proxy_aliases?.[0] || "",
      beneficiaryName: me?.successor_name || ""
    }, lang, () => setSpeaking(false));
  }

  return (
    <div className="space-y-5">
      {/* Book Top Bar + Language Pills */}
      <div className="bg-paper-card border border-paper-ruled rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink-primary">{ledger.group.name}</h2>
            <p className="text-base text-ink-secondary">{t.subtitle} â€¢ Code: <b>{ledger.group.short_code}</b></p>
          </div>
          <button onClick={() => { stopStokvelSpeech(); onSwitchPerson(); }} className="min-h-[56px] px-4 rounded-xl border-2 border-paper-ruled text-base font-bold text-ink-primary">
            {t.switchPerson}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LANG_LABELS) as SupportedLang[]).map((code) => (
            <button key={code} onClick={() => onChangeLang(code)} className={`min-h-[48px] px-3.5 rounded-full text-base font-bold border-2 ${lang === code ? "bg-stokvel-green text-white border-stokvel-green" : "bg-paper-subtle text-ink-primary border-paper-ruled"}`}>
              {LANG_LABELS[code]}
            </button>
          ))}
        </div>
      </div>

      {/* QUESTION 1: How Much Is In Our Pot? */}
      <div className="bg-paper-card border-2 border-stokvel-green rounded-xl p-5 space-y-4">
        <div className="text-base font-bold tracking-wide text-stokvel-green">{t.potEyebrow}</div>
        <div className="text-pot font-extrabold text-ink-primary tabular-nums">{formatZAR(ledger.cash_tie.expected_balance_cents)}</div>
        <div className="text-base text-ink-secondary font-semibold">
          {paidCount} of {members.length} members paid up
        </div>
        <button type="button" onClick={() => setShowBankDetails(!showBankDetails)} className="min-h-[48px] text-base font-bold text-stokvel-green underline">
          {showBankDetails ? "Hide Bank Details" : "Show Bank Details"}
        </button>
        {showBankDetails && (
          <div className="p-3 rounded-lg bg-paper-subtle text-base text-ink-primary tabular-nums">
            {t.paidInLabel}: {formatZAR(ledger.cash_tie.member_credits_cents)} â€¢ {t.chargesLabel}: {formatZAR(ledger.cash_tie.bank_fees_cents)}
          </div>
        )}
        <button type="button" onClick={toggleSpeech} className="w-full min-h-[64px] rounded-xl bg-stokvel-green text-white text-lg font-bold flex items-center justify-center gap-3">
          {speaking ? <Square className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          {speaking ? t.stopBtn : t.listenBtn}
        </button>
        <a href={buildGroupWhatsAppDigest(ledger.group.name, ledger.group.short_code, ledger.cash_tie.expected_balance_cents, paidCount, members.length, ledger.group.slug)} className="w-full min-h-[56px] rounded-xl border-2 border-stokvel-green text-stokvel-green text-base font-bold flex items-center justify-center gap-2">
          <Share2 className="w-5 h-5" /> {t.shareBtn}
        </a>
      </div>

      {/* QUESTION 2: Did My Money Arrive & When Is My Payout? */}
      {me && (
        <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-4">
          <div className="text-lg font-bold text-ink-primary">{t.myRecord}: {me.display_name}</div>
          {myOwing === 0 ? (
            <div className="p-4 rounded-xl bg-stokvel-greenBg border-2 border-stokvel-green text-stokvel-green flex items-center gap-3 text-lg font-bold">
              <CheckCircle2 className="w-7 h-7 shrink-0" /> {t.paidUp}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-stokvel-amberBg border-2 border-stokvel-amber text-stokvel-amber flex items-center gap-3 text-lg font-bold tabular-nums">
              <Clock className="w-7 h-7 shrink-0" /> {formatZAR(myOwing)} {t.stillNeeded}
            </div>
          )}
          <div className="p-4 rounded-lg bg-paper-subtle text-base font-semibold text-ink-primary">
            {t.payoutMonth}: <span className="font-bold">{payoutMonth}</span>
          </div>
          {visibleTxs.length > 0 && (
            <div className="space-y-2">
              <div className="text-base font-bold text-ink-secondary">{t.recentPayments}</div>
              {visibleTxs.map((tx: any) => (
                <div key={tx.id} className="p-3 rounded-lg bg-paper-canvas border border-paper-ruled flex justify-between items-center gap-2">
                  <div>
                    <div className="text-base font-bold text-ink-primary">{tx.tx_date}</div>
                    <div className="text-base text-stokvel-green font-semibold">
                      {tx.source_tag === "BANK VERIFIED" ? t.bankTag : t.cashTag}
                    </div>
                  </div>
                  <div className="text-lg font-bold tabular-nums">{formatZAR(tx.amount_cents)}</div>
                </div>
              ))}
              {myTxs.length > 3 && (
                <button type="button" onClick={() => setShowAllPayments(!showAllPayments)} className="min-h-[48px] text-base font-bold text-stokvel-green underline">
                  {showAllPayments ? "Show Less" : "See All My Payments"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* QUESTION 3: Who Pays For Me & Who Collects My Payout? */}
      {me && (
        <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-3">
          <div className="text-lg font-bold text-ink-primary">{t.helperTitle}</div>
          <div className="p-3 rounded-lg bg-paper-subtle text-base">
            <div className="text-ink-secondary font-semibold">{t.helperLabel}:</div>
            <div className="font-bold text-ink-primary">{me.proxy_aliases?.length ? me.proxy_aliases.join(", ") : `${me.display_name} (${me.msisdn_norm})`}</div>
          </div>
          <div className="p-3 rounded-lg bg-paper-subtle text-base">
            <div className="text-ink-secondary font-semibold">{t.beneficiaryLabel}:</div>
            <div className="font-bold text-ink-primary">{me.successor_name ? `${me.successor_name} (${me.successor_msisdn})` : me.display_name}</div>
          </div>
        </div>
      )}

      {/* Calm Exercise-Book Group List */}
      <div className="bg-paper-card border border-paper-ruled rounded-xl p-5 space-y-3">
        <div className="text-lg font-bold text-ink-primary">{t.groupBook}</div>
        <div className="divide-y divide-paper-ruled">
          {members.map((m) => {
            const paid = m.settled_cents >= ledger.group.contribution_cents;
            return (
              <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                <span className="text-base font-bold text-ink-primary">{m.display_name}</span>
                <span className={`px-3 py-1 rounded-full text-base font-bold ${paid ? "bg-stokvel-greenBg text-stokvel-green" : "bg-stokvel-amberBg text-stokvel-amber"}`}>
                  {paid ? `âœ“ ${t.paidUp.split(" ")[0]}` : `â³ ${t.waiting}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}