package service

import (
	"context"
	"errors"
	"slices"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

func validateTaskGroup(ctx context.Context, tx *store.ProjectTx, id, groupID string) error {
	if id == groupID {
		return nil
	}
	anchor, err := tx.Task(ctx, groupID)
	if errors.Is(err, core.ErrNotFound) {
		return &Fault{Code: "invalid_input", Message: "Group must identify an anchor task in this project.", TaskIDs: []string{groupID}}
	}
	if err != nil {
		return err
	}
	if anchor.GroupID != anchor.ID {
		return &Fault{Code: "invalid_input", Message: "Group must identify an anchor task in this project.", TaskIDs: []string{groupID}}
	}
	return nil
}

func validateCandidate(ctx context.Context, tx *store.ProjectTx, id string, values store.TaskWrite) error {
	prerequisites, err := tx.TasksByID(ctx, values.DependsOn)
	if err != nil {
		return err
	}
	known := make(map[string]bool, len(prerequisites))
	for _, prerequisite := range prerequisites {
		known[prerequisite.ID] = true
	}
	missing := make([]string, 0)
	for _, dependency := range values.DependsOn {
		if !known[dependency] {
			missing = append(missing, dependency)
		}
	}
	if len(missing) > 0 {
		return &Fault{Code: "invalid_input", Message: "Dependencies must identify tasks in this project.", TaskIDs: missing}
	}
	cycles := make([]string, 0)
	for _, dependency := range values.DependsOn {
		reachable, err := tx.Reachable(ctx, dependency, id, store.DependencyReplacement{TaskID: id, DependsOn: values.DependsOn})
		if err != nil {
			return err
		}
		if reachable {
			cycles = append(cycles, dependency)
		}
	}
	if len(cycles) > 0 {
		return &Fault{Code: "dependency_cycle", Message: "Task dependencies would create a cycle.", TaskIDs: cycles}
	}
	if values.Status == core.TaskInProgress || values.Status == core.TaskDone {
		blocked := make([]string, 0)
		for _, prerequisite := range prerequisites {
			if prerequisite.Status != core.TaskDone {
				blocked = append(blocked, prerequisite.ID)
			}
		}
		if len(blocked) > 0 {
			slices.Sort(blocked)
			return &Fault{Code: "dependency_unsatisfied", Message: "Task prerequisites must be done.", TaskIDs: blocked}
		}
	}
	return nil
}
