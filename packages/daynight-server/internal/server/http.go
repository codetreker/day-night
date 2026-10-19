package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/codetreker/daynight/packages/daynight-server/api"
	"github.com/codetreker/daynight/packages/daynight-server/internal/service"
)

const maxJSONBody = 1 << 20

func invalidInput(message string) error {
	return &service.Fault{Code: "invalid_input", Message: message}
}

func decodeObject(w http.ResponseWriter, request *http.Request, allowed ...string) (map[string]json.RawMessage, error) {
	mediaType, parameters, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" || parameters["charset"] != "" && !strings.EqualFold(parameters["charset"], "utf-8") {
		return nil, invalidInput("Content-Type must be application/json with UTF-8 encoding")
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, request.Body, maxJSONBody))
	if err != nil || !utf8.Valid(body) {
		return nil, invalidInput("request body must be valid JSON within the 1 MiB limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil, invalidInput("request body must be one JSON object")
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, invalidInput("request body must be valid JSON")
		}
		key, ok := token.(string)
		if !ok || !containsField(allowed, key) {
			return nil, invalidInput("request body contains an unknown or read-only field")
		}
		if _, exists := fields[key]; exists {
			return nil, invalidInput("request body contains a duplicate field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, invalidInput("request body must be valid JSON")
		}
		fields[key] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, invalidInput("request body must be valid JSON")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, invalidInput("request body must contain exactly one JSON object")
	}
	return fields, nil
}

func containsField(allowed []string, key string) bool {
	for _, field := range allowed {
		if key == field {
			return true
		}
	}
	return false
}

func requiredString(fields map[string]json.RawMessage, key string) (string, error) {
	raw, exists := fields[key]
	if !exists || bytes.Equal(raw, []byte("null")) {
		return "", invalidInput(key + " is required and must be a string")
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", invalidInput(key + " must be a string")
	}
	return value, nil
}

func pageRequest(request *http.Request) (service.PageRequest, error) {
	values, err := url.ParseQuery(request.URL.RawQuery)
	if err != nil {
		return service.PageRequest{}, invalidInput("query parameters must be valid URL encoding")
	}
	page := service.PageRequest{Limit: 50}
	for key, values := range values {
		if len(values) != 1 {
			return service.PageRequest{}, invalidInput("query parameters must occur once")
		}
		switch key {
		case "limit":
			page.Limit, err = strconv.Atoi(values[0])
			if err != nil || page.Limit < 1 || page.Limit > 100 {
				return service.PageRequest{}, invalidInput("limit must be an integer from 1 to 100")
			}
		case "cursor":
			if values[0] == "" {
				return service.PageRequest{}, invalidInput("cursor must not be empty")
			}
			page.Cursor = &values[0]
		default:
			return service.PageRequest{}, invalidInput("query contains an unknown parameter")
		}
	}
	return page, nil
}

func writeJSON(w http.ResponseWriter, request *http.Request, logger *slog.Logger, status int, value any) {
	if request.Context().Err() != nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		LogFailure(logger, request.Context(), "server", "response", err)
	}
}

func writeError(w http.ResponseWriter, request *http.Request, logger *slog.Logger, phase string, err error) {
	LogFailure(logger, request.Context(), "project", phase, err)
	if request.Context().Err() != nil {
		return
	}
	status := http.StatusInternalServerError
	response := api.Error{Code: "internal_error", Message: "internal server error", RequestID: RequestID(request.Context())}
	var fault *service.Fault
	if errors.As(err, &fault) {
		switch fault.Code {
		case "invalid_input":
			status = http.StatusBadRequest
		case "not_found":
			status = http.StatusNotFound
		}
		if status != http.StatusInternalServerError {
			response.Code, response.Message = fault.Code, fault.Message
			if len(fault.TaskIDs) > 0 {
				response.Details = &api.ErrorDetails{TaskIDs: fault.TaskIDs}
			}
		}
	}
	writeJSON(w, request, logger, status, api.ErrorResponse{Error: response})
}
