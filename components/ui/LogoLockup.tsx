/* eslint-disable @next/next/no-img-element */
// Brand logos live in public/assets/logos/ (the Carelon / BITS brand set).
// Rendered with a plain <img> so local SVGs work without next/image's
// dangerouslyAllowSVG. Files: carelon-global-solutions.svg, carelon-icon-mark.svg,
// bits-logo.png. Swap those files to rebrand; no code change needed.

const BASE = "/assets/logos";

/** The wordmark's icon is 538px tall within 647px artwork; reused for clear-space padding. */
const ICON_RATIO = 538 / 647;
/** Clear space the wordmark needs on every side: the size of its own icon. */
export const carelonClearSpace = (height: number): number => Math.round(height * ICON_RATIO);

/** The Carelon Global Solutions wordmark, padded on all four sides by the size of its icon. */
export function CarelonLogo({ height = 22 }: { height?: number }) {
  return (
    <div className="flex items-center shrink-0" style={{ padding: carelonClearSpace(height) }}>
      <img
        src={`${BASE}/carelon-global-solutions.svg`}
        alt="Carelon Global Solutions"
        className="w-auto shrink-0 object-contain"
        style={{ height }}
      />
    </div>
  );
}

/** The BITS mark, for the "Powered by" credit in the footer. */
export function BitsLogo({ height = 28 }: { height?: number }) {
  return (
    <img
      src={`${BASE}/bits-logo.png`}
      alt="BITS, Business Intelligence & Transformation Solutions"
      className="w-auto shrink-0 object-contain"
      style={{ height }}
    />
  );
}

/** The Carelon icon mark, used where the wordmark does not fit and on the nudge. */
export function CarelonMark({ size = 32, alt = "Carelon Global Solutions" }: { size?: number; alt?: string }) {
  return (
    <img
      src={`${BASE}/carelon-icon-mark.svg`}
      alt={alt}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
