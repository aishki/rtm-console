/** One page of a list: which rows it shows and how to describe them. */
export interface PageSlice { page: number; pages: number; from: number; to: number }

/**
 * Page `page` (from 1) of `total` rows, `size` per page. A page past the end clamps to the last,
 * so a list that shrinks under the viewer never shows an empty page. `from` and `to` are
 * 0-based, end exclusive, as `slice` takes them.
 */
export function pageSlice(total: number, page: number, size: number): PageSlice {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page)), pages);
  const from = (p - 1) * size;
  return { page: p, pages, from, to: Math.min(total, from + size) };
}

/** "1–50 of 1,234", or "0 of 0" for an empty list. */
export function pageLabel(total: number, { from, to }: PageSlice): string {
  const n = (x: number) => x.toLocaleString("en-US");
  return total ? `${n(from + 1)}–${n(to)} of ${n(total)}` : "0 of 0";
}
