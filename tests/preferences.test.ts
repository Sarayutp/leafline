import assert from "node:assert/strict";
import test from "node:test";
import {
  READER_FONT_SIZE_DEFAULT,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  readerFontSizeFromStorage,
} from "../src/preferences.ts";

test("uses the default reader font size when no valid preference exists", () => {
  assert.equal(readerFontSizeFromStorage(null), READER_FONT_SIZE_DEFAULT);
  assert.equal(readerFontSizeFromStorage(""), READER_FONT_SIZE_DEFAULT);
  assert.equal(readerFontSizeFromStorage("not-a-number"), READER_FONT_SIZE_DEFAULT);
});

test("restores, rounds, and clamps a saved reader font size", () => {
  assert.equal(readerFontSizeFromStorage("20"), 20);
  assert.equal(readerFontSizeFromStorage("18.6"), 19);
  assert.equal(readerFontSizeFromStorage("8"), READER_FONT_SIZE_MIN);
  assert.equal(readerFontSizeFromStorage("40"), READER_FONT_SIZE_MAX);
});
