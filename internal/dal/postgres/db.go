package postgres

import (
	"database/sql"
	"fmt"
	"os"
	"sync"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	db   *sql.DB
	once sync.Once
)

func Init() error {
	var err error
	once.Do(func() {
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			dsn = "postgres://postgres:postgres@localhost:5432/infoverify?sslmode=disable"
		}
		db, err = sql.Open("pgx", dsn)
		if err != nil {
			return
		}
		if pingErr := db.Ping(); pingErr != nil {
			err = pingErr
			return
		}
		err = initSchema(db)
	})
	return err
}

func DB() *sql.DB {
	return db
}

func Stop() {
	if db != nil {
		_ = db.Close()
	}
}

func initSchema(db *sql.DB) error {
	ddl := `
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}
