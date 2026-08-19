import { validatePublicFeedUrl } from "./security";

export interface ExtractedArticleContent {
  contentHtml: string;
  imageUrl: string | null;
  source: "web";
}

const CONTENT_START = "<!--leafline-content-start-->";
const CONTENT_END = "<!--leafline-content-end-->";
const MAX_PAGE_SIZE = 2_000_000;
const MAX_CONTENT_SIZE = 180_000;

const ALLOWED_ELEMENTS = new Set([
  "p",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "img",
  "figure",
  "figcaption",
  "br",
  "hr",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "canvas",
  "video",
  "audio",
  "source",
  "noscript",
  "template",
]);

function isImodHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "iphonemod.net" || normalized.endsWith(".iphonemod.net");
}

function safeHttpUrl(value: string | null, baseUrl: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchPublicPage(sourceUrl: URL): Promise<{ response: Response; finalUrl: URL }> {
  let url = sourceUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "User-Agent": "Leafline/0.2 (+personal RSS reader)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: url };
    const location = response.headers.get("Location");
    if (!location) throw new Error("หน้าเว็บ redirect แต่ไม่มี URL ปลายทาง");
    url = validatePublicFeedUrl(new URL(location, url).toString());
  }
  throw new Error("หน้าเว็บ redirect มากเกินไป");
}

function cleanElement(element: Element, baseUrl: URL): void {
  const tagName = element.tagName.toLowerCase();

  if (DROP_WITH_CONTENT.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_ELEMENTS.has(tagName)) {
    element.removeAndKeepContent();
    return;
  }

  const hrefValue = element.getAttribute("href");
  const imageSource =
    element.getAttribute("data-src") ||
    element.getAttribute("data-lazy-src") ||
    element.getAttribute("src");
  const imageAlt = element.getAttribute("alt") || "";
  const attributes = [...element.attributes].map(([name]) => name);
  for (const name of attributes) element.removeAttribute(name);

  if (tagName === "a") {
    const href = safeHttpUrl(hrefValue, baseUrl);
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  if (tagName === "img") {
    const src = safeHttpUrl(imageSource, baseUrl);
    if (!src) {
      element.remove();
      return;
    }
    element.setAttribute("src", src);
    element.setAttribute("alt", imageAlt);
    element.setAttribute("loading", "lazy");
    element.setAttribute("decoding", "async");
    element.setAttribute("referrerpolicy", "no-referrer");
  }
}

export async function extractArticleContent(articleUrl: string): Promise<ExtractedArticleContent | null> {
  const requestedUrl = validatePublicFeedUrl(articleUrl);
  if (!isImodHost(requestedUrl.hostname)) return null;

  const { response, finalUrl } = await fetchPublicPage(requestedUrl);
  if (!response.ok) throw new Error(`หน้าบทความตอบกลับ ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) throw new Error("หน้าบทความไม่ใช่ HTML");

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_PAGE_SIZE) throw new Error("หน้าบทความมีขนาดใหญ่เกินไป");
  const pageHtml = await response.text();
  if (pageHtml.length > MAX_PAGE_SIZE) throw new Error("หน้าบทความมีขนาดใหญ่เกินไป");

  let foundContent = false;
  let imageUrl: string | null = null;
  const transformed = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(element) {
        imageUrl ||= safeHttpUrl(element.getAttribute("content"), finalUrl);
      },
    })
    .on('div.entry-content[itemprop="articleBody"]', {
      element(element) {
        foundContent = true;
        element.before(CONTENT_START, { html: true });
        element.after(CONTENT_END, { html: true });
      },
    })
    .on("#wpdevar_comment_1", {
      element(element) {
        element.remove();
      },
    })
    .on("ul.seed-social", {
      element(element) {
        element.remove();
      },
    })
    .on("ins.adsbygoogle", {
      element(element) {
        element.remove();
      },
    })
    .on("*", {
      element(element) {
        cleanElement(element, finalUrl);
      },
    })
    .transform(new Response(pageHtml, { headers: { "content-type": "text/html;charset=UTF-8" } }));

  const cleanedPage = await transformed.text();
  if (!foundContent) throw new Error("ไม่พบส่วนเนื้อหาบทความของ iMoD");
  const start = cleanedPage.indexOf(CONTENT_START);
  const end = cleanedPage.indexOf(CONTENT_END, start + CONTENT_START.length);
  if (start < 0 || end < 0) throw new Error("จัดรูปแบบเนื้อหาบทความไม่สำเร็จ");

  const contentHtml = cleanedPage.slice(start + CONTENT_START.length, end).trim();
  if (!contentHtml) throw new Error("บทความไม่มีเนื้อหาที่อ่านได้");
  if (contentHtml.length > MAX_CONTENT_SIZE) throw new Error("เนื้อหาบทความยาวเกินไป");

  return { contentHtml, imageUrl, source: "web" };
}
