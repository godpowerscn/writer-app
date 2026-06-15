CREATE TABLE IF NOT EXISTS fonts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fonts_user ON fonts(user_id);
CREATE INDEX IF NOT EXISTS idx_fonts_active ON fonts(user_id, is_active);
