package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/google/uuid"
)

type Projects struct {
	store *store.Store
}

func NewProjects(database *store.Store) *Projects { return &Projects{store: database} }

type CreateProject struct {
	Name    string
	RepoURL string
}

type PageRequest struct {
	Limit  int
	Cursor *string
}

type ProjectPage struct {
	Items      []core.Project
	NextCursor *string
}

func (s *Projects) Create(ctx context.Context, input CreateProject) (core.Project, error) {
	return s.create(ctx, input, s.store.CreateProject)
}

func (s *Projects) CreatePrivate(ctx context.Context, principal core.Principal, input CreateProject) (core.Project, error) {
	if err := requirePrincipal(principal); err != nil {
		return core.Project{}, err
	}
	return s.create(ctx, input, func(ctx context.Context, id, name, repoURL string) (core.Project, error) {
		return s.store.CreatePrivateProject(ctx, principal, id, name, repoURL)
	})
}

func (s *Projects) create(ctx context.Context, input CreateProject, create func(context.Context, string, string, string) (core.Project, error)) (core.Project, error) {
	if strings.TrimSpace(input.Name) == "" || !utf8.ValidString(input.Name) || strings.ContainsRune(input.Name, 0) {
		return core.Project{}, invalidInput("Project name must be nonempty UTF-8 text without NUL characters.")
	}
	if err := validateRepoURL(input.RepoURL); err != nil {
		return core.Project{}, err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return core.Project{}, fmt.Errorf("generate project ID: %w", err)
	}
	project, err := create(ctx, id.String(), input.Name, input.RepoURL)
	if err != nil {
		return core.Project{}, fmt.Errorf("create project: %w", err)
	}
	return project, nil
}

func (s *Projects) Get(ctx context.Context, id string) (core.Project, error) {
	id, err := CanonicalID(id)
	if err != nil {
		return core.Project{}, err
	}
	var project core.Project
	var missing error
	err = s.store.ReadSnapshot(ctx, func(snapshot *store.Snapshot) error {
		var err error
		project, err = snapshot.Project(ctx, id)
		if errors.Is(err, core.ErrNotFound) {
			missing = err
			return nil
		}
		return err
	})
	if err != nil {
		return core.Project{}, fmt.Errorf("get project: %w", err)
	}
	if missing != nil {
		return core.Project{}, &Fault{Code: "not_found", Message: "Project was not found.", Cause: missing}
	}
	return project, nil
}

func (s *Projects) List(ctx context.Context, request PageRequest) (ProjectPage, error) {
	return s.list(ctx, request, func(snapshot *store.Snapshot, page store.Page) (store.ProjectPage, error) {
		return snapshot.Projects(ctx, page)
	})
}

func (s *Projects) ListAccessible(ctx context.Context, principal core.Principal, request PageRequest) (ProjectPage, error) {
	if err := requirePrincipal(principal); err != nil {
		return ProjectPage{}, err
	}
	return s.list(ctx, request, func(snapshot *store.Snapshot, page store.Page) (store.ProjectPage, error) {
		return snapshot.AccessibleProjects(ctx, principal, page)
	})
}

func (s *Projects) list(ctx context.Context, request PageRequest, query func(*store.Snapshot, store.Page) (store.ProjectPage, error)) (ProjectPage, error) {
	page, err := projectListPage(request)
	if err != nil {
		return ProjectPage{}, err
	}
	var result store.ProjectPage
	err = s.store.ReadSnapshot(ctx, func(snapshot *store.Snapshot) error {
		var err error
		result, err = query(snapshot, page)
		return err
	})
	if err != nil {
		return ProjectPage{}, fmt.Errorf("list projects: %w", err)
	}
	response := ProjectPage{Items: result.Items}
	if result.HasMore {
		last := result.Items[len(result.Items)-1]
		cursor, err := encodeProjectCursor(last)
		if err != nil {
			return ProjectPage{}, fmt.Errorf("encode project cursor: %w", err)
		}
		response.NextCursor = &cursor
	}
	return response, nil
}

func CanonicalID(value string) (string, error) {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return "", invalidInput("ID must be a hyphenated UUID.")
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return "", invalidInput("ID must be a hyphenated UUID.")
	}
	return id.String(), nil
}
