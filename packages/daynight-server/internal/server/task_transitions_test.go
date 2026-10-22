package server

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func TestTaskHTTPTransitionsRejectWrongPredecessorsAndStaleVersions(t *testing.T) {
	var logs bytes.Buffer
	handler := projectTestHandler(projectTestStore(t), &logs)
	project := taskProject(t, handler)
	states := []struct {
		name    string
		actions []string
		next    string
	}{
		{"proposed", nil, "approve"},
		{"todo", []string{"approve"}, "claim"},
		{"in_progress", []string{"approve", "claim"}, "complete"},
		{"done", []string{"approve", "claim", "complete"}, ""},
	}
	for _, state := range states {
		t.Run(state.name, func(t *testing.T) {
			task := createHTTPTask(t, handler, project.ID, "private-title-secret")
			for _, action := range state.actions {
				task = transitionHTTPTask(t, handler, task, action)
			}
			if task.Status != state.name {
				t.Fatalf("fixture state: %+v", task)
			}
			for _, action := range []string{"approve", "claim", "complete"} {
				path := taskPath(task) + "/" + action
				assertProjectError(t, projectRequest(handler, http.MethodPost, path,
					jsonBody(t, api.TaskTransitionRequest{Version: task.Version + 1})), http.StatusConflict, "version_conflict")
				if action != state.next {
					response := projectRequest(handler, http.MethodPost, path, jsonBody(t, api.TaskTransitionRequest{Version: task.Version}))
					assertProjectError(t, response, http.StatusConflict, "invalid_transition")
					if strings.Contains(response.Body.String(), "secret") {
						t.Fatalf("transition error exposed task content: %s", response.Body)
					}
				}
				if !reflect.DeepEqual(readHTTPTask(t, handler, task), task) {
					t.Fatal("rejected transition changed task fields, edges, version or time")
				}
			}
		})
	}
	for _, fragment := range []string{`"cause":"invalid_transition"`, `"error_code":"invalid_transition"`, `"route":"POST /api/v1/projects/{projectId}/tasks/{taskId}/approve"`, `"phase":"claim"`, `"phase":"complete"`} {
		if !strings.Contains(logs.String(), fragment) {
			t.Fatalf("missing lifecycle diagnostic %s: %s", fragment, &logs)
		}
	}
	if strings.Contains(logs.String(), "secret") {
		t.Fatalf("task content leaked into lifecycle logs: %s", &logs)
	}
}

