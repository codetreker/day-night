package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

func (s *Tasks) Get(ctx context.Context, projectID, id string) (core.Task, error) {
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return core.Task{}, err
	}
	id, err = CanonicalID(id)
	if err != nil {
		return core.Task{}, err
	}
	var result core.Task
	var missing *Fault
	err = s.store.ReadSnapshot(ctx, func(snapshot *store.Snapshot) error {
		if _, err := snapshot.Project(ctx, projectID); err != nil {
			if errors.Is(err, core.ErrNotFound) {
				missing = &Fault{Code: "not_found", Message: "Project was not found.", Cause: err}
				return nil
			}
			return err
		}
		var err error
		result, err = snapshot.Task(ctx, projectID, id)
		if errors.Is(err, core.ErrNotFound) {
			missing = taskNotFound(err)
			return nil
		}
		return err
	})
	if err != nil {
		return core.Task{}, fmt.Errorf("get task: %w", err)
	}
	if missing != nil {
		return core.Task{}, missing
	}
	return result, nil
}

func (s *Tasks) List(ctx context.Context, projectID string, request TaskListRequest) (TaskPage, error) {
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return TaskPage{}, err
	}
	if request.Status != nil && !validTaskStatus(*request.Status) {
		return TaskPage{}, invalidInput("Task status is invalid.")
	}
	scope := listScope{Kind: "tasks", ProjectID: projectID, Ready: request.Ready}
	if request.Status != nil {
		status := string(*request.Status)
		scope.Status = &status
	}
	page, err := listPage(request.PageRequest, scope)
	if err != nil {
		return TaskPage{}, err
	}
	var result store.TaskPage
	var missing error
	err = s.store.ReadSnapshot(ctx, func(snapshot *store.Snapshot) error {
		if _, err := snapshot.Project(ctx, projectID); err != nil {
			if errors.Is(err, core.ErrNotFound) {
				missing = err
				return nil
			}
			return err
		}
		var err error
		result, err = snapshot.Tasks(ctx, projectID, store.TaskQuery{Page: page, Status: request.Status, Ready: request.Ready})
		return err
	})
	if err != nil {
		return TaskPage{}, fmt.Errorf("list tasks: %w", err)
	}
	if missing != nil {
		return TaskPage{}, &Fault{Code: "not_found", Message: "Project was not found.", Cause: missing}
	}
	response := TaskPage{Items: result.Items}
	if result.HasMore {
		last := result.Items[len(result.Items)-1]
		cursor, err := encodeListCursor(scope, last.CreatedAt, last.ID)
		if err != nil {
			return TaskPage{}, fmt.Errorf("encode task cursor: %w", err)
		}
		response.NextCursor = &cursor
	}
	return response, nil
}
