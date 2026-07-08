// ============================================================================
// PHOTO LIMITS — single source of truth for how many photos a job may hold.
// ============================================================================

export const MAX_PHOTOS_PER_JOB = 20;

/** Returns the first N photos (stable slice). */
export function capPhotos<T>(photos: T[] | null | undefined, max = MAX_PHOTOS_PER_JOB): T[] {
  if (!photos || photos.length === 0) return [];
  return photos.slice(0, max);
}
