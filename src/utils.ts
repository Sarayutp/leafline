export function relativeDate(value: string | null): string {
  if (!value) return "ไม่นานนี้";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} วัน`;
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(date);
}

export function fullDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export function initials(value: string): string {
  return value.trim().slice(0, 2).toUpperCase() || "RSS";
}

export function feedColor(value: string): string {
  const colors = ["#dfe9d8", "#f4dfc8", "#dce6ef", "#eadff0", "#f0e5bd", "#d4ebe7"];
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
