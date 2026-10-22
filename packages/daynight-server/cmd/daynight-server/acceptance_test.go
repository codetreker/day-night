package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func TestBuiltBinaryAcceptance(t *testing.T) {
	acceptanceCase(t, "proposed_read_projection", []string{"V1", "V5", "V6", "V7"}, acceptanceProposedReads)
	acceptanceCase(t, "workflow_restart_persistence", []string{"V1", "V4", "V5", "V6", "V10", "TP-V1", "TP-V3"}, acceptanceWorkflow)
	acceptanceCase(t, "refusals_scopes_filters_and_cursors", []string{"V2", "V4", "V5", "V6", "V10"}, acceptanceRefusals)
	acceptanceCase(t, "concurrent_reverse_dependencies", []string{"V3"}, acceptanceReverseDependencies)
	acceptanceCase(t, "concurrent_reopen_and_start", []string{"V4"}, acceptanceReopenAndStart)
	acceptanceCase(t, "concurrent_same_version", []string{"V5", "TP-V4"}, acceptanceVersionRace)
	acceptanceCase(t, "partial_write_http_failure_rolls_back", []string{"V2", "V7", "V10", "TP-V4"}, acceptancePartialFailure)
	acceptanceCase(t, "canceled_request_and_independent_project", []string{"V3", "V7", "V10", "TP-V4"}, acceptanceCancellation)
	acceptanceCase(t, "graceful_sigterm_drains_committed_request", []string{"V1", "V7"}, acceptanceGracefulShutdown)
	acceptanceCase(t, "forced_sigterm_cancels_without_late_write", []string{"V1", "V7", "V10"}, acceptanceForcedShutdown)
	acceptanceCase(t, "unsupported_migration_history_fails_before_listening", []string{"V7", "V10"}, acceptanceUnknownMigration)
	acceptanceCase(t, "failed_migration_retains_prior_and_releases_resources", []string{"V7", "V10"}, acceptanceFailedMigration)
	acceptanceCase(t, "concurrent_process_migrations_share_one_ledger", []string{"V1", "V7"}, acceptanceConcurrentStartup)
}

