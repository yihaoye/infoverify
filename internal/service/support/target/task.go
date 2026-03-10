package target

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/yihaoye/infoverify/internal/dal/postgres"
)

func UpsertTask(taskID, taskURL, status, errMsg string) (string, error) {
	if taskID == "" {
		if taskURL == "" {
			return "", errors.New("task id and url are empty")
		}
		taskID = IDFromURL(taskURL)
	}
	db := postgres.DB()
	if db == nil {
		return "", errors.New("postgres not initialized")
	}

	query := `
INSERT INTO tasks (id, url, status, error, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (id) DO UPDATE SET
  url = COALESCE(EXCLUDED.url, tasks.url),
  status = EXCLUDED.status,
  error = EXCLUDED.error,
  updated_at = EXCLUDED.updated_at
`
	now := time.Now().UTC()
	_, err := db.ExecContext(context.Background(), query, taskID, taskURL, status, errMsg, now)
	if err != nil {
		return "", fmt.Errorf("upsert task: %w", err)
	}
	return taskID, nil
}

func UpdateTaskStatus(taskID, status, errMsg string) error {
	if taskID == "" {
		return errors.New("task id is empty")
	}
	db := postgres.DB()
	if db == nil {
		return errors.New("postgres not initialized")
	}
	query := `
UPDATE tasks
SET status = $2, error = $3, updated_at = $4
WHERE id = $1
`
	_, err := db.ExecContext(context.Background(), query, taskID, status, errMsg, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("update task: %w", err)
	}
	return nil
}

func GetTask(ctx context.Context, id string) (map[string]interface{}, error) {
	db := postgres.DB()
	if db == nil {
		return nil, errors.New("postgres not initialized")
	}
	var url, status, errMsg string
	var createdAt, updatedAt time.Time
	query := `SELECT url, status, error, created_at, updated_at FROM tasks WHERE id = $1`
	if err := db.QueryRowContext(ctx, query, id).Scan(&url, &status, &errMsg, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("get task: %w", err)
	}
	return map[string]interface{}{
		"id":         id,
		"url":        url,
		"status":     status,
		"error":      errMsg,
		"created_at": createdAt,
		"updated_at": updatedAt,
	}, nil
}

func ListTasks(ctx context.Context, limit int) ([]map[string]interface{}, error) {
	db := postgres.DB()
	if db == nil {
		return nil, errors.New("postgres not initialized")
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := db.QueryContext(ctx, `
SELECT id, url, status, error, created_at, updated_at
FROM tasks
ORDER BY created_at DESC
LIMIT $1
`, limit)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	var res []map[string]interface{}
	for rows.Next() {
		var id, url, status, errMsg string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &url, &status, &errMsg, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		res = append(res, map[string]interface{}{
			"id":         id,
			"url":        url,
			"status":     status,
			"error":      errMsg,
			"created_at": createdAt,
			"updated_at": updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	return res, nil
}
