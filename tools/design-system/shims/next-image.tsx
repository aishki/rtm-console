import type { CSSProperties } from "react";
// Preview stand-in for next/image: the app's logo paths point at this system's uploaded logos.
const FILES: Record<string, string> = {
  "/assets/logos/carelon-global-solutions.png": "/_blob/657ea3b1296373c954231203d9004307",
  "/assets/logos/carelon-icon-mark.png": "/_blob/34a5d215e86bb2a324526ded54b19a3b",
  "/assets/logos/bits-logo.png": "/_blob/1a991f5f95c160e2d7905ee2de2086f2",
};
export default function Image({ src, alt, width, height, className, style }: { src: string; alt: string; width: number; height: number; className?: string; style?: CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={FILES[src] ?? src} alt={alt} width={width} height={height} className={className} style={style} />;
}