func acceptanceWorkflow(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	empty := acceptanceDecode[api.ProjectPage](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects", nil, ""), http.StatusOK)
	if empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != nil {
		t.Fatal("fresh process project list is not an initialized empty page")
	}
	project := process.project(t, "acceptance-secret-project")
	first := process.task(t, project, "acceptance-secret-prerequisite")
	second := process.task(t, project, "Second prerequisite")
	dependencies := []string{first.ID, second.ID}
	slices.Sort(dependencies)
	references := api.TaskProperties{PullRequests: []api.PullRequestProperty{
		{URL: "", Title: ""},
		{URL: "  acceptance-secret arbitrary\x00\n地址  ", Title: "\t标题\x00"},
		{URL: "  acceptance-secret arbitrary\x00\n地址  ", Title: "\t标题\x00"},
	}}
	target := acceptanceDecode[api.Task](t, process.request(context.Background(), http.MethodPost, acceptanceTasksPath(project.ID), map[string]any{
		"title": "Target", "dependsOn": []string{second.ID, first.ID}, "properties": references,
	}, "create-references"), http.StatusCreated)
	if !reflect.DeepEqual(target.Properties, references) || first.Properties.PullRequests == nil || len(first.Properties.PullRequests) != 0 {
		t.Fatal("created properties changed caller strings or default list")
	}
	if first.Description != "" || first.Status != "todo" || !first.Ready || first.DependsOn == nil || first.BlockedBy == nil || target.Ready || !slices.Equal(target.DependsOn, dependencies) || !slices.Equal(target.BlockedBy, dependencies) {
		t.Fatal("created task defaults or dependency projection are invalid")
	}
	noChange := process.update(t, target, map[string]any{"title": target.Title, "dependsOn": dependencies, "properties": references})
	if !reflect.DeepEqual(noChange, target) {
		t.Fatal("semantic no-op changed task version or update time")
	}
	refusal := process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(target), map[string]any{"version": target.Version, "status": "in_progress"}, "blocked-start")
	fault := acceptanceError(t, refusal, http.StatusConflict, "dependency_unsatisfied")
	if fault.Details == nil || !slices.Equal(fault.Details.TaskIDs, dependencies) {
		t.Fatal("blocked transition omitted sorted task IDs")
	}
	first = process.update(t, first, map[string]any{"status": "done"})
	second = process.update(t, second, map[string]any{"status": "done"})
	ready := process.readTask(t, target)
	if !ready.Ready || len(ready.BlockedBy) != 0 || ready.Version != target.Version || !ready.UpdatedAt.Equal(target.UpdatedAt) {
		t.Fatal("prerequisite completion mutated downstream metadata or left it blocked")
	}
	target = process.update(t, ready, map[string]any{"status": "in_progress", "description": "acceptance-secret-description", "properties": references})
	if target.Version != 2 || target.Status != "in_progress" || target.Ready {
		t.Fatal("task start did not atomically advance fields and version")
	}
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "status": "todo"}, "reopen-refused"), http.StatusConflict, "dependency_unsatisfied")
	target = process.update(t, target, map[string]any{"status": "done", "description": ""})
	if target.Description != "" || target.Version != 3 {
		t.Fatal("description clear or completion version differs from the contract")
	}
	readProject := acceptanceDecode[api.Project](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects/"+project.ID, nil, "project-read"), http.StatusOK)
	if !reflect.DeepEqual(readProject, project) {
		t.Fatal("project read differs from its persisted creation")
	}
	before := process.readTask(t, target)
	process.signal(t)
	process.stopped(t, 0)
	restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
	if restarted.address != process.address {
		t.Fatal("restarted process did not reuse its released listener")
	}
	if after := restarted.readTask(t, target); !reflect.DeepEqual(after, before) {
		t.Fatal("task metadata, dependencies, properties or derived state changed across process restart")
	}
	projectAfter := acceptanceDecode[api.Project](t, restarted.request(context.Background(), http.MethodGet, "/api/v1/projects/"+project.ID, nil, ""), http.StatusOK)
	if !reflect.DeepEqual(projectAfter, project) {
		t.Fatal("project did not persist across actual process restart")
	}
	page := acceptanceDecode[api.TaskPage](t, restarted.request(context.Background(), http.MethodGet, acceptanceTasksPath(project.ID)+"?status=done&ready=false", nil, ""), http.StatusOK)
	if len(page.Items) != 3 || page.NextCursor != nil {
		t.Fatal("persisted completed tasks were not returned by their filtered list")
	}
	process.logs.safe(t, "acceptance-secret")
	if !process.logs.matches(map[string]any{"request_id": "blocked-start", "type": "operation_error", "cause": "dependency_unsatisfied", "component": "task", "phase": "update", "error_code": "dependency_unsatisfied"}) {
		t.Fatal("business refusal log cannot be correlated with its HTTP error")
	}
	restarted.signal(t)
	restarted.stopped(t, 0)
}

