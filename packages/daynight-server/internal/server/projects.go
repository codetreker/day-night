package server

import (
	"log/slog"
	"net/http"

	"github.com/codetreker/daynight/packages/daynight-server/api"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/service"
)

type projectHandler struct {
	projects *service.Projects
	logger   *slog.Logger
}

func New(projects *service.Projects, tasks *service.Tasks, logger *slog.Logger) http.Handler {
	handler := &projectHandler{projects: projects, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/projects", handler.create)
	mux.HandleFunc("GET /api/v1/projects", handler.list)
	mux.HandleFunc("GET /api/v1/projects/{projectId}", handler.get)
	mux.HandleFunc("/api/v1/projects", methodNotAllowed(logger, "GET, HEAD, POST"))
	mux.HandleFunc("/api/v1/projects/{projectId}", methodNotAllowed(logger, "GET, HEAD"))
	taskRoutes(mux, tasks, logger)
	uiRoutes(mux, logger)
	mux.HandleFunc("/", func(w http.ResponseWriter, request *http.Request) {
		writeError(w, request, logger, "server", "route", &service.Fault{Code: "not_found", Message: "resource not found"})
	})
	return mux
}

func projectResponse(project core.Project) api.Project {
	return api.Project{ID: project.ID, Name: project.Name, RepoURL: project.RepoURL,
		CreatedAt: project.CreatedAt.UTC(), UpdatedAt: project.UpdatedAt.UTC()}
}

func (h *projectHandler) create(w http.ResponseWriter, request *http.Request) {
	fields, err := decodeObject(w, request, "name", "repoUrl")
	if err != nil {
		writeError(w, request, h.logger, "project", "create", err)
		return
	}
	name, err := requiredString(fields, "name")
	if err != nil {
		writeError(w, request, h.logger, "project", "create", err)
		return
	}
	repoURL, err := requiredString(fields, "repoUrl")
	if err != nil {
		writeError(w, request, h.logger, "project", "create", err)
		return
	}
	input := api.CreateProjectRequest{Name: name, RepoURL: repoURL}
	project, err := h.projects.Create(request.Context(), service.CreateProject{Name: input.Name, RepoURL: input.RepoURL})
	if err != nil {
		writeError(w, request, h.logger, "project", "create", err)
		return
	}
	h.logger.InfoContext(request.Context(), "project created", "type", "resource", "component", "project", "phase", "create",
		"project_id", project.ID, "request_id", RequestID(request.Context()))
	writeCreated(w, request, h.logger.With("project_id", project.ID), "/api/v1/projects/"+project.ID, projectResponse(project))
}

func (h *projectHandler) list(w http.ResponseWriter, request *http.Request) {
	page, err := pageRequest(request)
	if err != nil {
		writeError(w, request, h.logger, "project", "list", err)
		return
	}
	result, err := h.projects.List(request.Context(), page)
	if err != nil {
		writeError(w, request, h.logger, "project", "list", err)
		return
	}
	response := api.ProjectPage{Items: make([]api.Project, 0, len(result.Items)), NextCursor: result.NextCursor}
	for _, project := range result.Items {
		response.Items = append(response.Items, projectResponse(project))
	}
	writeJSON(w, request, h.logger, http.StatusOK, response)
}

func (h *projectHandler) get(w http.ResponseWriter, request *http.Request) {
	id, err := service.CanonicalID(request.PathValue("projectId"))
	if err != nil {
		writeError(w, request, h.logger, "project", "get", err)
		return
	}
	logger := h.logger.With("project_id", id)
	project, err := h.projects.Get(request.Context(), id)
	if err != nil {
		writeError(w, request, logger, "project", "get", err)
		return
	}
	h.logger.InfoContext(request.Context(), "project read", "type", "resource", "component", "project", "phase", "get",
		"project_id", id, "request_id", RequestID(request.Context()))
	writeJSON(w, request, logger, http.StatusOK, projectResponse(project))
}
