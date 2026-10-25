const STORAGE_PREFIX = "history-play.portal-welcome.attempted.v1:";
const attemptedInMemory = new Set<string>();

export interface WelcomeAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Claim the one app-owned welcome attempt for a session, including reconnects. */
export function claimPortalWelcome(
  sessionId: string,
  storage?: WelcomeAttemptStorage | null,
): boolean {
  if (!sessionId) return false;
  if (attemptedInMemory.has(sessionId)) return false;
  const key = `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
  if (storage === undefined && typeof window !== "undefined") {
    try { storage = window.sessionStorage; } catch { storage = null; }
  }
  if (storage) {
    try {
      if (storage.getItem(key)) {
        attemptedInMemory.add(sessionId);
        return false;
      }
      storage.setItem(key, "attempted");
    } catch {
      // Keep this tab's reconnects from repeating the greeting if storage is blocked.
    }
  }
  attemptedInMemory.add(sessionId);
  return true;
}
