import { fetchFeed, type ParsedFeed } from "./rss";
import { extractArticleContent } from "./content";
import { constantTimeEqual, randomToken, sha256Hex, validatePublicFeedUrl } from "./security";

interface Env {
  DB: D1Database;
  SETUP_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

interface FeedRow {
  id: string;
  url: string;
  title: string;
  site_url: string | null;
  category: string;
  icon_url: string | null;
  enabled: number;
  last_fetched_at: string | null;
  last_error: string | null;
  unread_count?: number;
}

interface ArticleRow {
  id: string;
  feed_id: string;
  feed_title: string;
  feed_category: string;
  url: string;
  title: string;
  summary: string;
  author: string | null;
  image_url: string | null;
  has_content?: number;
  content_html?: string | null;
  content_source?: string | null;
  content_fetched_at?: string | null;
  published_at: string | null;
  fetched_at: string;
  is_read: number;
  is_starred: number;
  state_updated_at: string | null;
}

interface ArticleContentRow {
  id: string;
  url: string;
  image_url: string | null;
  content_html: string | null;
  content_source: string | null;
  content_fetched_at: string | null;
}

class ApiProblem extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiProblem(400, "ข้อมูลที่ส่งมาไม่ถูกต้อง");
  }
}

function corsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowed.includes("*") || allowed.includes(origin)) return origin;
  return null;
}

function withCors(request: Request, env: Env, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = corsOrigin(request, env);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value || null;
}

async function requireAuth(request: Request, env: Env): Promise<void> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) throw new ApiProblem(401, "อุปกรณ์นี้ยังไม่ได้เชื่อมต่อ");
  const expected = await getSetting(env, "sync_token_hash");
  if (!expected) throw new ApiProblem(503, "Leafline ยังไม่ได้ตั้งค่าเครื่องแรก");
  const actual = await sha256Hex(token);
  if (!constantTimeEqual(actual, expected)) throw new ApiProblem(401, "รหัสซิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว");
}

function toFeed(row: FeedRow) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    siteUrl: row.site_url,
    category: row.category,
    iconUrl: row.icon_url,
    enabled: Boolean(row.enabled),
    lastFetchedAt: row.last_fetched_at,
    lastError: row.last_error,
    unreadCount: Number(row.unread_count || 0),
  };
}

function toArticle(row: ArticleRow) {
  return {
    id: row.id,
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    feedCategory: row.feed_category,
    url: row.url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    imageUrl: row.image_url,
    hasContent: Boolean(row.has_content ?? row.content_html),
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    stateUpdatedAt: row.state_updated_at,
  };
}

async function storeParsedFeed(env: Env, feedId: string, sourceUrl: string, category: string, parsed: ParsedFeed): Promise<number> {
  const now = isoNow();
  await env.DB.prepare(
    `INSERT INTO feeds (id, url, title, site_url, category, icon_url, last_fetched_at, last_error, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?7)
     ON CONFLICT(url) DO UPDATE SET
       title = excluded.title,
       site_url = excluded.site_url,
       category = excluded.category,
       icon_url = excluded.icon_url,
       last_fetched_at = excluded.last_fetched_at,
       last_error = NULL,
       updated_at = excluded.updated_at`,
  ).bind(feedId, sourceUrl, parsed.title, parsed.siteUrl, category, parsed.iconUrl, now).run();

  const statements: D1PreparedStatement[] = [];
  for (const article of parsed.articles) {
    const articleId = (await sha256Hex(`${feedId}:${article.guid || article.url}`)).slice(0, 40);
    statements.push(
      env.DB.prepare(
        `INSERT INTO articles (id, feed_id, guid, url, title, summary, author, image_url, published_at, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           title = excluded.title,
           summary = excluded.summary,
           author = excluded.author,
           image_url = excluded.image_url,
           published_at = COALESCE(excluded.published_at, articles.published_at)`,
      ).bind(
        articleId,
        feedId,
        article.guid,
        article.url,
        article.title,
        article.summary,
        article.author,
        article.imageUrl,
        article.publishedAt,
        now,
      ),
    );
  }

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  return statements.length;
}

