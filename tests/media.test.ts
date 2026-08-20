import assert from "node:assert/strict";
import test from "node:test";
import { articleHtmlHasMeaningfulImage, proxyArticleImageUrls, proxyImageUrl } from "../src/media.ts";
import { theStandardImageUrl } from "../worker/media.ts";

const sourceImage = "https://thestandard.co/wp-content/uploads/2026/08/example-cover.jpg?x33555";
const apiUrl = "https://leafline-api.leafline.workers.dev";
const articleId = "abc123";

test("creates proxy URLs only for THE STANDARD uploads", () => {
  assert.equal(
    proxyImageUrl(sourceImage, apiUrl, articleId),
    `${apiUrl}/api/articles/${articleId}/image?url=${encodeURIComponent(sourceImage)}`,
  );
  assert.equal(proxyImageUrl("https://example.com/image.jpg", apiUrl, articleId), "https://example.com/image.jpg");
  assert.equal(proxyImageUrl(sourceImage, "", articleId), sourceImage);
});

test("rewrites THE STANDARD images inside article HTML without touching other sources", () => {
  const otherImage = "https://example.com/inline.jpg";
  const html = `<p><img src="${sourceImage}"><img src='${otherImage}'></p>`;
  const rewritten = proxyArticleImageUrls(html, apiUrl, articleId);

  assert.match(rewritten, new RegExp(encodeURIComponent(sourceImage).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rewritten, new RegExp(otherImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("detects meaningful article images but ignores camera icons", () => {
  assert.equal(articleHtmlHasMeaningfulImage('<p><img src="https://unpkg.com/lucide-static/icons/camera.svg"></p>'), false);
  assert.equal(articleHtmlHasMeaningfulImage(`<p><img src="${sourceImage}"></p>`), true);
  assert.equal(articleHtmlHasMeaningfulImage("<p>ไม่มีรูป</p>"), false);
});

test("worker proxy accepts only HTTPS image files in THE STANDARD upload directory", () => {
  assert.equal(theStandardImageUrl(sourceImage)?.toString(), sourceImage);
  assert.equal(theStandardImageUrl("https://www.thestandard.co/wp-content/uploads/2026/08/photo.webp")?.hostname, "www.thestandard.co");
  assert.equal(theStandardImageUrl("http://thestandard.co/wp-content/uploads/2026/08/photo.jpg"), null);
  assert.equal(theStandardImageUrl("https://thestandard.co/wp-admin/admin-ajax.php"), null);
  assert.equal(theStandardImageUrl("https://example.com/wp-content/uploads/2026/08/photo.jpg"), null);
  assert.equal(theStandardImageUrl("https://thestandard.co/wp-content/uploads/2026/08/script.svg"), null);
});
