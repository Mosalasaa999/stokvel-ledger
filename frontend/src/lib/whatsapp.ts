export function formatZAR(cents: number): string {
  return "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isAndroidWhatsAppWebView(): boolean {
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua) && (/WhatsApp/i.test(ua) || /\bwv\b/i.test(ua));
}

export function chromeIntentUrl(): string {
  return `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

export function buildGroupWhatsAppDigest(groupName: string, expectedBalanceCents: number, paidCount: number, totalMembers: number, slug: string): string {
  const url = `${window.location.origin}/?g=${slug}`;
  const lines = [
    `*${groupName} — Ledger Update*`,
    `Pool Balance: *${formatZAR(expectedBalanceCents)}*`,
    `Settled: *${paidCount} of ${totalMembers}* members`,
    ``,
    `Inspect [BANK VERIFIED] rows with your PIN:`,
    url
  ];
  return `https://wa.me/?text=${encodeURIComponent(lines.join("\n").slice(0, 1000))}`;
}

export function buildNonPunitiveNudge(msisdn: string, memberName: string, groupName: string, owingCents: number): string {
  const intl = msisdn.startsWith("0") ? `27${msisdn.slice(1)}` : msisdn;
  const text = `Hi ${memberName.split(" ")[0]}, friendly update from *${groupName}*: your current balance shows *${formatZAR(owingCents)}* remaining to keep your December payout target intact. Reply if you paid via a relative's PayShap so we can link the proxy alias!`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