func acceptanceRefusals(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project, other := process.project(t, "Primary"), process.project(t, "Other")
	first := process.task(t, project, "First")
	second := process.task(t, project, "Second", first.ID)
	third := process.task(t, project, "Third", second.ID)
	foreign := process.task(t, other, "acceptance-secret-foreign")
	missing := "00000000-0000-4000-8000-000000000099"
	for _, refs := range [][]string{{first.ID}, {second.ID, second.ID}, {foreign.ID}, {missing}} {
		response := process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "dependsOn": refs}, "dependency-invalid")
		acceptanceError(t, response, http.StatusBadRequest, "invalid_input")
		if !reflect.DeepEqual(process.readTask(t, first), first) {
			t.Fatal("invalid dependency input partially changed task state")
		}
	}
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "dependsOn": []string{third.ID}}, "cycle-refused"), http.StatusConflict, "dependency_cycle")
	if !reflect.DeepEqual(process.readTask(t, first), first) {
		t.Fatal("indirect cycle refusal changed task state")
	}
	acceptanceError(t, process.request(context.Background(), http.MethodGet, acceptanceTasksPath(other.ID)+"/"+first.ID, nil, ""), http.StatusNotFound, "not_found")
	acceptanceError(t, process.request(context.Background(), http.MethodGet, acceptanceTasksPath(missing), nil, ""), http.StatusNotFound, "not_found")
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "title": nil}, ""), http.StatusBadRequest, "invalid_input")
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version}, ""), http.StatusBadRequest, "invalid_input")
	method := process.request(context.Background(), http.MethodDelete, acceptanceTaskPath(first), nil, "")
	acceptanceError(t, method, http.StatusMethodNotAllowed, "method_not_allowed")
	if method.header.Get("Allow") != "GET, HEAD, PATCH" {
		t.Fatal("unsupported method omitted its exact Allow contract")
	}
	first = process.update(t, first, map[string]any{"title": "Changed"})
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": 1, "title": first.Title}, ""), http.StatusConflict, "version_conflict")
	if !reflect.DeepEqual(process.readTask(t, first), first) {
		t.Fatal("stale no-op changed task state")
	}
	fixture.exec(t, "UPDATE tasks SET created_at='2026-01-01T00:00:00Z' WHERE project_id=$1", project.ID)
	readySecond := process.task(t, project, "Another ready task")
	fixture.exec(t, "UPDATE tasks SET created_at='2026-01-01T00:00:00Z' WHERE id=$1", readySecond.ID)
	expected := []string{first.ID, readySecond.ID}
	slices.Sort(expected)
	path := acceptanceTasksPath(project.ID) + "?status=todo&ready=true&limit=1"
	page := acceptanceDecode[api.TaskPage](t, process.request(context.Background(), http.MethodGet, path, nil, ""), http.StatusOK)
	if len(page.Items) != 1 || page.Items[0].ID != expected[0] || page.NextCursor == nil {
		t.Fatal("filtered first keyset page differs from tied-timestamp order")
	}
	cursor := url.QueryEscape(*page.NextCursor)
	last := acceptanceDecode[api.TaskPage](t, process.request(context.Background(), http.MethodGet, path+"&cursor="+cursor, nil, ""), http.StatusOK)
	if len(last.Items) != 1 || last.Items[0].ID != expected[1] || last.NextCursor != nil {
		t.Fatal("filtered final keyset page or terminal cursor is invalid")
	}
	for index, path := range []string{acceptanceTasksPath(other.ID) + "?status=todo&ready=true&cursor=" + cursor, acceptanceTasksPath(project.ID) + "?status=todo&ready=false&cursor=" + cursor, "/api/v1/projects?cursor=" + cursor} {
		requestID := ""
		if index == 0 {
			requestID = acceptanceSQLRequestID
		}
		fault := acceptanceError(t, process.request(context.Background(), http.MethodGet, path, nil, requestID), http.StatusBadRequest, "invalid_input")
		if requestID != "" && fault.RequestID != requestID {
			t.Fatal("cursor refusal did not preserve its supplied request ID")
		}
	}
	blocked := acceptanceDecode[api.TaskPage](t, process.request(context.Background(), http.MethodGet, acceptanceTasksPath(project.ID)+"?status=todo&ready=false", nil, ""), http.StatusOK)
	if len(blocked.Items) != 2 || blocked.Items[0].Ready || blocked.Items[1].Ready {
		t.Fatal("ready and status filters did not intersect before pagination")
	}
	projectPage := acceptanceDecode[api.ProjectPage](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects?limit=1", nil, ""), http.StatusOK)
	if len(projectPage.Items) != 1 || projectPage.NextCursor == nil {
		t.Fatal("project pagination omitted its continuation")
	}
	projectLast := acceptanceDecode[api.ProjectPage](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects?limit=1&cursor="+url.QueryEscape(*projectPage.NextCursor), nil, ""), http.StatusOK)
	if len(projectLast.Items) != 1 || projectLast.NextCursor != nil || projectLast.Items[0].ID == projectPage.Items[0].ID {
		t.Fatal("project pagination repeated a resource or invented a remaining page")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptanceCompete(t *testing.T, fixture *acceptanceFixture, process *acceptanceProcess, project api.Project, operations ...func() acceptanceResponse) []acceptanceResponse {
	t.Helper()
	barrier := fixture.projectLock(t, project.ID)
	results := make(chan acceptanceResponse, len(operations))
	for _, operation := range operations {
		go func() { results <- operation() }()
	}
	fixture.waitWriters(t, process, len(operations))
	acceptanceRelease(t, barrier)
	responses := make([]acceptanceResponse, 0, len(operations))
	for range operations {
		responses = append(responses, acceptanceReceive(t, results))
	}
	return responses
}

func acceptanceOneWinner(t *testing.T, responses []acceptanceResponse, code string) {
	t.Helper()
	success, refused := 0, 0
	for _, response := range responses {
		if response.status == http.StatusOK && response.err == nil {
			acceptanceDecode[api.Task](t, response, http.StatusOK)
			success++
		} else {
			acceptanceError(t, response, http.StatusConflict, code)
			refused++
		}
	}
	if success != 1 || refused != 1 {
		t.Fatalf("concurrent writes produced %d winners and %d refusals", success, refused)
	}
}

func acceptanceReverseDependencies(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project := process.project(t, "Reverse dependencies")
	first, second := process.task(t, project, "First"), process.task(t, project, "Second")
	responses := acceptanceCompete(t, fixture, process, project,
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "dependsOn": []string{second.ID}}, "reverse-first")
		},
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(second), map[string]any{"version": second.Version, "dependsOn": []string{first.ID}}, "reverse-second")
		},
	)
	acceptanceOneWinner(t, responses, "dependency_cycle")
	first, second = process.readTask(t, first), process.readTask(t, second)
	if len(first.DependsOn)+len(second.DependsOn) != 1 || first.Version+second.Version != 3 {
		t.Fatal("HTTP reverse-edge race persisted an invalid graph or version")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptanceReopenAndStart(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project := process.project(t, "Reopen and start")
	first := process.task(t, project, "Predecessor")
	first = process.update(t, first, map[string]any{"status": "done"})
	second := process.task(t, project, "Dependent", first.ID)
	responses := acceptanceCompete(t, fixture, process, project,
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(first), map[string]any{"version": first.Version, "status": "todo"}, "reopen-race")
		},
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(second), map[string]any{"version": second.Version, "status": "in_progress"}, "start-race")
		},
	)
	acceptanceOneWinner(t, responses, "dependency_unsatisfied")
	first, second = process.readTask(t, first), process.readTask(t, second)
	if second.Status == "in_progress" && first.Status != "done" || first.Status == "todo" && (second.Status != "todo" || second.Ready) {
		t.Fatal("HTTP reopen/start race violated the persistent dependency invariant")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptanceVersionRace(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project := process.project(t, "Version race")
	task := process.task(t, project, "Original")
	responses := acceptanceCompete(t, fixture, process, project,
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(task), map[string]any{"version": task.Version, "title": "First", "properties": api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "first", Title: "First"}}}}, "version-first")
		},
		func() acceptanceResponse {
			return process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(task), map[string]any{"version": task.Version, "title": "Second", "properties": api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "second", Title: "Second"}}}}, "version-second")
		},
	)
	acceptanceOneWinner(t, responses, "version_conflict")
	after := process.readTask(t, task)
	if after.Version != task.Version+1 || after.Title != "First" && after.Title != "Second" || len(after.Properties.PullRequests) != 1 || after.Properties.PullRequests[0].Title != after.Title {
		t.Fatal("HTTP version race did not commit exactly one update")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptancePartialFailure(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project := process.project(t, "Rollback")
	first, second, old := process.task(t, project, "First"), process.task(t, project, "Second"), process.task(t, project, "Old")
	target := process.task(t, project, "Original", old.ID)
	dependencies := []string{first.ID, second.ID}
	slices.Sort(dependencies)
	fixture.exec(t, fmt.Sprintf(`CREATE SEQUENCE acceptance_partial_write_progress;
		CREATE FUNCTION acceptance_reject_second_edge() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
		IF NEW.task_id='%s'::uuid AND NEW.depends_on_task_id='%s'::uuid THEN
			IF NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND title='Changed' AND description='Changed' AND version=2 AND properties::jsonb = '{"pullRequests":[{"url":"changed","title":"Changed"}]}'::jsonb)
			OR NOT EXISTS (SELECT 1 FROM task_dependencies WHERE task_id=NEW.task_id AND depends_on_task_id='%s'::uuid) THEN
				RAISE EXCEPTION USING ERRCODE='P1002', MESSAGE='acceptance-secret barrier was not reached';
			END IF;
			PERFORM nextval('acceptance_partial_write_progress');
			RAISE EXCEPTION USING ERRCODE='P1001', MESSAGE='acceptance-secret SQL driver diagnostic';
		END IF;
		RETURN NEW; END $$;
		CREATE TRIGGER acceptance_reject_second_edge BEFORE INSERT ON task_dependencies FOR EACH ROW EXECUTE FUNCTION acceptance_reject_second_edge()`, target.ID, dependencies[1], dependencies[0]))
	response := process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(target), map[string]any{"version": target.Version, "title": "Changed", "description": "Changed", "dependsOn": dependencies, "properties": api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "changed", Title: "Changed"}}}}, "partial-write")
	acceptanceError(t, response, http.StatusInternalServerError, "internal_error")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var progressed bool
	if err := fixture.admin.QueryRow(ctx, "SELECT is_called FROM acceptance_partial_write_progress").Scan(&progressed); err != nil || !progressed {
		t.Fatal("database failure was not reached after changed metadata and the first dependency edge")
	}
	if !reflect.DeepEqual(process.readTask(t, target), target) {
		t.Fatal("HTTP persistence failure left changed fields, edges, version, or timestamps")
	}
	if !process.logs.matches(map[string]any{"request_id": "partial-write", "cause": "database", "error_code": "internal_error", "component": "task", "phase": "update"}) {
		t.Fatal("storage failure lost its safe request-correlated cause")
	}
	fixture.exec(t, "DROP TRIGGER acceptance_reject_second_edge ON task_dependencies; DROP FUNCTION acceptance_reject_second_edge()")
	updated := process.update(t, target, map[string]any{"title": "Changed", "description": "Changed", "dependsOn": dependencies, "properties": api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "changed", Title: "Changed"}}}})
	if updated.Version != 2 || !slices.Equal(updated.DependsOn, dependencies) {
		t.Fatal("transaction or lock was unusable after failure rollback")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptanceCancellation(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project, other := process.project(t, "Canceled project"), process.project(t, "Independent project")
	target, independent := process.task(t, project, "Original"), process.task(t, other, "Independent")
	barrier := fixture.projectLock(t, project.ID)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	results := make(chan acceptanceResponse, 1)
	go func() {
		results <- process.request(ctx, http.MethodPatch, acceptanceTaskPath(target), map[string]any{"version": target.Version, "title": "Late write", "properties": api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "canceled", Title: "Canceled"}}}}, "canceled-update")
	}()
	fixture.waitWriters(t, process, 1)
	independent = process.update(t, independent, map[string]any{"title": "Progressed independently"})
	if independent.Title != "Progressed independently" {
		t.Fatal("unrelated project could not commit during a held project lock")
	}
	cancel()
	if response := acceptanceReceive(t, results); !errors.Is(response.err, context.Canceled) {
		t.Fatal("client cancellation did not end its actual HTTP request")
	}
	fixture.waitWriters(t, process, 0)
	acceptanceRelease(t, barrier)
	if !reflect.DeepEqual(process.readTask(t, target), target) {
		t.Fatal("canceled HTTP request performed a late write")
	}
	after := process.update(t, target, map[string]any{"title": "Reused lock"})
	if after.Version != target.Version+1 {
		t.Fatal("canceled transaction left its lock or version unusable")
	}
	ctx, done := context.WithTimeout(context.Background(), 3*time.Second)
	defer done()
	if err := acceptanceEventually(ctx, func() (bool, error) {
		return process.logs.matches(map[string]any{"request_id": "canceled-update", "cause": "canceled", "component": "task", "phase": "update"}), nil
	}); err != nil {
		t.Fatal("request cancellation was not observable with its request ID")
	}
	process.signal(t)
	process.stopped(t, 0)
}

