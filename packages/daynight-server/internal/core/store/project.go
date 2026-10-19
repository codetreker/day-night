package store

import (
	"context"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

func (s *Store) CreateProject(ctx context.Context, id, name, repoURL string) (core.Project, error) {
	project, err := scanProject(s.Pool.QueryRow(ctx, `INSERT INTO projects (id, name, repo_url)
		VALUES ($1, $2, $3) RETURNING id::text, name, repo_url, created_at, updated_at`, id, name, repoURL))
	if err != nil {
		return core.Project{}, queryError("create project", err)
	}
	return project, nil
}
