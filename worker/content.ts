import { validatePublicFeedUrl } from "./security.ts";

export interface ExtractedArticleContent {
  contentHtml: string;
  imageUrl: string | null;
  source: "web";
}

const CONTENT_START = "<!--leafline-content-start-->";
const CONTENT_END = "<!--leafline-content-end-->";
const BBC_SEGMENT_START = "<!--leafline-bbc-segment-start-->";
const BBC_SEGMENT_END = "<!--leafline-bbc-segment-end-->";
const MAX_PAGE_SIZE = 2_000_000;
const MAX_CONTENT_SIZE = 180_000;

const ARTICLE_CONTENT_SELECTORS = [
  '[itemprop="articleBody"]',
  "article .entry-content",
  "article .post-content",
  "main.post-content",
  "main .post-content",
  "article .td-post-content",
  ".single-content .entry-content",
  ".elementor-widget-theme-post-content",
  "article .field--name-body",
  "article .article-content",
  "main .article-content",
  "article .article-body",
  "main .article-body",
  "article .post__content",
  "main .post__content",
  ".wp-block-post-content",
];

const REMOVE_FROM_ARTICLE_SELECTORS = [
  "#wpdevar_comment_1",
  "ul.seed-social",
  "ins.adsbygoogle",
  ".sharedaddy",
  ".jp-relatedposts",
  ".yarpp-related",
  ".post-tags",
  ".author-box",
  ".field__label",
];

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
  "sup",
  "sub",
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

export function isBbcThaiArticleUrl(url: URL): boolean {
  return (url.hostname === "bbc.com" || url.hostname === "www.bbc.com")
    && url.pathname.startsWith("/thai/articles/");
}

export function joinBbcArticleSegments(cleanedPage: string): string | null {
  const segments: string[] = [];
  let offset = 0;

  while (offset < cleanedPage.length) {
    const start = cleanedPage.indexOf(BBC_SEGMENT_START, offset);
    if (start < 0) break;
    const contentStart = start + BBC_SEGMENT_START.length;
    const end = cleanedPage.indexOf(BBC_SEGMENT_END, contentStart);
    if (end < 0) return null;

    const segment = cleanedPage.slice(contentStart, end).trim();
    if (segment) segments.push(segment);
    offset = end + BBC_SEGMENT_END.length;
  }

  return segments.length ? segments.join("\n") : null;
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

export async function sanitizeArticleHtml(rawHtml: string, articleUrl: string): Promise<string | null> {
  if (!rawHtml.trim()) return null;
  if (rawHtml.length > MAX_PAGE_SIZE) throw new Error("เนื้อหาจาก RSS มีขนาดใหญ่เกินไป");

  const baseUrl = new URL(articleUrl);
  const rootId = "leafline-rss-content";
  const contentSelector = rawHtml.includes("field--name-body")
    ? `#${rootId} .field--name-body .field-item`
    : `#${rootId}`;
  let foundContent = false;
  let rewriter = new HTMLRewriter().on(contentSelector, {
    element(element) {
      if (foundContent) return;
      foundContent = true;
      element.before(CONTENT_START, { html: true });
      element.after(CONTENT_END, { html: true });
    },
  });
  for (const selector of REMOVE_FROM_ARTICLE_SELECTORS) {
    rewriter = rewriter.on(selector, {
      element(element) {
        element.remove();
      },
    });
  }

  const transformed = rewriter
    .on("*", {
      element(element) {
        cleanElement(element, baseUrl);
      },
    })
    .transform(new Response(`<div id="${rootId}">${rawHtml}</div>`, {
      headers: { "content-type": "text/html;charset=UTF-8" },
    }));

  const cleanedPage = await transformed.text();
  if (!foundContent) return null;
  const start = cleanedPage.indexOf(CONTENT_START);
  const end = cleanedPage.indexOf(CONTENT_END, start + CONTENT_START.length);
  if (start < 0 || end < 0) throw new Error("จัดรูปแบบเนื้อหาจาก RSS ไม่สำเร็จ");

  const contentHtml = cleanedPage.slice(start + CONTENT_START.length, end).trim();
  if (!contentHtml) return null;
  if (contentHtml.length > MAX_CONTENT_SIZE) throw new Error("เนื้อหาบทความยาวเกินไป");
  return contentHtml;
}

async function extractBbcThaiArticleContent(
  pageHtml: string,
  finalUrl: URL,
): Promise<ExtractedArticleContent | null> {
  let bbcTextBlockCount = 0;
  let imageUrl: string | null = null;

  const markSegment = (element: Element): void => {
    element.before(BBC_SEGMENT_START, { html: true });
    element.after(BBC_SEGMENT_END, { html: true });
  };
  const segmentHandler: HTMLRewriterElementContentHandlers = { element: markSegment };

  let rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(element) {
        imageUrl ||= safeHttpUrl(element.getAttribute("content"), finalUrl);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(element) {
        imageUrl ||= safeHttpUrl(element.getAttribute("content"), finalUrl);
      },
    })
    // BBC renders every paragraph or heading as a direct child instead of one article-body container.
    // The first matching block is the title, which Leafline already renders above the article body.
    .on('main[role="main"] > div.e17x9cvu0', {
      element(element) {
        bbcTextBlockCount += 1;
        if (bbcTextBlockCount === 1) return;
        markSegment(element);
      },
    })
    .on('main[role="main"] > figure', segmentHandler);

  for (const selector of REMOVE_FROM_ARTICLE_SELECTORS) {
    rewriter = rewriter.on(selector, {
      element(element) {
        element.remove();
      },
    });
  }

  const transformed = rewriter
    .on("*", {
      element(element) {
        cleanElement(element, finalUrl);
      },
    })
    .transform(new Response(pageHtml, { headers: { "content-type": "text/html;charset=UTF-8" } }));

  const contentHtml = joinBbcArticleSegments(await transformed.text());
  if (!contentHtml) return null;
  if (contentHtml.length > MAX_CONTENT_SIZE) throw new Error("เนื้อหาบทความยาวเกินไป");

  return { contentHtml, imageUrl, source: "web" };
}

