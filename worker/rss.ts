import { XMLParser } from "fast-xml-parser";
import { validatePublicFeedUrl } from "./security";

export interface ParsedArticle {
  guid: string;
  url: string;
  title: string;
  summary: string;
  feedContentHtml: string | null;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

const MAX_FEED_CONTENT_SIZE = 180_000;

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  iconUrl: string | null;
  articles: ParsedArticle[];
}

async function fetchPublicUrl(sourceUrl: string): Promise<Response> {
  let url = validatePublicFeedUrl(sourceUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        "User-Agent": "Leafline/0.1 (+personal RSS reader)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("Location");
    if (!location) throw new Error("RSS redirect ไม่มี URL ปลายทาง");
    url = validatePublicFeedUrl(new URL(location, url).toString());
  }
  throw new Error("RSS redirect มากเกินไป");
}

type XmlValue = Record<string, unknown> | string | number | boolean | null | undefined;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  const record = asRecord(value);
  return scalar(record["#text"] ?? record._ ?? record.value);
}

function linkOf(value: unknown, preferredRel = "alternate"): string {
  const links = asArray(value);
  for (const item of links) {
    if (typeof item === "string") return item.trim();
    const record = asRecord(item);
    if ((!record.rel || record.rel === preferredRel) && record.href) return scalar(record.href);
  }
  const first = asRecord(links[0]);
  return scalar(first.href || links[0]);
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return value
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (match) => entities[match.toLowerCase()] || match)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainText(value: unknown): string {
  const html = scalar(value);
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/\s*The post\b[\s\S]*?\bappeared first on\b[\s\S]*$/i, "")
    .trim()
    .slice(0, 2400);
}

function dateValue(value: unknown): string | null {
  const source = scalar(value);
  if (!source) return null;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function imageOf(item: Record<string, unknown>, rawContent: string): string | null {
  const enclosure = asArray(item.enclosure).map(asRecord).find((entry) => scalar(entry.type).startsWith("image/") || entry.url);
  if (enclosure?.url) return scalar(enclosure.url);

  const thumbnail = asRecord(item.thumbnail);
  if (thumbnail.url) return scalar(thumbnail.url);

  for (const content of asArray(item.content).map(asRecord)) {
    if (content.url && (!content.type || scalar(content.type).startsWith("image/"))) return scalar(content.url);
  }

  const match = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

function normalizeItem(itemValue: unknown): ParsedArticle | null {
  const item = asRecord(itemValue);
  const rawContent = scalar(item.encoded || item.description || item.summary || item.content);
  const url = linkOf(item.link) || scalar(item.url);
  const title = plainText(item.title) || "ไม่มีชื่อเรื่อง";
  if (!url) return null;

  const authorValue = item.author;
  const author = scalar(asRecord(authorValue).name || authorValue || item.creator) || null;
  const publishedAt = dateValue(item.pubDate || item.published || item.updated || item.date);
  const guid = scalar(item.guid || item.id) || url || `${title}:${publishedAt || ""}`;

  return {
    guid,
    url,
    title: title.slice(0, 600),
    summary: plainText(rawContent),
    feedContentHtml: rawContent ? rawContent.slice(0, MAX_FEED_CONTENT_SIZE) : null,
    author: author?.slice(0, 200) || null,
    imageUrl: imageOf(item, rawContent),
    publishedAt,
  };
}

export async function fetchFeed(sourceUrl: string): Promise<ParsedFeed> {
  const url = validatePublicFeedUrl(sourceUrl);
  const response = await fetchPublicUrl(url.toString());

  if (!response.ok) throw new Error(`ต้นทางตอบกลับ ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 3_000_000) throw new Error("RSS มีขนาดใหญ่เกิน 3 MB");
  const xml = await response.text();
  if (xml.length > 3_000_000) throw new Error("RSS มีขนาดใหญ่เกิน 3 MB");

  let document: Record<string, unknown>;
  try {
    document = asRecord(parser.parse(xml) as XmlValue);
  } catch {
    throw new Error("อ่าน XML ของ RSS ไม่สำเร็จ");
  }

  const rss = asRecord(document.rss || document.RDF);
  const channel = asRecord(rss.channel || document.channel);
  const atom = asRecord(document.feed);
  const root = Object.keys(channel).length ? channel : atom;
  if (!Object.keys(root).length) throw new Error("URL นี้ไม่ใช่ RSS หรือ Atom feed ที่รองรับ");

  const entries = asArray(channel.item || atom.entry);
  const articles = entries.map(normalizeItem).filter((item): item is ParsedArticle => Boolean(item)).slice(0, 100);
  const image = asRecord(root.image);
  const iconUrl = scalar(image.url || atom.icon || atom.logo) || null;

  return {
    title: plainText(root.title) || url.hostname,
    siteUrl: linkOf(root.link) || null,
    iconUrl,
    articles,
  };
}
