import assert from "node:assert/strict";
import test from "node:test";
import { canStartSwipe, resolveSwipe, type SwipeStart } from "../src/gestures.ts";

const start: SwipeStart = { pointerId: 1, x: 300, y: 400, startedAt: 1_000 };

test("starts only for a primary non-mouse pointer away from edges and controls", () => {
  assert.equal(canStartSwipe({ pointerType: "touch", isPrimary: true, x: 300, viewportWidth: 390, interactiveTarget: false }), true);
  assert.equal(canStartSwipe({ pointerType: "mouse", isPrimary: true, x: 300, viewportWidth: 390, interactiveTarget: false }), false);
  assert.equal(canStartSwipe({ pointerType: "touch", isPrimary: true, x: 10, viewportWidth: 390, interactiveTarget: false }), false);
  assert.equal(canStartSwipe({ pointerType: "touch", isPrimary: true, x: 300, viewportWidth: 390, interactiveTarget: true }), false);
});

test("resolves intentional horizontal swipes", () => {
  assert.equal(resolveSwipe(start, { x: 190, y: 410, endedAt: 1_300 }), "next");
  assert.equal(resolveSwipe(start, { x: 410, y: 390, endedAt: 1_300 }), "previous");
});

test("ignores short, slow, and mostly vertical gestures", () => {
  assert.equal(resolveSwipe(start, { x: 250, y: 405, endedAt: 1_200 }), null);
  assert.equal(resolveSwipe(start, { x: 180, y: 410, endedAt: 2_000 }), null);
  assert.equal(resolveSwipe(start, { x: 240, y: 570, endedAt: 1_250 }), null);
});
