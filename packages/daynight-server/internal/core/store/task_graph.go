package store

import (
	"context"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

type TaskGraphSize struct {
	NodeCount int64
	EdgeCount int64
}

func (s *Snapshot) TaskGraphSize(ctx context.Context, projectID string) (TaskGraphSize, error) {
	var size TaskGraphSize
	err := s.tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM tasks WHERE project_id = $1),
		(SELECT count(*) FROM task_dependencies WHERE project_id = $1)`, projectID).
		Scan(&size.NodeCount, &size.EdgeCount)
	if err != nil {
		return TaskGraphSize{}, queryError("count task graph", err)
	}
	return size, nil
}

func (s *Snapshot) TaskGraphTasks(ctx context.Context, projectID string, previewCharacters int) ([]core.GraphTask, error) {
	rows, err := s.tx.Query(ctx, `SELECT t.id::text, left(t.title, $2), char_length(t.title) > $2,
		t.status, t.created_at, t.updated_at, `+taskDependsOn+`, `+taskBlockedBy+`, `+taskReady+`
		FROM tasks t WHERE t.project_id = $1 ORDER BY t.created_at, t.id`, projectID, previewCharacters)
	if err != nil {
		return nil, queryError("read task graph", err)
	}
	defer rows.Close()
	tasks := make([]core.GraphTask, 0)
	for rows.Next() {
		var task core.GraphTask
		if err := rows.Scan(&task.ID, &task.TitlePreview, &task.TitleTruncated, &task.Status,
			&task.CreatedAt, &task.UpdatedAt, &task.DependsOn, &task.BlockedBy, &task.Ready); err != nil {
			return nil, queryError("read task graph", err)
		}
		task.CreatedAt = task.CreatedAt.UTC()
		task.UpdatedAt = task.UpdatedAt.UTC()
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, queryError("read task graph", err)
	}
	return tasks, nil
}
