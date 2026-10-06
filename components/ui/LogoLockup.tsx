import Image from "next/image";

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