export async function extractArticleContent(articleUrl: string): Promise<ExtractedArticleContent | null> {
  const requestedUrl = validatePublicFeedUrl(articleUrl);

  const { response, finalUrl } = await fetchPublicPage(requestedUrl);
  if (!response.ok) throw new Error(`หน้าบทความตอบกลับ ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) throw new Error("หน้าบทความไม่ใช่ HTML");

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_PAGE_SIZE) throw new Error("หน้าบทความมีขนาดใหญ่เกินไป");
  const pageHtml = await response.text();
  if (pageHtml.length > MAX_PAGE_SIZE) throw new Error("หน้าบทความมีขนาดใหญ่เกินไป");

  if (isBbcThaiArticleUrl(finalUrl)) {
    const bbcContent = await extractBbcThaiArticleContent(pageHtml, finalUrl);
    if (bbcContent) return bbcContent;
  }

  let foundContent = false;
  let imageUrl: string | null = null;
  const contentHandler: HTMLRewriterElementContentHandlers = {
    element(element) {
      if (foundContent) return;
      foundContent = true;
      element.before(CONTENT_START, { html: true });
      element.after(CONTENT_END, { html: true });
    },
  };
  const removeHandler: HTMLRewriterElementContentHandlers = {
    element(element) {
      element.remove();
    },
  };

  let rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(element) {
        imageUrl ||= safeHttpUrl(element.getAttribute("content"), finalUrl);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(element) {
        imageUrl ||= safeHttpUrl(element.getAttribute("content"), finalUrl);
      },
    });

  for (const selector of ARTICLE_CONTENT_SELECTORS) rewriter = rewriter.on(selector, contentHandler);
  for (const selector of REMOVE_FROM_ARTICLE_SELECTORS) rewriter = rewriter.on(selector, removeHandler);

  const transformed = rewriter.on("*", {
      element(element) {
        cleanElement(element, finalUrl);
      },
    })
    .transform(new Response(pageHtml, { headers: { "content-type": "text/html;charset=UTF-8" } }));

  const cleanedPage = await transformed.text();
  if (!foundContent) return null;
  const start = cleanedPage.indexOf(CONTENT_START);
  const end = cleanedPage.indexOf(CONTENT_END, start + CONTENT_START.length);
  if (start < 0 || end < 0) throw new Error("จัดรูปแบบเนื้อหาบทความไม่สำเร็จ");

  const contentHtml = cleanedPage.slice(start + CONTENT_START.length, end).trim();
  if (!contentHtml) throw new Error("บทความไม่มีเนื้อหาที่อ่านได้");
  if (contentHtml.length > MAX_CONTENT_SIZE) throw new Error("เนื้อหาบทความยาวเกินไป");

  return { contentHtml, imageUrl, source: "web" };
}
