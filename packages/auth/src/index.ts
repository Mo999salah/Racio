export { getAuth, getAuthProviderAvailability, type RacioAuth } from './auth';
export { logAuthEvent } from './events';
export { AuthBoundaryError } from './errors';
export {
  archiveFinancialAccount,
  createFinancialAccount,
  createInstitution,
  getFinancialAccount,
  getInstitution,
  listFinancialAccounts,
  listInstitutions,
  restoreFinancialAccount,
  updateFinancialAccount,
  updateInstitution,
} from './accounts';
export {
  getCurrentUserId,
  getSession,
  requireSession,
  requireUser,
  safeReturnPath,
} from './ownership';
export {
  defaultPreferences,
  ensureUserPreferences,
  getUserPreferences,
  updateUserPreferences,
} from './preferences';