async function refreshFeed(env: Env, feed: FeedRow, throwOnFailure: boolean): Promise<number> {
  try {
    const parsed = await fetchFeed(feed.url);
    return await storeParsedFeed(env, feed.id, feed.url, feed.category, parsed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "ดึง RSS ไม่สำเร็จ";
    await env.DB.prepare("UPDATE feeds SET last_error = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(message, isoNow(), feed.id)
      .run();
    if (throwOnFailure) throw new ApiProblem(422, message);
    return 0;
  }
}

async function refreshAllFeeds(env: Env): Promise<number> {
  const result = await env.DB.prepare("SELECT * FROM feeds WHERE enabled = 1 ORDER BY last_fetched_at ASC").all<FeedRow>();
  let refreshed = 0;
  for (const feed of result.results) {
    await refreshFeed(env, feed, false);
    refreshed += 1;
  }
  await env.DB.prepare(
    `DELETE FROM articles
     WHERE COALESCE(published_at, fetched_at) < datetime('now', '-120 days')
       AND id NOT IN (SELECT article_id FROM article_states WHERE is_starred = 1)`,
  ).run();
  return refreshed;
}

async function handleSetup(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return json({ initialized: Boolean(await getSetting(env, "sync_token_hash")) });
  }
  if (request.method !== "POST") throw new ApiProblem(405, "Method not allowed");
  if (!env.SETUP_SECRET) throw new ApiProblem(503, "ยังไม่ได้ตั้งค่า SETUP_SECRET ใน Cloudflare Worker");
  if (await getSetting(env, "sync_token_hash")) throw new ApiProblem(409, "ตั้งค่าเครื่องแรกแล้ว กรุณาใช้ QR หรือ Sync code จากเครื่องหลัก");

  const body = await readJson(request);
  const supplied = String(body.setupSecret || "");
  const [suppliedHash, expectedHash] = await Promise.all([sha256Hex(supplied), sha256Hex(env.SETUP_SECRET)]);
  if (!constantTimeEqual(suppliedHash, expectedHash)) throw new ApiProblem(401, "Setup secret ไม่ถูกต้อง");

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('sync_token_hash', ?1, ?2)",
    ).bind(tokenHash, isoNow()),
    env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('initialized_at', ?1, ?1)",
    ).bind(isoNow()),
  ]);
  return json({ token }, 201);
}

