package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

func seedGraph(t *testing.T, database *store.Store, projectID string, nodes, edges int) {
	t.Helper()
	ctx := context.Background()
	if _, err := database.Pool.Exec(ctx, `INSERT INTO tasks (id, project_id, title, description, status, version, created_at, updated_at)
		SELECT md5($1::text || ':' || n)::uuid, $1::uuid, 'Task ' || n, '', 'todo', 1,
		statement_timestamp() + n * interval '1 microsecond', statement_timestamp()
		FROM generate_series(1, $2::int) n`, projectID, nodes); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id)
		SELECT $1::uuid, md5($1::text || ':' || target)::uuid, md5($1::text || ':' || predecessor)::uuid
		FROM generate_series(1, $2::int) target CROSS JOIN generate_series(1, $2::int) predecessor
		WHERE predecessor < target ORDER BY target, predecessor LIMIT $3`, projectID, nodes, edges); err != nil {
		t.Fatal(err)
	}
}

func TestTaskGraphEmptyScopedAndSummary(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	ctx := context.Background()
	empty, err := tasks.Graph(ctx, principal, strings.ToUpper(project.ID))
	if err != nil || empty.Project.ID != project.ID || empty.Tasks == nil || len(empty.Tasks) != 0 || empty.Summary != (core.TaskGraphSummary{}) {
		t.Fatalf("empty graph: %#v, %v", empty, err)
	}
	other, err := NewProjects(database).Create(ctx, principal, CreateProject{Name: "Other", RepoURL: "host:other"})
	if err != nil {
		t.Fatal(err)
	}
	createTask(t, tasks, principal, other.ID, "Out of scope")
	done := createTask(t, tasks, principal, project.ID, "Done")
	done = approveTask(t, tasks, principal, done)
	done = claimTask(t, tasks, principal, done)
	done = completeTask(t, tasks, principal, done)
	active := createTask(t, tasks, principal, project.ID, "Active", done.ID)
	active = approveTask(t, tasks, principal, active)
	active = claimTask(t, tasks, principal, active)
	ready := createTask(t, tasks, principal, project.ID, "Ready", done.ID)
	ready = approveTask(t, tasks, principal, ready)
	blocked := createTask(t, tasks, principal, project.ID, "Blocked", active.ID, ready.ID)
	blocked = approveTask(t, tasks, principal, blocked)
	proposed := createTask(t, tasks, principal, project.ID, "Proposed", done.ID)
	proposedBlocked := createTask(t, tasks, principal, project.ID, "Proposed blocked", active.ID)
	graph, err := tasks.Graph(ctx, principal, project.ID)
	wantSummary := core.TaskGraphSummary{Total: 6, Proposed: 2, Todo: 2, InProgress: 1, Done: 1, Ready: 1, Blocked: 1}
	if err != nil || graph.Summary != wantSummary || len(graph.Tasks) != 6 || !reflect.DeepEqual(graph.Project, project) {
		t.Fatalf("complete graph: %#v, %v", graph, err)
	}
	for index, original := range []core.Task{done, active, ready, blocked, proposed, proposedBlocked} {
		got := graph.Tasks[index]
		if got.ID != original.ID || got.TitlePreview != original.Title || got.TitleTruncated || got.Status != original.Status ||
			!slices.Equal(got.DependsOn, original.DependsOn) || !slices.Equal(got.BlockedBy, original.BlockedBy) || got.Ready != original.Ready ||
			!got.CreatedAt.Equal(original.CreatedAt) || !got.UpdatedAt.Equal(original.UpdatedAt) {
			t.Fatalf("projection differs from task %d: %#v versus %#v", index, got, original)
		}
	}
	_, err = tasks.Graph(ctx, principal, "invalid")
	requireFault(t, err, "invalid_input")
	_, err = tasks.Graph(ctx, principal, "00000000-0000-0000-0000-000000000000")
	fault := requireFault(t, err, "not_found")
	if !errors.Is(fault, core.ErrNotFound) || fault.GraphLimit != nil {
		t.Fatalf("missing graph cause: %#v", fault)
	}
}

func TestTaskGraphExactLimitsAndIndependentRejections(t *testing.T) {
	for _, test := range []struct {
		nodes, edges int
		refused      bool
	}{
		{1000, 5000, false}, {1001, 0, true}, {101, 5001, true},
	} {
		t.Run(fmt.Sprintf("%d_nodes_%d_edges", test.nodes, test.edges), func(t *testing.T) {
			_, database, project, databaseURL, principal := taskService(t)
			seedGraph(t, database, project.ID, test.nodes, test.edges)
			readProjection := false
			traced := tracedTasks(t, databaseURL, taskQueryAction{
				match: func(sql string) bool { return strings.Contains(sql, "left(t.title, $2)") },
				start: func() { readProjection = true },
			})
			graph, err := traced.Graph(context.Background(), principal, project.ID)
			if test.refused {
				fault := requireFault(t, err, "graph_limit_exceeded")
				want := &GraphLimitDetails{NodeCount: int64(test.nodes), EdgeCount: int64(test.edges), MaxNodes: 1000, MaxEdges: 5000}
				if !reflect.DeepEqual(fault.GraphLimit, want) || readProjection || !reflect.DeepEqual(graph, core.TaskGraph{}) {
					t.Fatalf("limit returned partial data or inaccurate counts: %#v, %#v, read %v", fault, graph, readProjection)
				}
				return
			}
			if err != nil || len(graph.Tasks) != test.nodes || !readProjection || graph.Summary.Total != 1000 || graph.Summary.Todo != 1000 {
				t.Fatalf("exact limit rejected: tasks %d, summary %#v, %v", len(graph.Tasks), graph.Summary, err)
			}
			edges := 0
			for _, task := range graph.Tasks {
				edges += len(task.DependsOn)
			}
			if edges != 5000 || graph.Summary.Ready+graph.Summary.Blocked != 1000 {
				t.Fatalf("exact limit truncated: edges %d, %#v", edges, graph.Summary)
			}
		})
	}
}

func TestTaskGraphInterleavedWriteKeepsOneSnapshot(t *testing.T) {
	tasks, database, project, databaseURL, principal := taskService(t)
	ctx := context.Background()
	predecessor := createTask(t, tasks, principal, project.ID, "Predecessor")
	predecessor = approveTask(t, tasks, principal, predecessor)
	dependent := createTask(t, tasks, principal, project.ID, "Dependent", predecessor.ID)
	dependent = approveTask(t, tasks, principal, dependent)
	writes := 0
	traced := tracedTasks(t, databaseURL, taskQueryAction{
		match: func(sql string) bool { return strings.Contains(sql, "SELECT count(*) FROM tasks") },
		end: func() {
			writes++
			if err := database.WriteProject(ctx, project.ID, func(tx *store.ProjectTx) error {
				if _, err := tx.UpdateTask(ctx, predecessor.ID, store.TaskWrite{Title: "Completed", Status: core.TaskDone}); err != nil {
					return err
				}
				_, err := tx.CreateTask(ctx, "00000000-0000-4000-8000-000000000001", store.TaskWrite{Title: "New", Status: core.TaskTodo, DependsOn: []string{dependent.ID}})
				return err
			}); err != nil {
				t.Fatal(err)
			}
		},
	})
	old, err := traced.Graph(ctx, principal, project.ID)
	if err != nil || writes != 1 || len(old.Tasks) != 2 || old.Tasks[0].TitlePreview != predecessor.Title || old.Tasks[0].Status != core.TaskTodo ||
		old.Tasks[1].Ready || !slices.Equal(old.Tasks[1].BlockedBy, []string{predecessor.ID}) || old.Summary != (core.TaskGraphSummary{Total: 2, Todo: 2, Ready: 1, Blocked: 1}) {
		t.Fatalf("mixed snapshot: %#v, writes %d, %v", old, writes, err)
	}
	fresh, err := tasks.Graph(ctx, principal, project.ID)
	if err != nil || len(fresh.Tasks) != 3 || fresh.Tasks[0].TitlePreview != "Completed" || !fresh.Tasks[1].Ready ||
		fresh.Summary != (core.TaskGraphSummary{Total: 3, Todo: 2, Done: 1, Ready: 1, Blocked: 1}) {
		t.Fatalf("fresh snapshot: %#v, %v", fresh, err)
	}
}

func TestTaskGraphOperationalFailuresAndCompletionPrecedence(t *testing.T) {
	for _, test := range []struct {
		name, fragment                  string
		missing, overLimit, cancelAfter bool
	}{
		{name: "project query", fragment: "FROM projects WHERE id ="},
		{name: "count query", fragment: "SELECT count(*) FROM tasks"},
		{name: "projection query", fragment: "left(t.title, $2)"},
		{name: "clock query", fragment: "SELECT statement_timestamp()"},
		{name: "clock completion", fragment: "SELECT statement_timestamp()", cancelAfter: true},
		{name: "missing project completion", fragment: "FROM project_members m", missing: true, cancelAfter: true},
		{name: "limit refusal completion", fragment: "SELECT count(*) FROM tasks", overLimit: true, cancelAfter: true},
		{name: "success completion", fragment: "left(t.title, $2)", cancelAfter: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, database, project, databaseURL, principal := taskService(t)
			if test.overLimit {
				seedGraph(t, database, project.ID, 1001, 0)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			action := taskQueryAction{match: func(sql string) bool { return strings.Contains(sql, test.fragment) }}
			if test.cancelAfter {
				action.end = cancel
			} else {
				action.start = cancel
			}
			traced := tracedTasks(t, databaseURL, action)
			id := project.ID
			if test.missing {
				id = "00000000-0000-0000-0000-000000000000"
			}
			graph, err := traced.Graph(ctx, principal, id)
			assertOperational(t, err)
			if !errors.Is(err, context.Canceled) || !reflect.DeepEqual(graph, core.TaskGraph{}) {
				t.Fatalf("cancellation cause or partial result: %#v, %v", graph, err)
			}
		})
	}
	for _, table := range []string{"projects", "tasks", "task_dependencies"} {
		t.Run("missing "+table, func(t *testing.T) {
			tasks, database, project, _, principal := taskService(t)
			if _, err := database.Pool.Exec(context.Background(), "DROP TABLE "+table); err != nil {
				t.Fatal(err)
			}
			_, err := tasks.Graph(context.Background(), principal, project.ID)
			assertOperational(t, err)
		})
	}
	tasks, database, project, _, principal := taskService(t)
	database.Close()
	_, err := tasks.Graph(context.Background(), principal, project.ID)
	assertOperational(t, err)
}
