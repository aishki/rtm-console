const pad = (n: number) => String(n).padStart(2, "0");

/** Seconds as m:ss. */
export const fmt = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** Seconds since midnight as hh:mm:ss. */
export const clock = (t: number): string =>
  `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;

/** Splits "Last, First - AH12345" into the name and the domain ID. The last " - " separates them: a surname can hold one too. */
export const splitAgent = (name: string): { who: string; id: string } => {
  const cut = name.lastIndexOf(" - ");
  return cut < 0 ? { who: name, id: "" } : { who: name.slice(0, cut), id: name.slice(cut + 3) };
};
