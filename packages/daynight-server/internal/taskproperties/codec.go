package taskproperties

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/jsonobject"
)

type pullRequestDocument struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

type document struct {
	PullRequests []pullRequestDocument `json:"pullRequests"`
}

func Encode(properties core.TaskProperties) string {
	value := document{PullRequests: make([]pullRequestDocument, len(properties.PullRequests))}
	for index, item := range properties.PullRequests {
		value.PullRequests[index] = pullRequestDocument{URL: item.URL, Title: item.Title}
	}
	// This fixed document contains only strings and arrays, which cannot fail JSON encoding.
	data, _ := json.Marshal(value)
	return string(data)
}

func Decode(data []byte) (core.TaskProperties, error) {
	patch, err := DecodePatch(data)
	if err != nil {
		return core.TaskProperties{}, err
	}
	if patch.PullRequests == nil {
		return core.TaskProperties{}, fmt.Errorf("properties.pullRequests is required")
	}
	return core.TaskProperties{PullRequests: *patch.PullRequests}, nil
}

func DecodePatch(data []byte) (core.TaskPropertiesPatch, error) {
	fields, err := jsonobject.Decode(data, "properties", "pullRequests")
	if err != nil {
		return core.TaskPropertiesPatch{}, err
	}
	raw, exists := fields["pullRequests"]
	if !exists {
		return core.TaskPropertiesPatch{}, nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return core.TaskPropertiesPatch{}, fmt.Errorf("properties.pullRequests must be an array")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return core.TaskPropertiesPatch{}, fmt.Errorf("properties.pullRequests must be an array")
	}
	values := make([]core.PullRequestProperty, 0, len(items))
	for index, item := range items {
		path := fmt.Sprintf("properties.pullRequests[%d]", index)
		fields, err := jsonobject.Decode(item, path, "url", "title")
		if err != nil {
			return core.TaskPropertiesPatch{}, err
		}
		url, err := stringField(fields, "url", path)
		if err != nil {
			return core.TaskPropertiesPatch{}, err
		}
		title, err := stringField(fields, "title", path)
		if err != nil {
			return core.TaskPropertiesPatch{}, err
		}
		values = append(values, core.PullRequestProperty{URL: url, Title: title})
	}
	return core.TaskPropertiesPatch{PullRequests: &values}, nil
}

func stringField(fields map[string]json.RawMessage, key, path string) (string, error) {
	raw, exists := fields[key]
	var value string
	if !exists || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil {
		return "", fmt.Errorf("%s.%s is required and must be a string", path, key)
	}
	return value, nil
}
