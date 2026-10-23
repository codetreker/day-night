package store

import (
	"context"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateProject(ctx context.Context, id, name, repoURL string) (core.Project, error) {
	project, err := scanProject(s.Pool.QueryRow(ctx, `INSERT INTO projects (id, name, repo_url)
		VALUES ($1, $2, $3) RETURNING `+projectProjection, id, name, repoURL))
	if err != nil {
		return core.Project{}, queryError("create project", err)
	}
	return project, nil
}

func readProject(ctx context.Context, tx pgx.Tx, id string) (core.Project, error) {
	project, err := scanProject(tx.QueryRow(ctx, `SELECT `+projectProjection+` FROM projects WHERE id = $1`, id))
	if err != nil {
		return core.Project{}, queryError("read project", err)
	}
	return project, nil
}

func (tx *ProjectTx) Project(ctx context.Context) (core.Project, error) {
	return readProject(ctx, tx.tx, tx.projectID)
}

func (tx *ProjectTx) UpdateProjectSettings(ctx context.Context, minutes int32) (core.Project, error) {
	project, err := scanProject(tx.tx.QueryRow(ctx, `UPDATE projects SET execution_warning_minutes = $2,
		settings_version = settings_version + 1, updated_at = statement_timestamp()
		WHERE id = $1 RETURNING `+projectProjection, tx.projectID, minutes))
	if err != nil {
		return core.Project{}, queryError("update project settings", err)
	}
	return project, nil
}
