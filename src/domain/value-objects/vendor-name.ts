export function normalizeVendorKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCaseVendor(raw: string): string {
  return raw
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * The name shown for a vendor that is not in the catalogue: what the user typed or the email
 * said, with its casing kept.
 *
 * 1. Trim, collapse runs of whitespace to one space, and drop a leading "http(s)://" / "www.".
 * 2. A name with both upper- and lower-case letters ("XPlace", "Apple TV", "iHerb") is kept as
 *    written.
 * 3. A name with no cased letters, or with any non-ASCII letter (Hebrew, accents), is kept as
 *    written: title-casing goes through `normalizeVendorKey`, which would drop those letters.
 * 4. Only a name written entirely in lower case or entirely in upper case ("netflix",
 *    "NETFLIX.COM") is title-cased, the way every name used to be ("Netflix", "Netflix Com").
 *
 * Known limit of rule 4: a bare acronym typed in capitals ("HBO") still becomes "Hbo", because
 * it cannot be told apart from a shouting email sender.
 */
export function vendorDisplayName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
  if (!cleaned) {
    return raw.trim().replace(/\s+/g, " ");
  }
  const hasUpper = cleaned !== cleaned.toLowerCase();
  const hasLower = cleaned !== cleaned.toUpperCase();
  const singleCase = hasUpper !== hasLower;
  if (!singleCase || /[^\x00-\x7F]/.test(cleaned)) {
    return cleaned;
  }
  return titleCaseVendor(normalizeVendorKey(cleaned) || cleaned);
}

/**
 * Key for deciding whether two vendor names are the same vendor. Ignores case, punctuation
 * and spacing, so "XPlace", "Xplace" and "XPLACE." never become separate subscriptions just
 * because of how they were written. For plain ASCII names it equals `normalizeVendorKey`;
 * unlike that function it keeps non-Latin letters, so two different Hebrew names stay apart.
 */
export function vendorMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function diceCoefficient(a: string, b: string): number {
  const left = normalizeVendorKey(a);
  const right = normalizeVendorKey(b);
  if (left === right) {
    return 1;
  }
  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const pairs = (value: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const pair = value.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return counts;
  };

  const aPairs = pairs(left);
  const bPairs = pairs(right);
  let intersection = 0;
  for (const [pair, count] of aPairs) {
    const other = bPairs.get(pair);
    if (other) {
      intersection += Math.min(count, other);
    }
  }
  const total = [...aPairs.values()].reduce((s, n) => s + n, 0) + [...bPairs.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}
