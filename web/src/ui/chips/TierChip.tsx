import type { ReactNode } from 'react';
import { UNKNOWN } from '../../lib/format';
import type { TierName } from '../internal/status';
import { tierLabel } from '../internal/status';
import { Chip, type ChipProps } from './Chip';
import { TierGlyph } from './TierGlyph';

export interface TierChipProps extends Omit<ChipProps, 'tone' | 'icon' | 'mono' | 'onClick' | 'selected'> {
  /** The tier; `unknown`, null and undefined render a neutral "Unknown" chip (never a guessed tier). */
  tier: TierName | 'unknown' | null | undefined;
  /** Replaces the tier word ("Stratus") when a place or node is named instead. */
  label?: ReactNode;
  /** A payout or amount shown after the word in Plex Mono, tinted with the tier (the aim strip). */
  amount?: ReactNode;
  /** The operator's own node: a white 1 px ring and a hot glow. */
  mine?: boolean;
  /** Hide the capsule glyph (default shown; tier is never colour alone, so keep it unless space is tight). */
  glyph?: boolean;
}

/** Cumulus, Nimbus or Stratus as a chip: the capsule glyph in the tier colour plus the tier word in white. */
export function TierChip({ tier, label, amount, mine, glyph = true, size = 'md', ...rest }: TierChipProps) {
  const known = tier === 'cumulus' || tier === 'nimbus' || tier === 'stratus';
  const glyphPx = size === 'sm' ? 12 : size === 'lg' ? 16 : 14;
  return (
    <Chip size={size} data-tier={known ? tier : 'unknown'} data-mine={mine || undefined} {...rest}>
      {glyph ? <TierGlyph tier={tier} size={glyphPx} /> : null}
      {label ?? (known ? tierLabel(tier) : UNKNOWN)}
      {amount ? <span className="ui-chip__amount">{amount}</span> : null}
    </Chip>
  );
}
