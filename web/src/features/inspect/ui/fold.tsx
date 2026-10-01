import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Section } from '../../../ui';
import type { OpenSet } from './openset';

/**
 * One fold of an inspector: a collapsible kit Section whose one-line `summary` sits beside the title, so a
 * fold answers "is it fine?" without being opened. Open or closed is kept per view by `useOpenSet`.
 */
export function Fold({
  id,
  open,
  title,
  icon,
  summary,
  children,
}: {
  id: string;
  open: OpenSet;
  title: string;
  icon: LucideIcon;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section
      collapsible
      level={3}
      title={title}
      icon={icon}
      aside={summary}
      open={open.isOpen(id)}
      onOpenChange={(v) => open.setOpen(id, v)}
    >
      {children}
    </Section>
  );
}
