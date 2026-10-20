// Target platforms and the longest video each accepts. A project may name one; the editor warns
// (it never blocks) when the timeline runs longer than the platform allows.
import { timelineDuration } from './timeline';
import type { Platform, Project } from './types';

/** Seconds. Upload limits for a regular account as of 2026. */
export const PLATFORM_MAX_DURATION: Record<Platform, number> = {
  instagramReels: 3 * 60,
  instagramPost: 60,
  youtube: 15 * 60,
  tiktok: 10 * 60,
};

export const PLATFORMS = Object.keys(PLATFORM_MAX_DURATION) as Platform[];

export function maxDurationOf(project: Project): number | undefined {
  const platform = project.settings.platform;
  return platform ? PLATFORM_MAX_DURATION[platform] : undefined;
}

/** Seconds over the platform limit, or 0 when within it (or no platform is set). */
export function overLimitBy(project: Project): number {
  const max = maxDurationOf(project);
  return max === undefined ? 0 : Math.max(0, timelineDuration(project) - max);
}