async function listFeeds(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT f.*,
       SUM(CASE WHEN a.id IS NOT NULL AND COALESCE(s.is_read, 0) = 0 THEN 1 ELSE 0 END) AS unread_count
     FROM feeds f
     LEFT JOIN articles a ON a.feed_id = f.id
     LEFT JOIN article_states s ON s.article_id = a.id
     GROUP BY f.id
     ORDER BY f.category COLLATE NOCASE, f.title COLLATE NOCASE`,
  ).all<FeedRow>();
  return json({ feeds: result.results.map(toFeed) });
}

async function addFeed(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const sourceUrl = validatePublicFeedUrl(String(body.url || "")).toString();
  const category = String(body.category || "ทั่วไป").trim().slice(0, 100) || "ทั่วไป";
  const feedId = (await sha256Hex(sourceUrl)).slice(0, 24);

  const existing = await env.DB.prepare("SELECT * FROM feeds WHERE url = ?1").bind(sourceUrl).first<FeedRow>();
  const parsed = await fetchFeed(sourceUrl).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "ดึง RSS ไม่สำเร็จ";
    throw new ApiProblem(422, message);
  });
  const importedArticles = await storeParsedFeed(env, existing?.id || feedId, sourceUrl, category, parsed);
  const row = await env.DB.prepare("SELECT *, 0 AS unread_count FROM feeds WHERE url = ?1").bind(sourceUrl).first<FeedRow>();
  if (!row) throw new ApiProblem(500, "บันทึก RSS ไม่สำเร็จ");
  return json({ feed: toFeed(row), importedArticles }, existing ? 200 : 201);
}

async function listArticles(url: URL, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get("limit") || 300);
  const limit = Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? requestedLimit : 300));
  const result = await env.DB.prepare(
    `SELECT a.id, a.feed_id, a.url, a.title, a.summary, a.author, a.image_url,
       a.published_at, a.fetched_at,
       CASE WHEN a.content_html IS NOT NULL AND a.content_html != '' THEN 1 ELSE 0 END AS has_content,
       f.title AS feed_title,
       f.category AS feed_category,
       COALESCE(s.is_read, 0) AS is_read,
       COALESCE(s.is_starred, 0) AS is_starred,
       s.updated_at AS state_updated_at
     FROM articles a
     JOIN feeds f ON f.id = a.feed_id
     LEFT JOIN article_states s ON s.article_id = a.id
     WHERE f.enabled = 1
     ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT ?1`,
  ).bind(limit).all<ArticleRow>();
  return json({ articles: result.results.map(toArticle) });
}

async function getArticleContent(env: Env, articleId: string): Promise<Response> {
  const article = await env.DB.prepare(
    `SELECT a.id, a.url, a.image_url, a.content_html, a.content_source, a.content_fetched_at
     FROM articles a
     JOIN feeds f ON f.id = a.feed_id
     WHERE a.id = ?1 AND f.enabled = 1`,
  ).bind(articleId).first<ArticleContentRow>();
  if (!article) throw new ApiProblem(404, "ไม่พบข่าวนี้");

  if (article.content_html) {
    return json({
      contentHtml: article.content_html,
      contentSource: article.content_source,
      imageUrl: article.image_url,
      fetchedAt: article.content_fetched_at,
    });
  }

  let extracted;
  try {
    extracted = await extractArticleContent(article.url);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "ดึงเนื้อหาเต็มไม่สำเร็จ";
    throw new ApiProblem(422, message);
  }

  if (!extracted) {
    return json({ contentHtml: null, contentSource: null, imageUrl: article.image_url, fetchedAt: null });
  }

  const now = isoNow();
  const imageUrl = article.image_url || extracted.imageUrl;
  await env.DB.prepare(
    `UPDATE articles
     SET content_html = ?1, content_source = ?2, content_fetched_at = ?3, image_url = ?4
     WHERE id = ?5`,
  ).bind(extracted.contentHtml, extracted.source, now, imageUrl, articleId).run();

  return json({ contentHtml: extracted.contentHtml, contentSource: extracted.source, imageUrl, fetchedAt: now });
}

async function updateArticleState(request: Request, env: Env, articleId: string): Promise<Response> {
  const body = await readJson(request);
  const existing = await env.DB.prepare("SELECT is_read, is_starred FROM article_states WHERE article_id = ?1")
    .bind(articleId)
    .first<{ is_read: number; is_starred: number }>();
  const article = await env.DB.prepare("SELECT id FROM articles WHERE id = ?1").bind(articleId).first<{ id: string }>();
  if (!article) throw new ApiProblem(404, "ไม่พบข่าวนี้");

  const isRead = typeof body.isRead === "boolean" ? Number(body.isRead) : (existing?.is_read || 0);
  const isStarred = typeof body.isStarred === "boolean" ? Number(body.isStarred) : (existing?.is_starred || 0);
  await env.DB.prepare(
    `INSERT INTO article_states (article_id, is_read, is_starred, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(article_id) DO UPDATE SET
       is_read = excluded.is_read,
       is_starred = excluded.is_starred,
       updated_at = excluded.updated_at`,
  ).bind(articleId, isRead, isStarred, isoNow()).run();
  return json({ ok: true });
}

async function bulkState(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const articleIds = Array.isArray(body.articleIds)
    ? [...new Set(body.articleIds.filter((id): id is string => typeof id === "string"))].slice(0, 500)
    : [];
  if (!articleIds.length) throw new ApiProblem(400, "ไม่มีข่าวที่ต้องอัปเดต");
  const isRead = typeof body.isRead === "boolean" ? Number(body.isRead) : 1;
  const now = isoNow();
  const statements = articleIds.map((id) =>
    env.DB.prepare(
      `INSERT INTO article_states (article_id, is_read, is_starred, updated_at)
       VALUES (?1, ?2, 0, ?3)
       ON CONFLICT(article_id) DO UPDATE SET is_read = excluded.is_read, updated_at = excluded.updated_at`,
    ).bind(id, isRead, now),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  return json({ ok: true, updated: statements.length });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "OPTIONS") {
    if (request.headers.get("Origin") && !corsOrigin(request, env)) return json({ error: "Origin not allowed" }, 403);
    return new Response(null, { status: 204 });
  }
  if (path === "/api/health" && request.method === "GET") return json({ ok: true, service: "leafline-api" });
  if (path === "/api/setup/status" && request.method === "GET") return handleSetup(request, env);
  if (path === "/api/setup") return handleSetup(request, env);

  await requireAuth(request, env);

  if (path === "/api/auth/verify" && request.method === "GET") return json({ ok: true });
  if (path === "/api/auth/rotate" && request.method === "POST") {
    const token = randomToken();
    await env.DB.prepare("UPDATE settings SET value = ?1, updated_at = ?2 WHERE key = 'sync_token_hash'")
      .bind(await sha256Hex(token), isoNow())
      .run();
    return json({ token });
  }
  if (path === "/api/feeds" && request.method === "GET") return listFeeds(env);
  if (path === "/api/feeds" && request.method === "POST") return addFeed(request, env);
  if (path === "/api/feeds/refresh" && request.method === "POST") {
    const refreshed = await refreshAllFeeds(env);
    return json({ ok: true, refreshed });
  }
  if (path === "/api/articles" && request.method === "GET") return listArticles(url, env);
  if (path === "/api/articles/bulk-state" && request.method === "POST") return bulkState(request, env);

  const contentMatch = path.match(/^\/api\/articles\/([a-f0-9]+)\/content$/);
  if (contentMatch && request.method === "GET") return getArticleContent(env, contentMatch[1]);

  const stateMatch = path.match(/^\/api\/articles\/([a-f0-9]+)\/state$/);
  if (stateMatch && request.method === "PATCH") return updateArticleState(request, env, stateMatch[1]);

  const feedMatch = path.match(/^\/api\/feeds\/([a-f0-9]+)$/);
  if (feedMatch && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM feeds WHERE id = ?1").bind(feedMatch[1]).run();
    return json({ ok: true });
  }

  throw new ApiProblem(404, "ไม่พบ API ที่เรียกใช้");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withCors(request, env, await route(request, env));
    } catch (cause) {
      if (cause instanceof ApiProblem) return withCors(request, env, json({ error: cause.message }, cause.status));
      console.error(cause);
      return withCors(request, env, json({ error: "เซิร์ฟเวอร์เกิดข้อผิดพลาด กรุณาลองใหม่" }, 500));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(refreshAllFeeds(env));
  },
} satisfies ExportedHandler<Env>;
