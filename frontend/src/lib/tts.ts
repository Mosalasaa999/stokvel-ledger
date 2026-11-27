import type { SupportedLang } from "./i18n";

export interface BookReadoutPayload {
  memberName: string;
  groupName: string;
  potCents: number;
  stillNeededCents: number;
  payoutMonth: string;
  helperName?: string;
  beneficiaryName?: string;
}

export function formatRandForSpeech(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  const rText = `${rands.toLocaleString("en-ZA")} Rand`;
  return rem > 0 ? `${rText} and ${rem} cents` : rText;
}

function resolveBestVoice(preferred: SupportedLang): { voice: SpeechSynthesisVoice | null; effectiveLang: SupportedLang } {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { voice: null, effectiveLang: "en-ZA" };
  }
  const voices = window.speechSynthesis.getVoices();
  const prefix = preferred.split("-")[0].toLowerCase();
  const exact = voices.find((v) => v.lang.toLowerCase() === preferred.toLowerCase() && v.localService);
  if (exact) return { voice: exact, effectiveLang: preferred };
  const prefMatch = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (prefMatch) return { voice: prefMatch, effectiveLang: preferred };
  const en = voices.find((v) => v.lang.toLowerCase() === "en-za") ||
    voices.find((v) => v.lang.toLowerCase() === "en-gb") ||
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) || null;
  return { voice: en, effectiveLang: "en-ZA" };
}

function buildSentences(p: BookReadoutPayload, lang: SupportedLang): string[] {
  const pot = formatRandForSpeech(p.potCents);
  const need = formatRandForSpeech(p.stillNeededCents);
  if (lang === "zu-ZA") {
    return [
      `Sawubona ${p.memberName}. Le yincwadi ye-${p.groupName}.`,
      `Imali eseqenjini lethu manje ngu-${pot}.`,
      p.stillNeededCents === 0 ? "Ukhokhile kule nyanga." : `Okusasele kule nyanga ngu-${need}.`,
      `Inyanga yakho yokuhola ngu-${p.payoutMonth}.`,
      p.helperName ? `Okukhokhelayo ngu-${p.helperName}.` : "",
      p.beneficiaryName ? `Ozothatha imali yakho ngu-${p.beneficiaryName}.` : ""
    ].filter(Boolean);
  }
  return [
    `Hello ${p.memberName}. This is your ${p.groupName} stokvel book.`,
    `The total money in our group pot is ${pot}.`,
    p.stillNeededCents === 0 ? "You are paid up for this month." : `You still have ${need} left for this month.`,
    `Your payout month is ${p.payoutMonth}.`,
    p.helperName ? `The family member paying for you is ${p.helperName}.` : "",
    p.beneficiaryName ? `Your payout beneficiary is ${p.beneficiaryName}.` : ""
  ].filter(Boolean);
}

let activeRunId = 0;

export function stopStokvelSpeech() {
  activeRunId++;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakStokvelBook(payload: BookReadoutPayload, preferredLang: SupportedLang, onDone: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onDone();
    return;
  }
  const runId = ++activeRunId;
  window.speechSynthesis.cancel();

  setTimeout(() => {
    if (runId !== activeRunId) return;
    const { voice, effectiveLang } = resolveBestVoice(preferredLang);
    const clauses = buildSentences(payload, effectiveLang);
    let idx = 0;

    const speakNext = () => {
      if (runId !== activeRunId || idx >= clauses.length) {
        onDone();
        return;
      }
      const utt = new SpeechSynthesisUtterance(clauses[idx].slice(0, 110));
      if (voice) utt.voice = voice;
      utt.lang = effectiveLang;
      utt.rate = 0.85;
      utt.pitch = 1.0;
      utt.onend = () => {
        idx++;
        setTimeout(speakNext, 250);
      };
      utt.onerror = () => onDone();
      window.speechSynthesis.speak(utt);
    };
    speakNext();
  }, 60);
}