const THE_STANDARD_IMAGE_HOSTS = new Set(["thestandard.co", "www.thestandard.co"]);
const IMAGE_SRC_PATTERN = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi;

export function isTheStandardImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && THE_STANDARD_IMAGE_HOSTS.has(url.hostname.toLowerCase())
      && url.pathname.startsWith("/wp-content/uploads/");
  } catch {
    return false;
  }
}

export function proxyImageUrl(value: string | null, apiUrl: string, articleId: string): string | null {
  if (!value || !isTheStandardImageUrl(value) || !apiUrl || !articleId) return value;
  return `${apiUrl.replace(/\/+$/, "")}/api/articles/${encodeURIComponent(articleId)}/image?url=${encodeURIComponent(value)}`;
}

export function proxyArticleImageUrls(rawHtml: string, apiUrl: string, articleId: string): string {
  if (!rawHtml || !apiUrl || !articleId) return rawHtml;
  return rawHtml.replace(IMAGE_SRC_PATTERN, (match, prefix: string, quote: string, source: string) => {
    const proxied = proxyImageUrl(source, apiUrl, articleId);
    return proxied === source ? match : `${prefix}${quote}${proxied}${quote}`;
  });
}

export function articleHtmlHasMeaningfulImage(rawHtml: string): boolean {
  if (!rawHtml) return false;
  for (const match of rawHtml.matchAll(new RegExp(IMAGE_SRC_PATTERN.source, IMAGE_SRC_PATTERN.flags))) {
    const source = match[3] || "";
    if (!source.includes("/lucide-static/icons/")) return true;
  }
  return false;
}
