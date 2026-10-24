import assert from "node:assert/strict";
import test from "node:test";
import { projectCorridor } from "../src/gallery/corridorProjection.ts";

const stations = ["stele", "coin", "ox", "figurine", "mirror"].map((id) => ({ id }));

test("preserves server display order and projects a near-to-far window", () => {
  const projection = projectCorridor(stations, "coin", 1280);

  assert.deepEqual(projection.map((station) => station.id), stations.map(({ id }) => id));
  assert.deepEqual(projection.map(({ isVisible }) => isVisible), [false, true, true, true, true]);
  assert.equal(projection[0].hiddenReason, "behind");
  assert.equal(projection[1].depth, 0);
  assert.equal(projection[1].scale, 1);
  assert.equal(projection[1].xPercent, 50);
  assert.equal(projection[4].hiddenReason, null);
});

test("clips distant stations while retaining their stable semantic index", () => {
  const projection = projectCorridor(stations, "stele", 1280);

  assert.deepEqual(projection.map(({ displayIndex }) => displayIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(projection.map(({ isVisible }) => isVisible), [true, true, true, true, false]);
  assert.equal(projection[4].hiddenReason, "too_far");
  assert.ok(projection[1].scale < projection[0].scale);
  assert.ok(projection[2].brightness < projection[1].brightness);
  assert.ok(projection[1].zIndex < projection[0].zIndex);
});

test("narrow and wide screens keep identical order and visibility semantics", () => {
  const wide = projectCorridor(stations, "stele", 1280);
  const narrow = projectCorridor(stations, "stele", 390);

  assert.deepEqual(narrow.map(({ id, displayIndex, isVisible }) => ({ id, displayIndex, isVisible })),
    wide.map(({ id, displayIndex, isVisible }) => ({ id, displayIndex, isVisible })));
  assert.notEqual(narrow[1].xPercent, wide[1].xPercent);
});

test("rejects a focus that is not in the server-provided visible sequence", () => {
  assert.throws(() => projectCorridor(stations, "missing", 1280), /不在服务端可见顺序中/);
});

test("rejects duplicate IDs and invalid viewport widths", () => {
  assert.throws(() => projectCorridor([{ id: "coin" }, { id: "coin" }], "coin", 1280), /标识重复/);
  assert.throws(() => projectCorridor(stations, "stele", 0), /视口宽度必须是正数/);
});
