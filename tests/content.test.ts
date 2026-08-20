import assert from "node:assert/strict";
import test from "node:test";
import { isBbcThaiArticleUrl, joinBbcArticleSegments } from "../worker/content.ts";

test("recognizes only BBC Thai article URLs", () => {
  assert.equal(isBbcThaiArticleUrl(new URL("https://www.bbc.com/thai/articles/c4g617pm8gno")), true);
  assert.equal(isBbcThaiArticleUrl(new URL("https://bbc.com/thai/articles/c4g617pm8gno?at_medium=RSS")), true);
  assert.equal(isBbcThaiArticleUrl(new URL("https://www.bbc.com/thai")), false);
  assert.equal(isBbcThaiArticleUrl(new URL("https://example.com/thai/articles/c4g617pm8gno")), false);
});

test("joins cleaned BBC article blocks in page order", () => {
  const cleanedPage = [
    "navigation",
    "<!--leafline-bbc-segment-start--><figure><img src=\"https://example.com/lead.jpg\"></figure><!--leafline-bbc-segment-end-->",
    "unrelated recommendations",
    "<!--leafline-bbc-segment-start--><p>ย่อหน้าแรก</p><!--leafline-bbc-segment-end-->",
    "<!--leafline-bbc-segment-start--><h2>หัวข้อย่อย</h2><!--leafline-bbc-segment-end-->",
    "<!--leafline-bbc-segment-start--><p>ย่อหน้าถัดไป</p><!--leafline-bbc-segment-end-->",
  ].join("");

  assert.equal(
    joinBbcArticleSegments(cleanedPage),
    '<figure><img src="https://example.com/lead.jpg"></figure>\n<p>ย่อหน้าแรก</p>\n<h2>หัวข้อย่อย</h2>\n<p>ย่อหน้าถัดไป</p>',
  );
});

test("rejects an incomplete BBC segment stream", () => {
  assert.equal(joinBbcArticleSegments("<!--leafline-bbc-segment-start--><p>ไม่ครบ"), null);
});
