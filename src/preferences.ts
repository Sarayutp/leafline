export const READER_FONT_SIZE_MIN = 14;
export const READER_FONT_SIZE_MAX = 24;
export const READER_FONT_SIZE_DEFAULT = 16;

export function readerFontSizeFromStorage(value: string | null): number {
  if (value === null || !value.trim()) return READER_FONT_SIZE_DEFAULT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return READER_FONT_SIZE_DEFAULT;
  return Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, Math.round(parsed)));
}
