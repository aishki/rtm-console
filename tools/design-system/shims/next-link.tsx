import type { AnchorHTMLAttributes } from "react";
// Preview stand-in for next/link: a plain anchor that does not leave the card.
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} onClick={e => e.preventDefault()} />;
}
