package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

const (
	maxGraphNodes               = 1000
	maxGraphEdges               = 5000
	graphTitlePreviewCharacters = 160
)

func (s *Tasks) Graph(ctx context.Context, principal core.Principal, projectID string) (core.TaskGraph, error) {
	if err := requirePrincipal(principal); err != nil {
		return core.TaskGraph{}, err
	}
	projectID, err := CanonicalID(projectID)
	if err != nil {
		return core.TaskGraph{}, err
	}
	var graph core.TaskGraph
	var refusal *Fault
	err = s.store.ReadSnapshot(ctx, func(snapshot *store.Snapshot) error {
		if _, err := RequireProjectRead(ctx, snapshot, principal, projectID); err != nil {
			if errors.As(err, &refusal) {
				return nil
			}
			return err
		}
		var err error
		graph.Project, err = snapshot.Project(ctx, projectID)
		if errors.Is(err, core.ErrNotFound) {
			refusal = &Fault{Code: "not_found", Message: "Project was not found.", Cause: err}
			return nil
		}
		if err != nil {
			return err
		}
		size, err := snapshot.TaskGraphSize(ctx, projectID)
		if err != nil {
			return err
		}
		if size.NodeCount > maxGraphNodes || size.EdgeCount > maxGraphEdges {
			refusal = &Fault{Code: "graph_limit_exceeded", Message: "Task graph exceeds the supported size.",
				GraphLimit: &GraphLimitDetails{NodeCount: size.NodeCount, EdgeCount: size.EdgeCount,
					MaxNodes: maxGraphNodes, MaxEdges: maxGraphEdges}}
			return nil
		}
		graph.Tasks, err = snapshot.TaskGraphTasks(ctx, projectID, graphTitlePreviewCharacters)
		if err != nil {
			return err
		}
		graph.Summary = summarizeGraph(graph.Tasks)
		return nil
	})
	if err != nil {
		return core.TaskGraph{}, fmt.Errorf("read task graph: %w", err)
	}
	if refusal != nil {
		return core.TaskGraph{}, refusal
	}
	return graph, nil
}

func summarizeGraph(tasks []core.GraphTask) core.TaskGraphSummary {
	summary := core.TaskGraphSummary{Total: int64(len(tasks))}
	for _, task := range tasks {
		switch task.Status {
		case core.TaskProposed:
			summary.Proposed++
		case core.TaskTodo:
			summary.Todo++
			if task.Ready {
				summary.Ready++
			} else {
				summary.Blocked++
			}
		case core.TaskInProgress:
			summary.InProgress++
		case core.TaskDone:
			summary.Done++
		}
	}
	return summary
}
