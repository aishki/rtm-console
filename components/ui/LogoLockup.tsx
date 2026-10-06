import Image from "next/image";

const BASE = "/assets/logos";
const MARKS = [
  { src: "carelon-global-solutions.png", alt: "Carelon Global Solutions", w: 2486, h: 647 },
  { src: "opssup-logo.png", alt: "OPS Support", w: 3840, h: 2160 },
  { src: "bits-logo.png", alt: "Business Intelligence & Transformation Solutions", w: 3840, h: 2160 },
];

/** BITS LogoLockup: Carelon Global Solutions · OPS Support · BITS. */
export function LogoLockup({ height = 28, gap = 16 }: { height?: number; gap?: number }) {
  return (
    <div className="flex items-center" style={{ gap, height }}>
      {MARKS.map(m => (
        <Image key={m.src} src={`${BASE}/${m.src}`} alt={m.alt} width={Math.round((m.w / m.h) * height)} height={height} priority className="h-full w-auto shrink-0 object-contain" />
      ))}
    </div>
  );
}

/** The Carelon icon mark, used where the full lockup does not fit and on the nudge. */
export function CarelonMark({ size = 32, alt = "Carelon Global Solutions" }: { size?: number; alt?: string }) {
  return <Image src={`${BASE}/carelon-icon-mark.png`} alt={alt} width={size} height={size} className="object-contain" style={{ width: size, height: size }} />;
}
