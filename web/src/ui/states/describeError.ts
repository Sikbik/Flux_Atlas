// Turns any thrown value into the copy and tone an error state shows. Voice rule (design 1.5):
// say what happened and what to do next; never apologise.

import { CloudRain, type LucideIcon, OctagonX, SearchX, TriangleAlert, WifiOff } from 'lucide-react';
import { isApiError } from '../../api/http';
import type { StateTone } from './EmptyState';

export interface ErrorInfo {
  title: string;
  text: string;
  tone: StateTone;
  /** Whether retrying the same request could succeed. */
  retryable: boolean;
  /** The machine-readable code (`not_found`, `network`, ...), when the error carries one. */
  code: string | null;
  icon: LucideIcon;
}

/** Copy, tone and icon for an error from a query or a thrown value. */
export function describeError(error: unknown): ErrorInfo {
  if (isApiError(error)) {
    const code = error.code;
    switch (code) {
      case 'not_found':
        return {
          title: 'Nothing here',
          text: 'Atlas has no record of this. Check the id, or search for it.',
          tone: 'neutral',
          retryable: false,
          code,
          icon: SearchX,
        };
      case 'bad_request':
        return {
          title: 'That request was not valid',
          text: error.message,
          tone: 'error',
          retryable: false,
          code,
          icon: TriangleAlert,
        };
      case 'upstream':
        return {
          title: 'Flux API is behind',
          text: 'Atlas could not reach the Flux network just now. Figures may lag the chain.',
          tone: 'warn',
          retryable: true,
          code,
          icon: CloudRain,
        };
      case 'unavailable':
        return {
          title: 'Atlas is catching up',
          text: 'The server is starting or restoring its snapshot. This usually clears within a minute.',
          tone: 'warn',
          retryable: true,
          code,
          icon: CloudRain,
        };
      case 'rate_limited':
        return {
          title: 'Too many requests',
          text:
            error.retryAfterS !== undefined
              ? `Try again in ${error.retryAfterS} s.`
              : 'Wait a moment, then try again.',
          tone: 'warn',
          retryable: true,
          code,
          icon: TriangleAlert,
        };
      case 'network':
        return {
          title: 'Cannot reach Atlas',
          text: 'The connection to the server failed. Check your network; the live stream reconnects on its own.',
          tone: 'error',
          retryable: true,
          code,
          icon: WifiOff,
        };
      default:
        return {
          title: 'Atlas could not load this',
          text: error.message || 'The server returned an unexpected response.',
          tone: 'error',
          retryable: error.retryable,
          code,
          icon: OctagonX,
        };
    }
  }
  return {
    title: 'Something went wrong',
    text: error instanceof Error && error.message ? error.message : 'An unexpected error stopped this view.',
    tone: 'error',
    retryable: true,
    code: null,
    icon: OctagonX,
  };
}
