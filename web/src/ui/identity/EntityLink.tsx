import { useLinkProps, useRouter } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, CSSProperties, ForwardedRef, ReactNode, Ref } from 'react';
import { CopyButton } from '../controls/CopyButton';
import { cx } from '../internal/cx';
import { HoverCard } from '../overlay/HoverCard';
import { ENTITY_ICONS, ENTITY_NOUNS, entityIsMono, entityLabel } from './entityLabel';
import { type EntityKind, entityHref, entityRoute } from './entityRoute';
import { Unknown } from './Unknown';
import './identity.css';

export interface EntityLinkProps {
  /** What it is: node, host, app, block, tx, address, operator, country, provider or version. */
  kind: EntityKind;
  /** The route key: `ip:port`, an IP, an app name, a height or hash, a txid, an address, an ISO country code, an organisation, a version. */
  value: string | number | null | undefined;
  /** Visible text; defaults per kind (hashes and addresses middle-truncated, endpoints formatted, heights grouped). */
  children?: ReactNode;
  /** A preview shown in a hover card after 180 ms of hover or on keyboard focus (a node or an element, or a function called only when open). */
  preview?: ReactNode | (() => ReactNode);
  /** A leading glyph: `true` for the kind's own icon, or any lucide icon component. */
  icon?: boolean | LucideIcon;
  /** Append a copy button for the full value (revealed on hover and focus; `always` keeps it visible). */
  copy?: boolean | 'always';
  /** Keep the current camera, layers, filters and extra windows in the URL when navigating (default true). */
  keepSearch?: boolean;
  /** Accessible-name override; default is "Open <noun> <text>". */
  label?: string;
  className?: string;
  /** Inline style for the link (or, with `copy`, for the wrapper that holds the link and its copy button). */
  style?: CSSProperties;
  /** Ref to the `<a>` element. */
  ref?: Ref<HTMLAnchorElement>;
}

type AnchorRest = Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'>;
type LinkOptions = Parameters<typeof useLinkProps>[0];

// Selecting a node or host sets the selection through the path, so a stale `sel` must not survive.
const REPLACES_SELECTION: ReadonlySet<EntityKind> = new Set(['node', 'host']);

function RoutedAnchor({
  kind,
  value,
  keepSearch,
  children,
  ref,
  ...rest
}: AnchorRest & { kind: EntityKind; value: string; keepSearch: boolean; children: ReactNode }) {
  const route = entityRoute(kind, value);
  const extra = 'search' in route ? route.search : null;
  const drop = REPLACES_SELECTION.has(kind);
  const search = keepSearch
    ? (prev: Record<string, unknown>) => ({ ...prev, ...(drop ? { sel: undefined } : null), ...extra })
    : (extra ?? {});
  const linkProps = useLinkProps(
    { ...route, search } as unknown as LinkOptions,
    ref as ForwardedRef<Element>,
  );
  return (
    <a {...linkProps} {...rest}>
      {children}
    </a>
  );
}

function PlainAnchor({
  kind,
  value,
  children,
  ref,
  ...rest
}: AnchorRest & { kind: EntityKind; value: string; children: ReactNode }) {
  return (
    <a href={entityHref(kind, value)} ref={ref} {...rest}>
      {children}
    </a>
  );
}

/**
 * Everything is a link: a node, host, app, block, transaction, address, operator, country, provider or
 * version resolved to its route. Ids, hashes and addresses are set in Plex Mono, middle-truncated with
 * the full value in the title; an optional preview opens on hover or focus.
 */
export function EntityLink({
  kind,
  value,
  children,
  preview,
  icon,
  copy,
  keepSearch = true,
  label,
  className,
  style,
  ref,
}: EntityLinkProps) {
  const router = useRouter({ warn: false });
  if (value === null || value === undefined || value === '') return <Unknown />;
  const key = String(value);
  const text = children ?? entityLabel(kind, key);
  const Icon: LucideIcon | null = icon === true ? ENTITY_ICONS[kind] : icon || null;
  const mono = entityIsMono(kind);
  const accessibleName =
    label ?? (typeof text === 'string' ? `Open ${ENTITY_NOUNS[kind]} ${text}` : `Open ${ENTITY_NOUNS[kind]}`);
  const anchorProps = {
    ref,
    style: copy ? undefined : style,
    className: cx('ui-entity', !copy && className),
    'data-kind': kind,
    'data-mono': mono || undefined,
    title: typeof text === 'string' && text !== key ? key : undefined,
    'aria-label': typeof text === 'string' && text !== key ? `${accessibleName}, ${key}` : accessibleName,
  };
  const body = (
    <>
      {Icon ? <Icon className="ui-entity__icon" size={13} strokeWidth={1.5} aria-hidden="true" /> : null}
      <span className="ui-entity__text">{text}</span>
    </>
  );
  const anchor = router ? (
    <RoutedAnchor kind={kind} value={key} keepSearch={keepSearch} {...anchorProps}>
      {body}
    </RoutedAnchor>
  ) : (
    <PlainAnchor kind={kind} value={key} {...anchorProps}>
      {body}
    </PlainAnchor>
  );
  const withPreview = preview ? (
    <HoverCard content={preview} label={accessibleName}>
      {anchor}
    </HoverCard>
  ) : (
    anchor
  );
  if (!copy) return withPreview;
  return (
    <span
      className={cx('ui-entity-wrap', className)}
      style={style}
      data-copy={copy === 'always' ? 'always' : 'hover'}
    >
      {withPreview}
      <CopyButton value={key} what={ENTITY_NOUNS[kind]} className="ui-entity__copy" />
    </span>
  );
}
