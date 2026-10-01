import assert from "node:assert/strict";
import test from "node:test";
import { squareCrop } from "../src/imageProcessing.ts";

test("avatar crops are centered squares inside portrait, landscape and square photos", () => {
  for (const [width, height] of [[320, 960], [960, 320], [600, 600], [125.5, 231.75]]) {
    const crop = squareCrop(width, height);
    assert.equal(crop.width, crop.height);
    assert.equal(crop.width, Math.min(width, height));
    assert.equal(crop.x * 2 + crop.width, width);
    assert.equal(crop.y * 2 + crop.height, height);
    assert.ok(crop.x >= 0 && crop.y >= 0);
  }
});
