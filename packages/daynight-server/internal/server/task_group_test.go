package server

import (
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func TestTaskHTTPExplicitGroupsAndStrictInputs(t *testing.T) {
	handler := projectTestHandler(t, projectTestStore(t), io.Discard)
	project := taskProject(t, handler)
	anchor := createHTTPTask(t, handler, project.ID, "Anchor")
	other := createHTTPTask(t, handler, project.ID, "Other anchor")
	if anchor.GroupID != anchor.ID || other.GroupID != other.ID {
		t.Fatal("omitted group did not create a task-owned group")
	}
	member := decodeResponse[api.Task](t, projectRequest(handler, http.MethodPost, taskCollection(project.ID),
		jsonBody(t, map[string]any{"title": "Member", "groupId": strings.ToUpper(anchor.ID)})), http.StatusCreated)
	if member.GroupID != anchor.ID || len(member.DependsOn) != 0 {
		t.Fatalf("group membership implicitly changed dependencies: %#v", member)
	}
	for _, value := range []any{nil, false, 1, []string{}, "", "invalid", member.ID} {
		assertProjectError(t, projectRequest(handler, http.MethodPost, taskCollection(project.ID),
			jsonBody(t, map[string]any{"title": "Invalid group", "groupId": value})), http.StatusBadRequest, "invalid_input")
		assertProjectError(t, projectRequest(handler, http.MethodPatch, taskPath(other),
			jsonBody(t, map[string]any{"version": other.Version, "groupId": value})), http.StatusBadRequest, "invalid_input")
	}
	if after := readHTTPTask(t, handler, other); !reflect.DeepEqual(after, other) {
		t.Fatal("invalid group patch mutated the task")
	}
	member = updateHTTPTask(t, handler, member, map[string]any{"dependsOn": []string{other.ID}})
	if member.GroupID != anchor.ID {
		t.Fatal("dependency update changed the saved group")
	}
	graph := decodeResponse[api.TaskGraph](t, projectRequest(handler, http.MethodGet, graphPath(project.ID), ""), http.StatusOK)
	page := decodeResponse[api.TaskPage](t, projectRequest(handler, http.MethodGet, taskCollection(project.ID), ""), http.StatusOK)
	if len(graph.Tasks) != 3 || graph.Tasks[2].GroupID != anchor.ID || len(page.Items) != 3 || !reflect.DeepEqual(page.Items[2], member) {
		t.Fatalf("task read projections lost group membership: %#v %#v", graph, page)
	}
	assertProjectError(t, projectRequest(handler, http.MethodPatch, taskPath(anchor),
		jsonBody(t, map[string]any{"version": anchor.Version, "groupId": other.ID})), http.StatusBadRequest, "invalid_input")
	member = updateHTTPTask(t, handler, member, map[string]any{"groupId": member.ID})
	if member.GroupID != member.ID || len(member.DependsOn) != 1 || member.DependsOn[0] != other.ID {
		t.Fatalf("explicit split changed dependencies: %#v", member)
	}
	anchor = updateHTTPTask(t, handler, anchor, map[string]any{"groupId": other.ID})
	if anchor.GroupID != other.ID {
		t.Fatal("empty anchor could not join another group through HTTP")
	}
}
