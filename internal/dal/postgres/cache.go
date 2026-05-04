package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type CacheEntry struct {
	Key       string          `db:"key"`
	Type      string          `db:"type"` // 'url' | 'text'
	Result    json.RawMessage `db:"result"`
	CreatedAt time.Time       `db:"created_at"`
	UpdatedAt time.Time       `db:"updated_at"`
}

// GetCache retrieves a cached result by key and type
func GetCache(ctx context.Context, key string, cacheType string) (json.RawMessage, error) {
	db := DB()
	if db == nil {
		return nil, errors.New("postgres not initialized")
	}

	var result json.RawMessage
	query := `SELECT result FROM cache WHERE key = $1 AND type = $2`
	if err := db.QueryRowContext(ctx, query, key, cacheType).Scan(&result); err != nil {
		return nil, fmt.Errorf("get cache: %w", err)
	}
	return result, nil
}

// SetCache stores a cached result by key and type
func SetCache(ctx context.Context, key string, cacheType string, result interface{}) error {
	db := DB()
	if db == nil {
		return errors.New("postgres not initialized")
	}

	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}

	query := `
INSERT INTO cache (key, type, result)
VALUES ($1, $2, $3)
ON CONFLICT (key) DO UPDATE SET
  type = EXCLUDED.type,
  result = EXCLUDED.result,
  updated_at = NOW()
`
	_, err = db.ExecContext(ctx, query, key, cacheType, data)
	if err != nil {
		return fmt.Errorf("set cache: %w", err)
	}
	return nil
}
