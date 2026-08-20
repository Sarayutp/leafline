import assert from "node:assert/strict";
import test from "node:test";
import { articleMatchesView, mergeArticles } from "../src/article-library.ts";
import type { Article } from "../src/types.ts";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    feedId: "feed-1",
    feedTitle: "เทพ Excel",
    feedCategory: "Productivity",
    url: "https://example.com/article-1",
    title: "สูตร Excel สำหรับงานประจำ",
    summary: "ตัวอย่างการใช้ lookup",
    author: null,
    imageUrl: null,
    hasContent: false,
    publishedAt: "2026-08-20T02:00:00.000Z",
    fetchedAt: "2026-08-20T02:01:00.000Z",
    isRead: false,
    isStarred: false,
    stateUpdatedAt: null,
    ...overrides,
  };
}

test("merges delta updates by id, sorts newest first, and caps the snapshot", () => {
  const original = article();
  const updated = article({ isRead: true, stateUpdatedAt: "2026-08-20T03:00:00.000Z" });
  const newer = article({
    id: "article-2",
    url: "https://example.com/article-2",
    publishedAt: "2026-08-20T04:00:00.000Z",
  });

  assert.deepEqual(mergeArticles([original], [updated, newer], 2).map((item) => [item.id, item.isRead]), [
    ["article-2", false],
    ["article-1", true],
  ]);
  assert.equal(mergeArticles([original], [newer], 1).length, 1);
});

test("matches server-backed views, read filters, selected articles, and Thai search", () => {
  const item = article({ isRead: true, isStarred: true });
  assert.equal(articleMatchesView(item, { kind: "starred", label: "บันทึกไว้" }, "all", "excel"), true);
  assert.equal(articleMatchesView(item, { kind: "category", id: "Other", label: "Other" }, "all", ""), false);
  assert.equal(articleMatchesView(item, { kind: "feed", id: "feed-1", label: "เทพ Excel" }, "unread", "", item.id), true);
  assert.equal(articleMatchesView(item, { kind: "inbox", label: "ข่าวทั้งหมด" }, "unread", ""), false);
  assert.equal(articleMatchesView(item, { kind: "inbox", label: "ข่าวทั้งหมด" }, "all", "สูตร"), true);
});
