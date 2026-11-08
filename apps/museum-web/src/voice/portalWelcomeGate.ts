const STORAGE_PREFIX = "history-play.portal-welcome.completed.v2:";
const completedInMemory = new Set<string>();
const inFlight = new Set<string>();

export interface WelcomeAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reserve one welcome attempt. Only successful playback is persisted as complete. */
export function claimPortalWelcome(sessionId: string, storage?: WelcomeAttemptStorage | null): boolean {
  if (!sessionId || completedInMemory.has(sessionId) || inFlight.has(sessionId)) return false;
  const key = `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
  if (storage === undefined && typeof window !== "undefined") {
    try { storage = window.sessionStorage; } catch { storage = null; }
  }
  if (storage) {
    try {
      if (storage.getItem(key) === "completed") {
        completedInMemory.add(sessionId);
        return false;
      }
    } catch {
      // Continue with the in-memory guard if browser storage is blocked.
    }
  }
  inFlight.add(sessionId);
  return true;
}

/** Failed/timeout playback releases the reservation so the next manual reopen can retry. */
export function finishPortalWelcome(
  sessionId: string,
  playedToCompletion: boolean,
  storage?: WelcomeAttemptStorage | null,
): void {
  inFlight.delete(sessionId);
  if (!playedToCompletion || !sessionId) return;
  completedInMemory.add(sessionId);
  const key = `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
  if (storage === undefined && typeof window !== "undefined") {
    try { storage = window.sessionStorage; } catch { storage = null; }
  }
  try { storage?.setItem(key, "completed"); } catch { /* In-memory completion still prevents repeats in this tab. */ }
}
