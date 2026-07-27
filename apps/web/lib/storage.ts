import { readAppEnv } from '@racio/config';
import { createLocalPrivateStorage } from '@racio/storage';

const env = readAppEnv();
export const privateStorage = createLocalPrivateStorage({ rootDirectory: env.LOCAL_STORAGE_PATH });
