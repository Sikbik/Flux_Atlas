// Readable facts about an app spec: image registry links, geo rules, environment names, the default
// URL, expiry arithmetic and the lifecycle stage.

import type { GeoRule } from '../../../api/generated/GeoRule';
import { BLOCK_MS } from '../../../lib/format';

// ---- environment (names only: values are never shown) ---------------------------------------------

/** Variable names of `KEY=value` entries. The values stay out of the UI entirely. */
export function envNames(environment: readonly string[]): string[] {
  const names: string[] = [];
  for (const raw of environment) {
    const i = raw.indexOf('=');
    const name = (i < 0 ? raw : raw.slice(0, i)).trim();
    if (name) names.push(name);
  }
  return names;
}

// ---- geo rules -------------------------------------------------------------------------------------

export const CONTINENTS: Record<string, string> = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
};

let regionNames: Intl.DisplayNames | null | undefined;
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** `Europe`, `Germany, Europe`, `North Carolina, United States`. */
export function describeGeoPlace(rule: GeoRule): string {
  const continent = CONTINENTS[rule.continent] ?? rule.continent;
  if (rule.country && rule.region) return `${rule.region}, ${countryName(rule.country)}`;
  if (rule.country) return `${countryName(rule.country)}, ${continent}`;
  return continent;
}

/** `Allow Europe; forbid Asia`. */
export function formatGeoRules(rules: readonly GeoRule[]): string {
  if (rules.length === 0) return 'Anywhere';
  const allow = rules.filter((r) => r.allow).map(describeGeoPlace);
  const forbid = rules.filter((r) => !r.allow).map(describeGeoPlace);
  const parts: string[] = [];
  if (allow.length) parts.push(`allow ${allow.join(', ')}`);
  if (forbid.length) parts.push(`forbid ${forbid.join(', ')}`);
  const s = parts.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- images ----------------------------------------------------------------------------------------

export interface ImageRef {
  /** The registry host (`docker.io` when the reference has none). */
  registry: string;
  /** The repository path without the tag, for example `yurinnick/folding-at-home`. */
  repository: string;
  tag: string;
  /** A browsable page for the image, when the registry is one we know how to link. */
  href: string | null;
}

/** Parses a docker reference (`repo/name:tag`, `ghcr.io/org/name:1`, `nginx`) and links known registries. */
export function parseImage(repotag: string): ImageRef | null {
  const raw = repotag.trim();
  if (!raw) return null;
  const noDigest = raw.split('@')[0]!;
  const lastColon = noDigest.lastIndexOf(':');
  const lastSlash = noDigest.lastIndexOf('/');
  const hasTag = lastColon > lastSlash;
  const name = hasTag ? noDigest.slice(0, lastColon) : noDigest;
  const tag = hasTag ? noDigest.slice(lastColon + 1) : 'latest';
  const parts = name.split('/');
  const first = parts[0]!;
  const hasHost = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost');
  const registry = hasHost ? first : 'docker.io';
  const path = (hasHost ? parts.slice(1) : parts).join('/');
  if (!path) return null;
  let href: string | null = null;
  if (registry === 'docker.io' || registry === 'registry-1.docker.io' || registry === 'index.docker.io') {
    href = path.includes('/')
      ? `https://hub.docker.com/r/${path.replace(/^library\//, '')}`
      : `https://hub.docker.com/_/${path}`;
    if (path.startsWith('library/')) href = `https://hub.docker.com/_/${path.slice('library/'.length)}`;
  } else if (registry === 'quay.io') {
    href = `https://quay.io/repository/${path}`;
  }
  return { registry, repository: path, tag, href };
}

// ---- urls ------------------------------------------------------------------------------------------

/** The default domain every Flux app gets. */
export const defaultAppDomain = (name: string): string => `${name.toLowerCase()}.app.runonflux.io`;

// ---- expiry ----------------------------------------------------------------------------------------

/** An app is flagged as expiring soon inside this many blocks (7 days). */
export const EXPIRING_SOON_BLOCKS = 7 * 2880;

export interface AppExpiry {
  expireHeight: number;
  /** Blocks until expiry (0 once past). */
  blocksLeft: number;
  /** Milliseconds until expiry at the 30 s cadence. */
  msLeft: number;
  /** Fraction (0..1) of the current lifetime still left. */
  fractionLeft: number;
  state: 'ok' | 'soon' | 'expired';
}

/** Expiry of an app whose current lifetime started at `fromHeight` (its latest message). */
export function appExpiry(
  expireHeight: number,
  fromHeight: number,
  tip: number,
  blockMs = BLOCK_MS,
): AppExpiry {
  const blocksLeft = Math.max(0, expireHeight - tip);
  const lifetime = Math.max(1, expireHeight - fromHeight);
  return {
    expireHeight,
    blocksLeft,
    msLeft: blocksLeft * blockMs,
    fractionLeft: Math.max(0, Math.min(1, blocksLeft / lifetime)),
    state: tip >= expireHeight ? 'expired' : blocksLeft <= EXPIRING_SOON_BLOCKS ? 'soon' : 'ok',
  };
}

// ---- lifecycle -------------------------------------------------------------------------------------

export type AppStage = 'pending' | 'confirmed' | 'installing' | 'running';

export interface AppStageInput {
  /** The app has a spec in the index (it was mined). */
  exists: boolean;
  running: number;
  target: number;
  /** Installs in progress right now. */
  installing: number;
  /** A pending message for this app that is still waiting to be mined. */
  pending: { kind: 'register' | 'update'; expiresMs: number } | null;
}

export interface AppStageInfo {
  stage: AppStage;
  running: number;
  target: number;
  installing: number;
  /** An update that is broadcast but not mined yet (the app itself exists). */
  pendingUpdate: boolean;
}

export function appStage(i: AppStageInput): AppStageInfo {
  const base = { running: i.running, target: i.target, installing: i.installing };
  if (!i.exists) return { ...base, stage: 'pending', pendingUpdate: false };
  const pendingUpdate = i.pending?.kind === 'update';
  // An app with any instance up is running, even while more are installing (a rollout or a replacement);
  // "installing" is the stage of an app whose first instances are still coming up.
  if (i.running > 0) return { ...base, stage: 'running', pendingUpdate };
  if (i.installing > 0) return { ...base, stage: 'installing', pendingUpdate };
  return { ...base, stage: 'confirmed', pendingUpdate };
}
