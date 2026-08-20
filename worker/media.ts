const ALLOWED_IMAGE_HOSTS = new Set(["thestandard.co", "www.thestandard.co"]);
const ALLOWED_IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const MAX_IMAGE_SIZE = 5_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function theStandardImageUrl(value: string): URL | null {
  if (!value || value.length > 2_000) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!url.pathname.startsWith("/wp-content/uploads/") || !ALLOWED_IMAGE_EXTENSIONS.test(url.pathname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function imageError(message: string, status: number): Response {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchAllowedImage(sourceUrl: URL): Promise<Response> {
  let url = sourceUrl;

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "User-Agent": "Leafline/0.4 (+personal RSS reader image proxy)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("Location");
    const redirectedUrl = location ? theStandardImageUrl(new URL(location, url).toString()) : null;
    if (!redirectedUrl) throw new Error("ปลายทางรูปภาพไม่ได้รับอนุญาต");
    url = redirectedUrl;
  }

  throw new Error("รูปภาพ redirect มากเกินไป");
}

export async function proxyTheStandardImage(requestUrl: URL, env: { DB: D1Database }, articleId: string): Promise<Response> {
  const sourceUrl = theStandardImageUrl(requestUrl.searchParams.get("url") || "");
  if (!sourceUrl) return imageError("URL รูปภาพไม่ได้รับอนุญาต", 400);

  const normalizedSource = sourceUrl.toString();
  const encodedSource = normalizedSource.replaceAll("&", "&amp;");
  const article = await env.DB.prepare(
    `SELECT 1 AS allowed
     FROM articles
     WHERE id = ?1
       AND (image_url = ?2 OR INSTR(content_html, ?2) > 0 OR INSTR(content_html, ?3) > 0)`,
  ).bind(articleId, normalizedSource, encodedSource).first<{ allowed: number }>();
  if (!article) return imageError("รูปภาพไม่อยู่ในบทความนี้", 403);

  let upstream: Response;
  try {
    upstream = await fetchAllowedImage(sourceUrl);
  } catch {
    return imageError("เชื่อมต่อเซิร์ฟเวอร์รูปภาพไม่สำเร็จ", 502);
  }

  if (!upstream.ok) return imageError(`เซิร์ฟเวอร์รูปภาพตอบกลับ ${upstream.status}`, 502);
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase().split(";", 1)[0];
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    return imageError("ไฟล์ที่ได้รับไม่ใช่รูปภาพที่รองรับ", 415);
  }

  const declaredSize = Number(upstream.headers.get("content-length") || 0);
  if (declaredSize > MAX_IMAGE_SIZE) return imageError("รูปภาพมีขนาดใหญ่เกินไป", 413);

  let image: ArrayBuffer;
  try {
    image = await upstream.arrayBuffer();
  } catch {
    return imageError("อ่านข้อมูลรูปภาพไม่สำเร็จ", 502);
  }
  if (image.byteLength > MAX_IMAGE_SIZE) return imageError("รูปภาพมีขนาดใหญ่เกินไป", 413);

  return new Response(image, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Length": String(image.byteLength),
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
