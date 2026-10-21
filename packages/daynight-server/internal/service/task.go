package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/google/uuid"
)

type Tasks struct {
	store    *store.Store
	projects *Projects
}

func NewTasks(database *store.Store) *Tasks {
	return &Tasks{store: database, projects: NewProjects(database)}
}

type CreateTask struct {
	Title       string
	Description string
	Properties  core.TaskProperties
	DependsOn   []string
}

type UpdateTask struct {
	Version     int64
	Title       *string
	Description *string
	Status      *core.TaskStatus
	DependsOn   *[]string
	Properties  core.TaskPropertiesPatch
}

type TaskListRequest struct {
	PageRequest
	Status *core.TaskStatus
	Ready  *bool
}

type TaskPage struct {
	Items      []core.Task
	NextCursor *string
}

type taskMutation struct {
	id      string
	current core.Task
	values  store.TaskWrite
	create  bool
	changed bool
}

func (s *Tasks) Create(ctx context.Context, projectID string, input CreateTask) (core.Task, error) {
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return core.Task{}, err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return core.Task{}, fmt.Errorf("generate task ID: %w", err)
	}
	values := store.TaskWrite{Title: input.Title, Description: input.Description, Status: core.TaskTodo, Properties: core.TaskProperties{PullRequests: append([]core.PullRequestProperty{}, input.Properties.PullRequests...)}}
	values.DependsOn, err = canonicalDependencies(input.DependsOn, id.String())
	if err != nil {
		return core.Task{}, err
	}
	if err := validateTaskText(values); err != nil {
		return core.Task{}, err
	}
	return s.write(ctx, projectID, func(tx *store.ProjectTx) (taskMutation, error) {
		if err := validateCandidate(ctx, tx, id.String(), values, nil); err != nil {
			return taskMutation{}, err
		}
		return taskMutation{id: id.String(), values: values, create: true, changed: true}, nil
	})
}

func (s *Tasks) Update(ctx context.Context, projectID, id string, input UpdateTask) (core.Task, error) {
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return core.Task{}, err
	}
	id, err = CanonicalID(id)
	if err != nil {
		return core.Task{}, err
	}
	if input.Version < 1 {
		return core.Task{}, invalidInput("Version must be a positive integer.")
	}
	if input.Title == nil && input.Description == nil && input.Status == nil && input.DependsOn == nil && input.Properties.PullRequests == nil {
		return core.Task{}, invalidInput("At least one task field must be provided.")
	}
	return s.write(ctx, projectID, func(tx *store.ProjectTx) (taskMutation, error) {
		current, err := tx.Task(ctx, id)
		if errors.Is(err, core.ErrNotFound) {
			return taskMutation{}, taskNotFound(err)
		}
		if err != nil {
			return taskMutation{}, err
		}
		if current.Version != input.Version {
			return taskMutation{}, &Fault{Code: "version_conflict", Message: "Task version does not match."}
		}
		values, err := taskCandidate(current, input)
		if err != nil {
			return taskMutation{}, err
		}
		if err := validateCandidate(ctx, tx, id, values, &current); err != nil {
			return taskMutation{}, err
		}
		changed := current.Title != values.Title || current.Description != values.Description ||
			current.Status != values.Status || !slices.Equal(current.DependsOn, values.DependsOn) || !slices.Equal(current.Properties.PullRequests, values.Properties.PullRequests)
		return taskMutation{id: id, current: current, values: values, changed: changed}, nil
	})
}

func (s *Tasks) write(ctx context.Context, projectID string, prepare func(*store.ProjectTx) (taskMutation, error)) (core.Task, error) {
	if _, err := s.projects.Get(ctx, projectID); err != nil {
		return core.Task{}, err
	}
	var result core.Task
	var refusal *Fault
	err := s.store.WriteProject(ctx, projectID, func(tx *store.ProjectTx) error {
		mutation, err := prepare(tx)
		if errors.As(err, &refusal) {
			return nil
		}
		if err != nil {
			return err
		}
		if !mutation.changed {
			result = mutation.current
			return nil
		}
		if mutation.create {
			result, err = tx.CreateTask(ctx, mutation.id, mutation.values)
		} else {
			result, err = tx.UpdateTask(ctx, mutation.id, mutation.values)
		}
		return err
	})
	if err != nil {
		return core.Task{}, fmt.Errorf("write task: %w", err)
	}
	if refusal != nil {
		return core.Task{}, refusal
	}
	return result, nil
}

func taskCandidate(current core.Task, input UpdateTask) (store.TaskWrite, error) {
	values := store.TaskWrite{Title: current.Title, Description: current.Description, Status: current.Status, DependsOn: current.DependsOn, Properties: current.Properties}
	if input.Title != nil {
		values.Title = *input.Title
	}
	if input.Description != nil {
		values.Description = *input.Description
	}
	if input.Status != nil {
		values.Status = *input.Status
	}
	if input.DependsOn != nil {
		var err error
		values.DependsOn, err = canonicalDependencies(*input.DependsOn, current.ID)
		if err != nil {
			return store.TaskWrite{}, err
		}
	}
	if input.Properties.PullRequests != nil {
		values.Properties.PullRequests = append([]core.PullRequestProperty{}, (*input.Properties.PullRequests)...)
	}
	if err := validateTaskText(values); err != nil {
		return store.TaskWrite{}, err
	}
	if !validTaskStatus(values.Status) {
		return store.TaskWrite{}, invalidInput("Task status is invalid.")
	}
	return values, nil
}

func validateTaskText(values store.TaskWrite) error {
	if strings.TrimSpace(values.Title) == "" || !utf8.ValidString(values.Title) || strings.ContainsRune(values.Title, 0) {
		return invalidInput("Task title must be nonempty UTF-8 text without NUL characters.")
	}
	if !utf8.ValidString(values.Description) || strings.ContainsRune(values.Description, 0) {
		return invalidInput("Task description must be UTF-8 text without NUL characters.")
	}
	return nil
}

func validTaskStatus(status core.TaskStatus) bool {
	return status == core.TaskTodo || status == core.TaskInProgress || status == core.TaskDone
}

func canonicalDependencies(ids []string, self string) ([]string, error) {
	canonical := make([]string, 0, len(ids))
	for _, id := range ids {
		id, err := CanonicalID(id)
		if err != nil {
			return nil, err
		}
		canonical = append(canonical, id)
	}
	slices.Sort(canonical)
	for index, id := range canonical {
		if id == self {
			return nil, &Fault{Code: "invalid_input", Message: "Task cannot depend on itself.", TaskIDs: []string{id}}
		}
		if index > 0 && id == canonical[index-1] {
			return nil, &Fault{Code: "invalid_input", Message: "Task dependencies must not repeat.", TaskIDs: []string{id}}
		}
	}
	return canonical, nil
}

func taskNotFound(cause error) *Fault {
	return &Fault{Code: "not_found", Message: "Task was not found.", Cause: cause}
}
