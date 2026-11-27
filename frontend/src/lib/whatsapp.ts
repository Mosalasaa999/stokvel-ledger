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

export function buildGroupWhatsAppDigest(groupName: string, shortCode: string, expectedBalanceCents: number, paidCount: number, totalMembers: number, slug: string): string {
  const url = `${window.location.origin}/?g=${slug}`;
  const lines = [
    `*${groupName} (${shortCode}) â€” Stokvel Book*`,
    `Total Money in Pot: *${formatZAR(expectedBalanceCents)}*`,
    `Paid This Month: *${paidCount} of ${totalMembers}* members`,
    ``,
    `Open our Stokvel Book:`,
    url
  ];
  return `https://wa.me/?text=${encodeURIComponent(lines.join("\n").slice(0, 950))}`;
}

export function buildMemberMagicLink(slug: string, msisdn: string): string {
  return `${window.location.origin}/?g=${slug}&m=${msisdn}`;
}

export function buildNonPunitiveNudge(msisdn: string, memberName: string, groupName: string, owingCents: number): string {
  const intl = msisdn.startsWith("0") ? `27${msisdn.slice(1)}` : msisdn;
  const text = `Hi ${memberName.split(" ")[0]}, friendly note from *${groupName}*: your book shows *${formatZAR(owingCents)}* still needed for this month. If someone else paid for you on PayShap, reply with their phone number so we can link them!`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}