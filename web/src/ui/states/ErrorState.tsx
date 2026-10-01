import type { LucideIcon } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Button } from '../controls/Button';
import { describeError } from './describeError';
import { EmptyState, type StateTone } from './EmptyState';

/** Props of an ErrorState: the content below, plus `className`, `style`, `ref` and the other `<div>` attributes. */
export interface ErrorStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children' | 'role'> {
  /** The thrown value (an `ApiError` gets tailored copy and tone); optional when `title` is given. */
  error?: unknown;
  /** Overrides the derived title. */
  title?: ReactNode;
  /** Overrides the derived explanation. */
  children?: ReactNode;
  /** Overrides the derived icon. */
  icon?: LucideIcon;
  /** Overrides the derived tone. */
  tone?: StateTone;
  /** Shows a Retry button (hidden for errors that retrying cannot fix). */
  onRetry?: () => void;
  /** The retry is in flight. */
  retrying?: boolean;
  /** Draw the framed panel (critical border at 40%, design 8.0). Default true. */
  framed?: boolean;
  compact?: boolean;
}

/** An error state: what happened, what to do next, and a retry where one can help. */
export function ErrorState({
  error,
  title,
  children,
  icon,
  tone,
  onRetry,
  retrying,
  framed = true,
  compact,
  className,
  ...rest
}: ErrorStateProps) {
  const info = describeError(error);
  const showRetry = onRetry && (error === undefined || info.retryable);
  return (
    <EmptyState
      role="alert"
      icon={icon ?? info.icon}
      title={title ?? info.title}
      tone={tone ?? info.tone}
      framed={framed}
      compact={compact}
      className={className}
      data-code={info.code ?? undefined}
      {...rest}
      action={
        showRetry ? (
          <Button size="sm" icon={RefreshCw} loading={retrying} onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {children ?? info.text}
    </EmptyState>
  );
}
