import { readAppEnv } from '@racio/config';
import { createDatabase } from '@racio/database';

export const database = createDatabase(readAppEnv().DATABASE_URL);
