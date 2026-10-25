const STORAGE_PREFIX = "history-play.portal-welcome.completed.v2:";
const completedInMemory = new Set<string>();
const inFlight = new Set<string>();

export interface WelcomeAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reserve one welcome attempt. Only successful playback is persisted as complete. */
export function claimPortalWelcome(
  sessionId: string,
  storage?: WelcomeAttemptStorage | null,
): boolean {
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

/** Failed or timed-out playback releases the reservation for the next manual reopen. */
export function finishPortalWelcome(
  sessionId: string,
  playedToCompletion: boolean,
  storage?: WelcomeAttemptStorage | null,
): void {
  inFlight.delete(sessionId);
  if (!sessionId || !playedToCompletion) return;
  completedInMemory.add(sessionId);
  const key = `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
  if (storage === undefined && typeof window !== "undefined") {
    try { storage = window.sessionStorage; } catch { storage = null; }
  }
  try { storage?.setItem(key, "completed"); } catch { /* Current-page deduplication still applies. */ }
}
