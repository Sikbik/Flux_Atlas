import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A link out of Atlas (a chain's own explorer): it opens in a new tab and never hands over the opener. The address
 * must already have passed `safeHttpUrl`. With no children it is the small arrow alone, named by `label`.
 */
export function Outbound({ href, label, children }: { href: string; label: string; children?: ReactNode }) {
  return (
    <a
      className="wl-out"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      {children}
      <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
    </a>
  );
}
