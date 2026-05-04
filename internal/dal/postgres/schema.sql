CREATE TABLE cache (
  key        TEXT PRIMARY KEY,        -- SHA256(url or text)
  type       TEXT NOT NULL,           -- 'url' | 'text'
  result     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