func acceptanceGracefulShutdown(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, map[string]string{"DAYNIGHT_SHUTDOWN_TIMEOUT": "3s"}).started(t)
	project := process.project(t, "Graceful process")
	target := process.task(t, project, "Original")
	barrier := fixture.projectLock(t, project.ID)
	results := make(chan acceptanceResponse, 1)
	go func() {
		results <- process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(target), map[string]any{"version": target.Version, "title": "Drained"}, "graceful-update")
	}()
	fixture.waitWriters(t, process, 1)
	process.signal(t)
	select {
	case <-process.done:
		t.Fatal("graceful signal terminated an active request before the drain deadline")
	case <-time.After(40 * time.Millisecond):
	}
	acceptanceRelease(t, barrier)
	after := acceptanceDecode[api.Task](t, acceptanceReceive(t, results), http.StatusOK)
	if after.Title != "Drained" || after.Version != target.Version+1 {
		t.Fatal("drained request did not finish its persistent update")
	}
	process.stopped(t, 0)
	if !process.logs.matches(map[string]any{"phase": "stopped"}) {
		t.Fatal("graceful process shutdown omitted completion evidence")
	}
	restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
	if !reflect.DeepEqual(restarted.readTask(t, target), after) {
		t.Fatal("gracefully drained commit was not persistent")
	}
	restarted.signal(t)
	restarted.stopped(t, 0)
}