func TestTaskHTTPTransitionStrictBodiesQueriesAndMethods(t *testing.T) {
	handler := projectTestHandler(projectTestStore(t), io.Discard)
	project := taskProject(t, handler)
	task := createHTTPTask(t, handler, project.ID, "Original")
	for _, action := range []string{"approve", "claim", "complete"} {
		t.Run(action, func(t *testing.T) {
			path := taskPath(task) + "/" + action
			for _, body := range []string{
				"", "null", "[]", "{", `{"version":1,}`, `{"version":1} {}`, `{}`,
				`{"version":null}`, `{"version":0}`, `{"version":-1}`, `{"version":"1"}`,
				`{"version":true}`, `{"version":[]}`, `{"version":{}}`, `{"version":1.0}`,
				`{"version":1e0}`, `{"version":9223372036854775808}`, `{"Version":1}`,
				`{"version":1,"version":1}`, `{"version":1,"ver\u0073ion":1}`,
				`{"version":1,"status":"todo"}`, `{"version":1,"title":"changed"}`,
				`{"version":1,"unknown":"private-body-secret"}`, `{"version":1,"dependsOn":[]}`,
			} {
				t.Run(body, func(t *testing.T) {
					assertProjectError(t, projectRequest(handler, http.MethodPost, path, body), http.StatusBadRequest, "invalid_input")
				})
			}
			for _, query := range []string{"version=1", "unknown=secret", "x=1&x=2", "x=%xx", "x=1;y=2", "&", "="} {
				assertProjectError(t, projectRequest(handler, http.MethodPost, path+"?"+query, `{"version":1}`), http.StatusBadRequest, "invalid_input")
			}
			for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPatch, http.MethodPut, http.MethodDelete, http.MethodOptions} {
				response := projectRequest(handler, method, path, `{"version":1}`)
				assertProjectError(t, response, http.StatusMethodNotAllowed, "method_not_allowed")
				if response.Header().Get("Allow") != "POST" {
					t.Fatalf("wrong lifecycle Allow header: %s", response.Header().Get("Allow"))
				}
			}
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"version":1}`))
			request.Header.Set("Content-Type", "text/plain")
			request.Header.Set("X-Request-ID", "project-test")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			assertProjectError(t, response, http.StatusBadRequest, "invalid_input")
			if !reflect.DeepEqual(readHTTPTask(t, handler, task), task) {
				t.Fatal("malformed lifecycle request mutated task")
			}
		})
	}
	assertProjectError(t, projectRequest(handler, http.MethodPost, taskPath(task)+"/approve", `{"version":9223372036854775807}`), http.StatusConflict, "version_conflict")
}

func TestTaskHTTPTransitionResourceScopeAndCanonicalIDs(t *testing.T) {
	var logs bytes.Buffer
	handler := projectTestHandler(projectTestStore(t), &logs)
	project, other := taskProject(t, handler), taskProject(t, handler)
	task := createHTTPTask(t, handler, project.ID, "private-title-secret")
	missing := "00000000-0000-4000-8000-000000000099"
	for _, action := range []string{"approve", "claim", "complete"} {
		for _, projectID := range []string{other.ID, missing} {
			assertProjectError(t, projectRequest(handler, http.MethodPost, taskCollection(projectID)+"/"+task.ID+"/"+action, `{"version":1}`), http.StatusNotFound, "not_found")
		}
		assertProjectError(t, projectRequest(handler, http.MethodPost, taskCollection(project.ID)+"/"+missing+"/"+action, `{"version":1}`), http.StatusNotFound, "not_found")
		for _, path := range []string{taskCollection("private-invalid-project-secret") + "/" + task.ID, taskCollection(project.ID) + "/private-invalid-task-secret"} {
			assertProjectError(t, projectRequest(handler, http.MethodPost, path+"/"+action, `{"version":1}`), http.StatusBadRequest, "invalid_input")
		}
	}
	approved := decodeResponse[api.Task](t, projectRequest(handler, http.MethodPost,
		taskCollection(strings.ToUpper(project.ID))+"/"+strings.ToUpper(task.ID)+"/approve", `{"version":1}`), http.StatusOK)
	if approved.ID != task.ID || approved.ProjectID != project.ID || approved.Status != "todo" || approved.Version != 2 {
		t.Fatalf("canonical lifecycle IDs: %+v", approved)
	}
	if strings.Contains(logs.String(), "secret") {
		t.Fatalf("lifecycle resource diagnostics leaked raw IDs or content: %s", &logs)
	}
}

func TestTaskHTTPTransitionRacesHaveOneWinner(t *testing.T) {
	handler := projectTestHandler(projectTestStore(t), io.Discard)
	project := taskProject(t, handler)
	task := createHTTPTask(t, handler, project.ID, "Concurrent lifecycle")
	for _, step := range []struct{ action, status string }{{"approve", "todo"}, {"claim", "in_progress"}, {"complete", "done"}} {
		t.Run(step.action, func(t *testing.T) {
			body := jsonBody(t, api.TaskTransitionRequest{Version: task.Version})
			start := make(chan struct{})
			responses := make(chan *httptest.ResponseRecorder, 2)
			for range 2 {
				go func() {
					<-start
					responses <- projectRequest(handler, http.MethodPost, taskPath(task)+"/"+step.action, body)
				}()
			}
			close(start)
			var winner api.Task
			won, lost := 0, 0
			for range 2 {
				response := <-responses
				switch response.Code {
				case http.StatusOK:
					winner = decodeResponse[api.Task](t, response, http.StatusOK)
					won++
				case http.StatusConflict:
					assertProjectError(t, response, http.StatusConflict, "version_conflict")
					lost++
				default:
					t.Fatalf("unexpected concurrent action response: %d %s", response.Code, response.Body)
				}
			}
			if won != 1 || lost != 1 || winner.Status != step.status || winner.Version != task.Version+1 || !reflect.DeepEqual(readHTTPTask(t, handler, task), winner) {
				t.Fatalf("concurrent lifecycle outcome: winners=%d conflicts=%d task=%+v", won, lost, winner)
			}
			task = winner
		})
	}
}
