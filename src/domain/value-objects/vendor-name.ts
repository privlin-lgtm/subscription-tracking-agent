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
