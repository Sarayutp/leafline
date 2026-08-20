import assert from "node:assert/strict";
import test from "node:test";
import { fetchFeed } from "../worker/rss.ts";

test("parses RSS content and returns cache validators", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>Example Feed</title><link>https://example.com</link>
      <item><guid>one</guid><title>First story</title><link>https://example.com/one</link>
      <description><![CDATA[<p>Hello <strong>world</strong></p><img src="https://example.com/image.jpg">]]></description>
      <pubDate>Wed, 20 Aug 2026 02:00:00 GMT</pubDate></item>
    </channel></rss>`, {
    headers: { "content-type": "application/rss+xml", etag: '"feed-v1"', "last-modified": "Wed, 20 Aug 2026 02:05:00 GMT" },
  })) as typeof fetch;

  try {
    const result = await fetchFeed("https://example.com/feed.xml");
    assert.equal(result.notModified, false);
    assert.equal(result.etag, '"feed-v1"');
    assert.equal(result.feed?.title, "Example Feed");
    assert.equal(result.feed?.articles[0]?.summary, "Hello world");
    assert.equal(result.feed?.articles[0]?.imageUrl, "https://example.com/image.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends conditional headers and handles a 304 response", async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders = new Headers();
  globalThis.fetch = (async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(null, { status: 304, headers: { etag: '"feed-v2"' } });
  }) as typeof fetch;

  try {
    const result = await fetchFeed("https://example.com/feed.xml", {
      etag: '"feed-v1"',
      lastModified: "Wed, 20 Aug 2026 02:05:00 GMT",
    });
    assert.equal(requestHeaders.get("if-none-match"), '"feed-v1"');
    assert.equal(requestHeaders.get("if-modified-since"), "Wed, 20 Aug 2026 02:05:00 GMT");
    assert.equal(result.notModified, true);
    assert.equal(result.feed, null);
    assert.equal(result.etag, '"feed-v2"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