func acceptanceForcedShutdown(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, map[string]string{"DAYNIGHT_SHUTDOWN_TIMEOUT": "80ms"}).started(t)
	project := process.project(t, "Forced process")
	target := process.task(t, project, "Original")
	barrier := fixture.projectLock(t, project.ID)
	results := make(chan acceptanceResponse, 1)
	go func() {
		results <- process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(target), map[string]any{"version": target.Version, "title": "Late forced write"}, "forced-update")
	}()
	fixture.waitWriters(t, process, 1)
	started := time.Now()
	process.signal(t)
	process.stopped(t, 1)
	if time.Since(started) > 4*time.Second {
		t.Fatal("forced shutdown exceeded its process bound")
	}
	response := acceptanceReceive(t, results)
	if response.err == nil {
		t.Fatal("expired drain returned an HTTP success instead of aborting the request")
	}
	fixture.waitWriters(t, process, 0)
	acceptanceRelease(t, barrier)
	if !process.logs.matches(map[string]any{"request_id": "forced-update", "cause": "canceled"}) || !process.logs.matches(map[string]any{"phase": "shutdown", "cause": "deadline"}) {
		t.Fatal("forced process shutdown lost cancellation or deadline classification")
	}
	restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
	if !reflect.DeepEqual(restarted.readTask(t, target), target) {
		t.Fatal("expired process shutdown allowed a late persistent write")
	}
	restarted.signal(t)
	restarted.stopped(t, 0)
}

