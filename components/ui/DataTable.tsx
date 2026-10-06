import type { CSSProperties, Key, ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Extra classes for the header cell (e.g. a stage text color or a min width). */
  thClass?: string;
  /** Extra classes for body cells. */
  tdClass?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  rowStyle?: (row: T) => CSSProperties | undefined;
  /** Keep the header visible while the surrounding container scrolls. */
  stickyHeader?: boolean;
  /** Vertical cell padding in px. */
  padY?: number;
  /** Horizontal padding of inner cells in px. The first and last columns use 20px. */
  padX?: number;
  headPadY?: number;
  /** Shown under the header when there are no rows. */
  empty?: ReactNode;
}

/** The console table: grey Inter header, row dividers, 14px body. */
export function DataTable<T>({ columns, rows, rowKey, rowStyle, stickyHeader = false, padY = 10, padX = 14, headPadY = 10, empty }: Props<T>) {
  const last = columns.length - 1;
  const pad = (i: number, y: number): CSSProperties => ({ padding: `${y}px ${i === 0 || i === last ? 20 : padX}px` });
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={stickyHeader ? undefined : "bg-page"}>
            {columns.map((c, i) => (
              <th
                key={c.key} scope="col"
                className={`font-ui text-xs font-semibold text-muted ${c.align === "right" ? "text-right" : "text-left"} ${stickyHeader ? "sticky top-0 z-[1] bg-page" : ""} ${c.thClass ?? ""}`}
                style={pad(i, headPadY)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={rowKey(r)} className="border-b border-row" style={rowStyle?.(r)}>
              {columns.map((c, i) => (
                <td key={c.key} className={`${c.align === "right" ? "text-right" : ""} ${c.tdClass ?? ""}`} style={pad(i, padY)}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty ? <div className="px-5 py-8 text-center text-muted">{empty}</div> : null}
    </>
  );
}
