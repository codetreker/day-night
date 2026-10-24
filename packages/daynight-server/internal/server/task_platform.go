package server

import (
	"encoding/json"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

func optionalRequiredPlatform(fields map[string]json.RawMessage) (**string, error) {
	raw, exists := fields["requiredPlatform"]
	if !exists {
		return nil, nil
	}
	var value *string
	if err := json.Unmarshal(raw, &value); err != nil || value != nil && !core.TaskPlatform(*value).Valid() {
		return nil, invalidInput("requiredPlatform must be windows, linux, macos or null")
	}
	return &value, nil
}

func platformValue(value *string) *core.TaskPlatform {
	if value == nil {
		return nil
	}
	platform := core.TaskPlatform(*value)
	return &platform
}

func platformPatch(value **string) **core.TaskPlatform {
	if value == nil {
		return nil
	}
	platform := platformValue(*value)
	return &platform
}

func platformResponse(value *core.TaskPlatform) *string {
	if value == nil {
		return nil
	}
	platform := string(*value)
	return &platform
}
