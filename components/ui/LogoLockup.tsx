// Brand logo artwork (the Carelon / BITS PNGs) is intentionally not bundled in this repo.
// These lockups render neutral text + monogram placeholders so the UI is never broken by
// missing files. To use the real branding, drop the PNGs into `public/assets/logos/`
// (carelon-global-solutions.png, bits-logo.png, carelon-icon-mark.png) and restore the
// <Image>-based version of this file from git history.

/** The wordmark's icon is 538px tall within 647px artwork; reused for clear-space padding. */
const ICON_RATIO = 538 / 647;
/** Clear space the wordmark needs on every side: the size of its own icon. */
export const carelonClearSpace = (height: number): number => Math.round(height * ICON_RATIO);

/** The Carelon Global Solutions wordmark (text placeholder), padded on all four sides. */
export function CarelonLogo({ height = 22 }: { height?: number }) {
  return (
    <div className="flex items-center shrink-0" style={{ padding: carelonClearSpace(height) }}>
      <span className="font-brand whitespace-nowrap" style={{ fontSize: height, lineHeight: 1, letterSpacing: "-0.01em" }}>
        <span className="font-semibold text-purple">Carelon</span>{" "}
        <span className="text-ink">Global Solutions</span>
      </span>
    </div>
  );
}

/** The BITS credit (text placeholder) for the "Powered by" line in the footer. */
export function BitsLogo({ height = 28 }: { height?: number }) {
  return (
    <span
      className="font-brand font-semibold text-muted"
      aria-label="BITS, Business Intelligence & Transformation Solutions"
      style={{ fontSize: Math.round(height * 0.5), lineHeight: 1, letterSpacing: "0.04em" }}
    >
      BITS
    </span>
  );
}

/** A neutral monogram mark (placeholder), used where the wordmark does not fit and on the nudge. */
export function CarelonMark({ size = 32, alt = "Carelon Global Solutions" }: { size?: number; alt?: string }) {
  return (
    <span
      role="img"
      aria-label={alt}
      className="inline-flex items-center justify-center shrink-0 bg-purple text-white font-brand font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52), borderRadius: Math.round(size * 0.28), lineHeight: 1 }}
    >
      C
    </span>
  );
}
