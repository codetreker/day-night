package service

import (
	"context"
	"errors"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

func (s *Tasks) Approve(ctx context.Context, principal core.Principal, projectID, id string, version int64) (core.Task, error) {
	return s.transition(ctx, principal, projectID, id, version, core.TaskProposed, core.TaskTodo)
}

func (s *Tasks) Claim(ctx context.Context, principal core.Principal, projectID, id string, version int64) (core.Task, error) {
	return s.transition(ctx, principal, projectID, id, version, core.TaskTodo, core.TaskInProgress)
}

func (s *Tasks) Complete(ctx context.Context, principal core.Principal, projectID, id string, version int64) (core.Task, error) {
	return s.transition(ctx, principal, projectID, id, version, core.TaskInProgress, core.TaskDone)
}

func (s *Tasks) transition(ctx context.Context, principal core.Principal, projectID, id string, version int64, from, to core.TaskStatus) (core.Task, error) {
	if err := requirePrincipal(principal); err != nil {
		return core.Task{}, err
	}
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return core.Task{}, err
	}
	id, err = CanonicalID(id)
	if err != nil {
		return core.Task{}, err
	}
	if version < 1 {
		return core.Task{}, invalidInput("Version must be a positive integer.")
	}
	return s.write(ctx, principal, projectID, func(tx *store.ProjectTx) (taskMutation, error) {
		current, err := tx.Task(ctx, id)
		if errors.Is(err, core.ErrNotFound) {
			return taskMutation{}, taskNotFound(err)
		}
		if err != nil {
			return taskMutation{}, err
		}
		if current.Version != version {
			return taskMutation{}, &Fault{Code: "version_conflict", Message: "Task version does not match."}
		}
		if current.Status != from {
			return taskMutation{}, &Fault{Code: "invalid_transition", Message: "Task must be " + string(from) + " before becoming " + string(to) + "."}
		}
		if (to == core.TaskInProgress || to == core.TaskDone) && len(current.BlockedBy) > 0 {
			return taskMutation{}, &Fault{Code: "dependency_unsatisfied", Message: "Task prerequisites must be done.", TaskIDs: current.BlockedBy}
		}
		values := store.TaskWrite{Title: current.Title, Description: current.Description, Properties: current.Properties, Status: to, DependsOn: current.DependsOn}
		return taskMutation{id: id, current: current, values: values, changed: true}, nil
	})
}
