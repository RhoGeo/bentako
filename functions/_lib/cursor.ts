export type SyncCursor = { t: string };

export function encodeCursor(c: SyncCursor): string {
  const json = JSON.stringify(c);
  return btoa(json);
}

export function decodeCursor(cursor: string | null | undefined): SyncCursor {
  if (!cursor) return { t: "1970-01-01T00:00:00.000Z" };
  try {
    const json = atob(cursor);
    const parsed = JSON.parse(json);
    if (parsed?.t) return { t: String(parsed.t) };
  } catch (_e) {}
  return { t: "1970-01-01T00:00:00.000Z" };
}
