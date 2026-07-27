import { eq } from 'drizzle-orm';
import {
  preferenceSchema,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@racio/contracts';
import { schema, type RacioDatabase } from '@racio/database';
import { logAuthEvent } from './events';

const defaults: UserPreferences = {
  locale: 'en',
  timeZone: 'UTC',
  interfaceMode: 'easy',
  appearance: 'system',
  baseCurrency: null,
};

export function defaultPreferences(): UserPreferences {
  return { ...defaults };
}

export async function getUserPreferences(
  db: RacioDatabase,
  userId: string,
): Promise<UserPreferences> {
  const row = await db.query.userPreferences.findFirst({
    where: eq(schema.userPreferences.userId, userId),
  });
  return preferenceSchema.parse(
    row
      ? {
          locale: row.locale,
          timeZone: row.timeZone,
          interfaceMode: row.interfaceMode,
          appearance: row.appearance,
          baseCurrency: row.baseCurrency,
        }
      : defaults,
  );
}

export async function updateUserPreferences(
  db: RacioDatabase,
  userId: string,
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  const existing = await getUserPreferences(db, userId);
  const next = preferenceSchema.parse({ ...existing, ...patch });
  const now = new Date();
  await db
    .insert(schema.userPreferences)
    .values({ userId, ...next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { ...next, updatedAt: now },
    });
  logAuthEvent('preferences_updated', { userId });
  return next;
}

export async function ensureUserPreferences(db: RacioDatabase, userId: string) {
  const existing = await db.query.userPreferences.findFirst({
    where: eq(schema.userPreferences.userId, userId),
  });
  if (existing) return getUserPreferences(db, userId);
  return updateUserPreferences(db, userId, defaults);
}
