import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./museumApi";
import { restoreOrDiscardExpiredSession } from "./sessionRecovery";

describe("restoreOrDiscardExpiredSession", () => {
  it("discards only the saved credential rejected as unauthorized", async () => {
    const discard = vi.fn();

    await expect(restoreOrDiscardExpiredSession(
      async () => { throw new ApiRequestError(401, "会话凭证无效"); },
      discard,
    )).resolves.toEqual({ session: null, discardedExpiredCredential: true });

    expect(discard).toHaveBeenCalledOnce();
  });

  it("keeps a valid session when restore succeeds", async () => {
    const discard = vi.fn();
    const session = { session_id: "fresh" };

    await expect(restoreOrDiscardExpiredSession(async () => session, discard))
      .resolves.toEqual({ session, discardedExpiredCredential: false });

    expect(discard).not.toHaveBeenCalled();
  });

  it.each([
    new ApiRequestError(403, "来源不允许"),
    new ApiRequestError(503, "服务暂不可用"),
    new TypeError("Failed to fetch"),
  ])("preserves non-expiration failures", async (failure) => {
    const discard = vi.fn();

    await expect(restoreOrDiscardExpiredSession(async () => { throw failure; }, discard))
      .rejects.toBe(failure);

    expect(discard).not.toHaveBeenCalled();
  });
});