func acceptanceUnknownMigration(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	initial := fixture.launch(t, nil).started(t)
	initial.signal(t)
	initial.stopped(t, 0)
	fixture.exec(t, "INSERT INTO schema_migrations (version, checksum) VALUES (99, repeat('0', 64))")
	failed := fixture.launch(t, nil)
	failed.stopped(t, 1)
	if failed.logs.matches(map[string]any{"phase": "listening"}) || !failed.logs.matches(map[string]any{"phase": "startup", "diagnostic": "database migrate failed"}) {
		t.Fatal("unsupported migration history did not fail before accepting HTTP")
	}
	fixture.exec(t, "DELETE FROM schema_migrations WHERE version=99")
	recovered := fixture.launch(t, nil).started(t)
	recovered.project(t, "Recovered history")
	recovered.signal(t)
	recovered.stopped(t, 0)
}

func acceptanceFailedMigration(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	fixture.exec(t, "CREATE TABLE tasks (acceptance_marker boolean)")
	failed := fixture.launch(t, nil)
	failed.stopped(t, 1)
	if failed.logs.matches(map[string]any{"phase": "listening"}) || !failed.logs.matches(map[string]any{"phase": "startup", "diagnostic": "database migrate failed"}) {
		t.Fatal("migration SQL failure did not stop process startup")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var versions []int64
	if err := fixture.admin.QueryRow(ctx, "SELECT array_agg(version ORDER BY version) FROM schema_migrations").Scan(&versions); err != nil || !slices.Equal(versions, []int64{1}) {
		t.Fatal("failed migration did not retain exactly the earlier committed version")
	}
	if err := fixture.noSessions(ctx); err != nil {
		t.Fatal("failed migration process left database sessions or locks")
	}
	fixture.exec(t, "DROP TABLE tasks")
	recovered := fixture.launch(t, nil).started(t)
	project := recovered.project(t, "Recovered migration")
	recovered.task(t, project, "Recovered task")
	recovered.signal(t)
	recovered.stopped(t, 0)
}

func acceptanceConcurrentStartup(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	connection, err := fixture.admin.Acquire(ctx)
	if err != nil {
		t.Fatal("cannot acquire migration barrier connection")
	}
	defer connection.Release()
	const migrationLock int64 = 0x4441594e49474854
	if _, err := connection.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationLock); err != nil {
		t.Fatal("cannot acquire migration advisory barrier")
	}
	held := true
	defer func() {
		if held {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = connection.Exec(cleanup, "SELECT pg_advisory_unlock($1)", migrationLock)
		}
	}()
	first, second := fixture.launch(t, nil), fixture.launch(t, nil)
	err = acceptanceEventually(ctx, func() (bool, error) {
		var waiting int
		err := fixture.admin.QueryRow(ctx, `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid)
			WHERE a.application_name=ANY($1::text[]) AND l.locktype='advisory' AND NOT l.granted
			AND l.classid=$2::oid AND l.objid=$3::oid`, []string{first.application, second.application}, migrationLock>>32, migrationLock&0xffffffff).Scan(&waiting)
		return waiting == 2, err
	})
	if err != nil {
		t.Fatal("actual process startups did not both wait on the owned migration barrier")
	}
	if _, err := connection.Exec(ctx, "SELECT pg_advisory_unlock($1)", migrationLock); err != nil {
		t.Fatal("cannot release migration startup barrier")
	}
	held = false
	first = first.started(t)
	second = second.started(t)
	var versions []int64
	if err := fixture.admin.QueryRow(ctx, "SELECT array_agg(version ORDER BY version) FROM schema_migrations").Scan(&versions); err != nil || !slices.Equal(versions, []int64{1, 2, 3, 4, 5, 6, 7}) {
		t.Fatal("concurrent processes did not share exactly one migration ledger")
	}
	project := first.project(t, "Shared process state")
	read := acceptanceDecode[api.Project](t, second.request(context.Background(), http.MethodGet, "/api/v1/projects/"+project.ID, nil, ""), http.StatusOK)
	if !reflect.DeepEqual(project, read) {
		t.Fatal("concurrently initialized processes do not share persisted resources")
	}
	first.signal(t)
	second.signal(t)
	first.stopped(t, 0)
	second.stopped(t, 0)
}

