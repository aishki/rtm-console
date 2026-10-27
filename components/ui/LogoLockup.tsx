import Image from "next/image";
import { useId } from "react";

const BASE = "/assets/logos";

function Logo({ src, alt, w, h, height }: { src: string; alt: string; w: number; h: number; height: number }) {
  return <Image src={`${BASE}/${src}`} alt={alt} width={Math.round((w / h) * height)} height={height} className="w-auto shrink-0 object-contain" style={{ height }} />;
}

// The four-lobed icon at the left of the wordmark is 538px tall in the 647px-tall artwork.
const ICON_RATIO = 538 / 647;
/** Clear space the wordmark needs on every side: the size of its own icon. */
export const carelonClearSpace = (height: number): number => Math.round(height * ICON_RATIO);

/** The Carelon Global Solutions wordmark, padded on all four sides by the size of its icon. */
export function CarelonLogo({ height = 22 }: { height?: number }) {
  return (
    <div className="flex shrink-0" style={{ padding: carelonClearSpace(height) }}>
      <Logo src="carelon-global-solutions.png" alt="Carelon Global Solutions" w={2486} h={647} height={height} />
    </div>
  );
}

/** The BITS mark, for the "Powered by" credit in the footer. */
export function BitsLogo({ height = 28 }: { height?: number }) {
  return <Logo src="bits-logo.png" alt="BITS, Business Intelligence & Transformation Solutions" w={3840} h={2160} height={height} />;
}

/** The Carelon icon mark, used where the wordmark does not fit and on the nudge. */
export function CarelonMark({ size = 32, alt = "Carelon Global Solutions" }: { size?: number; alt?: string }) {
  return <Image src={`${BASE}/carelon-icon-mark.png`} alt={alt} width={size} height={size} className="object-contain" style={{ width: size, height: size }} />;
}

/**
 * The RTM Console mark (Orbit 5a): an outer swirl with a smaller one turning inside it.
 * Drawn inline in the text colour, so it follows light and dark backgrounds.
 */
export function RtmMark({ size = 32, title = "RTM Console" }: { size?: number; title?: string }) {
  const id = "rtm" + useId().replace(/[^\w-]/g, "");
  const outer = `${id}-o`, inner = `${id}-i`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title} className="shrink-0">
      <defs>
        <mask id={outer}>
          <rect width="100" height="100" fill="#000" />
          <circle cx="50" cy="50" r="45" fill="#fff" />
          <circle cx="56" cy="44" r="33" fill="#000" />
          <polygon points="56,44 69.94,-115.39 160.97,-76.75 211.9,8.01" fill="#000" />
        </mask>
        <mask id={inner}>
          <rect width="100" height="100" fill="#000" />
          <circle cx="57" cy="43" r="23" fill="#fff" />
          <circle cx="51" cy="51" r="12" fill="#000" />
          <polygon points="51,51 39.84,210.61 -45.29,178.78 -99.35,105.72" fill="#000" />
        </mask>
      </defs>
      <rect width="100" height="100" fill="currentColor" mask={`url(#${outer})`} />
      <rect width="100" height="100" fill="currentColor" mask={`url(#${inner})`} />
    </svg>
  );
}
