const ONES = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) {
    if (r < 20) parts.push(ONES[r]!);
    else parts.push(TENS[Math.floor(r / 10)]! + (r % 10 ? `-${ONES[r % 10]}` : ""));
  }
  return parts.join(" ");
}

export function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const chunks: string[] = [];
  let i = 0;
  while (n > 0) {
    const c = n % 1000;
    if (c) chunks.unshift(under1000(c) + (SCALES[i] ? ` ${SCALES[i]}` : ""));
    n = Math.floor(n / 1000);
    i++;
  }
  return chunks.join(" ");
}

/** e.g. 1234.5 -> "One Thousand Two Hundred Thirty-Four and 50/100 Dollars" */
export function amountToWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const cents = Math.round(amount * 100);
  const dollars = Math.floor(cents / 100);
  const c = cents % 100;
  return `${integerToWords(dollars)} and ${String(c).padStart(2, "0")}/100 Dollars`;
}

export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,\s()]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

export function formatUSD(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