func acceptanceProposedReads(t *testing.T, scenario *acceptanceScenario) {
	fixture := newAcceptanceFixture(t, scenario)
	process := fixture.launch(t, nil).started(t)
	project := process.project(t, "Proposed read projection")
	pending := process.task(t, project, "Pending prerequisite")
	done := process.task(t, project, "Completed prerequisite")
	done = process.update(t, done, map[string]any{"status": "done"})
	proposed := api.Task{ID: "00000000-0000-4000-8000-000000000001", ProjectID: project.ID}
	proposedBlocked := api.Task{ID: "00000000-0000-4000-8000-000000000002", ProjectID: project.ID}
	fixture.exec(t, `INSERT INTO tasks (id, project_id, title, description, status, version)
		VALUES ($1, $3, 'Proposed', 'Complete proposed description', 'proposed', 17),
		($2, $3, 'Proposed with prerequisite', '', 'proposed', 19)`, proposed.ID, proposedBlocked.ID, project.ID)
	fixture.exec(t, `INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id)
		VALUES ($1, $2, $4), ($1, $3, $5)`, project.ID, proposed.ID, proposedBlocked.ID, done.ID, pending.ID)
	proposed = process.readTask(t, proposed)
	proposedBlocked = process.readTask(t, proposedBlocked)
	if proposed.Status != "proposed" || proposed.Ready || proposed.Version != 17 || proposed.Description != "Complete proposed description" ||
		len(proposed.BlockedBy) != 0 || proposedBlocked.Status != "proposed" || proposedBlocked.Ready || proposedBlocked.Version != 19 ||
		!slices.Equal(proposedBlocked.BlockedBy, []string{pending.ID}) {
		t.Fatal("migrated proposed rows did not retain detail/readiness projection")
	}
	dependent := process.task(t, project, "Waiting for proposal", proposed.ID)
	if dependent.Status != "todo" || dependent.Ready || !slices.Equal(dependent.BlockedBy, []string{proposed.ID}) {
		t.Fatal("proposed prerequisite did not block the existing todo creation path")
	}
	var ids []string
	path := acceptanceTasksPath(project.ID) + "?limit=2"
	for {
		page := acceptanceDecode[api.TaskPage](t, process.request(context.Background(), http.MethodGet, path, nil, ""), http.StatusOK)
		for _, task := range page.Items {
			ids = append(ids, task.ID)
			if task.ID == proposed.ID && (task.Status != "proposed" || task.Ready || task.Version != 17 || task.Description != proposed.Description) {
				t.Fatal("paginated proposed task lost its detail projection")
			}
		}
		if page.NextCursor == nil {
			break
		}
		path = acceptanceTasksPath(project.ID) + "?limit=2&cursor=" + url.QueryEscape(*page.NextCursor)
	}
	wantIDs := []string{pending.ID, done.ID, proposed.ID, proposedBlocked.ID, dependent.ID}
	slices.Sort(ids)
	slices.Sort(wantIDs)
	if !slices.Equal(ids, wantIDs) {
		t.Fatal("paginated inventory omitted or repeated a proposed row")
	}
	ready := acceptanceDecode[api.TaskPage](t, process.request(context.Background(), http.MethodGet, acceptanceTasksPath(project.ID)+"?ready=true", nil, ""), http.StatusOK)
	if len(ready.Items) != 1 || ready.Items[0].ID != pending.ID {
		t.Fatal("proposed row appeared in the ready inventory")
	}
	graph := acceptanceDecode[api.TaskGraph](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects/"+project.ID+"/task-graph", nil, ""), http.StatusOK)
	if graph.Summary != (api.TaskGraphSummary{Total: 5, Proposed: 2, Todo: 2, Done: 1, Ready: 1, Blocked: 1}) || len(graph.Tasks) != 5 {
		t.Fatal("built process did not project the complete four-state summary")
	}
	for _, task := range graph.Tasks {
		if task.ID == proposed.ID && (task.Status != "proposed" || task.Ready || len(task.BlockedBy) != 0) ||
			task.ID == proposedBlocked.ID && (task.Status != "proposed" || task.Ready || !slices.Equal(task.BlockedBy, proposedBlocked.BlockedBy)) {
			t.Fatal("built graph changed proposed readiness or prerequisite projection")
		}
	}
	acceptanceError(t, process.request(context.Background(), http.MethodGet, acceptanceTasksPath(project.ID)+"?status=proposed", nil, ""), http.StatusBadRequest, "invalid_input")
	acceptanceError(t, process.request(context.Background(), http.MethodPatch, acceptanceTaskPath(pending), map[string]any{"version": pending.Version, "status": "proposed"}, ""), http.StatusBadRequest, "invalid_input")
	if after := process.readTask(t, pending); !reflect.DeepEqual(after, pending) {
		t.Fatal("rejected proposed status write changed the existing creation result")
	}
	process.signal(t)
	process.stopped(t, 0)
	restarted := fixture.launch(t, nil).started(t)
	if !reflect.DeepEqual(restarted.readTask(t, proposed), proposed) || !reflect.DeepEqual(restarted.readTask(t, proposedBlocked), proposedBlocked) {
		t.Fatal("proposed detail projection changed across migration recheck and restart")
	}
	restarted.signal(t)
	restarted.stopped(t, 0)
}
