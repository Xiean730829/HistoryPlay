import { afterEach, expect, it, vi } from "vitest";
import { prepareArtifactInspection, type ActiveSession } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());

it("opens the initially focused exhibit without the redundant locate rejected by the server", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const session = { state: { focused_entity_id: "cn.tang.artifact.votive-stele" } } as ActiveSession;
  const result = await prepareArtifactInspection(session, "cn.tang.artifact.votive-stele");
  expect(result.session).toBe(session);
  expect(result.receipt).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
