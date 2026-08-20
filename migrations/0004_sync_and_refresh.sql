ALTER TABLE feeds ADD COLUMN etag TEXT;
ALTER TABLE feeds ADD COLUMN last_modified TEXT;
ALTER TABLE feeds ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feeds ADD COLUMN next_fetch_at TEXT;

CREATE INDEX IF NOT EXISTS idx_feeds_next_fetch
  ON feeds(enabled, next_fetch_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_articles_fetched_at
  ON articles(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_articles_sort
  ON articles(COALESCE(published_at, fetched_at) DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_articles_feed_sort
  ON articles(feed_id, COALESCE(published_at, fetched_at) DESC, id DESC);
