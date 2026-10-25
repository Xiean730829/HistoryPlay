import { isExpiredSessionCredentialError } from "./museumApi";

export type SessionRestoreResult<T> = {
  session: T | null;
  discardedExpiredCredential: boolean;
};

export async function restoreOrDiscardExpiredSession<T>(
  restore: () => Promise<T>,
  discardSavedCredential: () => void,
): Promise<SessionRestoreResult<T>> {
  try {
    return { session: await restore(), discardedExpiredCredential: false };
  } catch (error) {
    if (!isExpiredSessionCredentialError(error)) throw error;
    discardSavedCredential();
    return { session: null, discardedExpiredCredential: true };
  }
}
