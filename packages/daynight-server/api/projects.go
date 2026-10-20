package api

import "time"

type CreateProjectRequest struct {
	Name    string `json:"name"`
	RepoURL string `json:"repoUrl"`
}

type Project struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	RepoURL   string    `json:"repoUrl"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectPage struct {
	Items      []Project `json:"items"`
	NextCursor *string   `json:"nextCursor"`
}

type ErrorDetails struct {
	TaskIDs   []string `json:"taskIds,omitempty"`
	NodeCount *int64   `json:"nodeCount,omitempty"`
	EdgeCount *int64   `json:"edgeCount,omitempty"`
	MaxNodes  *int64   `json:"maxNodes,omitempty"`
	MaxEdges  *int64   `json:"maxEdges,omitempty"`
}

type Error struct {
	Code      string        `json:"code"`
	Message   string        `json:"message"`
	RequestID string        `json:"requestId"`
	Details   *ErrorDetails `json:"details,omitempty"`
}

type ErrorResponse struct {
	Error Error `json:"error"`
}
