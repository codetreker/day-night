package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

type listCursor struct {
	Version   int       `json:"version"`
	Kind      string    `json:"kind"`
	ProjectID string    `json:"projectId"`
	Status    *string   `json:"status"`
	Ready     *bool     `json:"ready"`
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func projectListPage(request PageRequest) (store.Page, error) {
	if request.Limit < 1 || request.Limit > 100 {
		return store.Page{}, invalidInput("Limit must be between 1 and 100.")
	}
	page := store.Page{Limit: request.Limit}
	if request.Cursor == nil {
		return page, nil
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(*request.Cursor)
	if err != nil {
		return store.Page{}, invalidInput("Cursor is invalid for this list.")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var cursor listCursor
	if err := decoder.Decode(&cursor); err != nil {
		return store.Page{}, invalidInput("Cursor is invalid for this list.")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return store.Page{}, invalidInput("Cursor is invalid for this list.")
	}
	id, err := CanonicalID(cursor.ID)
	if err != nil || id != cursor.ID || cursor.Version != 1 || cursor.Kind != "projects" ||
		cursor.ProjectID != "" || cursor.Status != nil || cursor.Ready != nil || cursor.CreatedAt.IsZero() {
		return store.Page{}, invalidInput("Cursor is invalid for this list.")
	}
	page.After = &store.Position{CreatedAt: cursor.CreatedAt, ID: id}
	return page, nil
}

func encodeProjectCursor(project core.Project) (string, error) {
	cursor := listCursor{Version: 1, Kind: "projects", CreatedAt: project.CreatedAt, ID: project.ID}
	data, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}
