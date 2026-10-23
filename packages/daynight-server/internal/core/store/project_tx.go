package store

import (
	"context"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/taskproperties"
	"github.com/jackc/pgx/v5"
)

type ProjectTx struct {
	tx        pgx.Tx
	projectID string
}

type TaskWrite struct {
	AllowAgents bool
	Title       string
	Description string
	Properties  core.TaskProperties
	Status      core.TaskStatus
	DependsOn   []string
}

type DependencyReplacement struct {
	TaskID    string
	DependsOn []string
}

func (s *Store) WriteProject(ctx context.Context, projectID string, operation func(*ProjectTx) error) error {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return queryError("begin project write", err)
	}
	err = transact(ctx, tx, func(tx pgx.Tx) error {
		var id string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM projects WHERE id = $1 FOR UPDATE`, projectID).Scan(&id); err != nil {
			return queryError("lock project", err)
		}
		return operation(&ProjectTx{tx: tx, projectID: projectID})
	})
	if err != nil {
		return queryError("project write", err)
	}
	return nil
}

func (tx *ProjectTx) Task(ctx context.Context, id string) (core.Task, error) {
	return readTask(ctx, tx.tx, tx.projectID, id)
}

func (tx *ProjectTx) TasksByID(ctx context.Context, ids []string) ([]core.Task, error) {
	return tx.tasks(ctx, `t.id = ANY($2::uuid[])`, ids, "read prerequisites")
}

func (tx *ProjectTx) tasks(ctx context.Context, condition string, value any, phase string) ([]core.Task, error) {
	rows, err := tx.tx.Query(ctx, `SELECT `+taskProjection+` FROM tasks t
		WHERE t.project_id = $1 AND `+condition+` ORDER BY t.id`, tx.projectID, value)
	if err != nil {
		return nil, queryError(phase, err)
	}
	tasks, err := collectTasks(rows)
	if err != nil {
		return nil, queryError(phase, err)
	}
	return tasks, nil
}

func (tx *ProjectTx) Reachable(ctx context.Context, from, to string, replacement DependencyReplacement) (bool, error) {
	var reachable bool
	err := tx.tx.QueryRow(ctx, `WITH RECURSIVE edges(task_id, depends_on_task_id) AS (
		SELECT task_id, depends_on_task_id FROM task_dependencies
		WHERE project_id = $1 AND task_id <> $4::uuid
		UNION SELECT $4::uuid, unnest($5::uuid[])
	), visited(id) AS (
		SELECT $2::uuid
		UNION SELECT e.depends_on_task_id FROM edges e JOIN visited v ON e.task_id = v.id
	) SELECT EXISTS(SELECT 1 FROM visited WHERE id = $3::uuid)`,
		tx.projectID, from, to, replacement.TaskID, replacement.DependsOn).Scan(&reachable)
	if err != nil {
		return false, queryError("candidate reachability", err)
	}
	return reachable, nil
}

func (tx *ProjectTx) CreateTask(ctx context.Context, id string, values TaskWrite) (core.Task, error) {
	_, err := tx.tx.Exec(ctx, `INSERT INTO tasks (id, project_id, title, description, status, properties, allow_agents)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, id, tx.projectID, values.Title, values.Description, values.Status, taskproperties.Encode(values.Properties), values.AllowAgents)
	if err != nil {
		return core.Task{}, queryError("create task", err)
	}
	if err := tx.insertDependencies(ctx, id, values.DependsOn); err != nil {
		return core.Task{}, err
	}
	return tx.Task(ctx, id)
}

func (tx *ProjectTx) UpdateTask(ctx context.Context, id string, values TaskWrite) (core.Task, error) {
	result, err := tx.tx.Exec(ctx, `UPDATE tasks SET title = $3, description = $4, status = $5, properties = $6, allow_agents = $7,
		started_at = CASE
			WHEN status <> $5 AND $5 = 'in_progress' THEN statement_timestamp()
			WHEN status = 'done' AND $5 <> 'done' THEN NULL
			ELSE started_at END,
		completed_at = CASE
			WHEN status <> $5 AND $5 = 'done' THEN statement_timestamp()
			WHEN status <> $5 AND ($5 = 'in_progress' OR status = 'done') THEN NULL
			ELSE completed_at END,
		version = version + 1, updated_at = statement_timestamp() WHERE project_id = $1 AND id = $2`,
		tx.projectID, id, values.Title, values.Description, values.Status, taskproperties.Encode(values.Properties), values.AllowAgents)
	if err != nil {
		return core.Task{}, queryError("update task", err)
	}
	if result.RowsAffected() == 0 {
		return core.Task{}, queryError("update task", core.ErrNotFound)
	}
	if _, err := tx.tx.Exec(ctx, `DELETE FROM task_dependencies WHERE project_id = $1 AND task_id = $2`, tx.projectID, id); err != nil {
		return core.Task{}, queryError("replace dependencies", err)
	}
	if err := tx.insertDependencies(ctx, id, values.DependsOn); err != nil {
		return core.Task{}, err
	}
	return tx.Task(ctx, id)
}

func (tx *ProjectTx) insertDependencies(ctx context.Context, id string, dependencies []string) error {
	for _, dependency := range dependencies {
		if _, err := tx.tx.Exec(ctx, `INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id)
			VALUES ($1, $2, $3)`, tx.projectID, id, dependency); err != nil {
			return queryError("insert dependency", err)
		}
	}
	return nil
}
