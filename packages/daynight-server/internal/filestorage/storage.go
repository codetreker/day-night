package filestorage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalidAddress = errors.New("invalid file storage address")
	ErrNotRegular     = errors.New("file storage object is not a regular file")
)

type FileInfo struct {
	Size int64
}

type Object struct {
	Body io.ReadCloser
	Info FileInfo
}

type Storage interface {
	Put(ctx context.Context, bucket, path string, content io.Reader) (FileInfo, error)
	Open(ctx context.Context, bucket, path string) (Object, error)
	Delete(ctx context.Context, bucket, path string) error
}

// ValidateAddress preserves each accepted name; callers must not clean or normalize it.
func ValidateAddress(bucket, path string) error {
	if strings.Contains(bucket, "/") {
		return fmt.Errorf("%w: bucket must be one path segment", ErrInvalidAddress)
	}
	if err := validatePath(bucket); err != nil {
		return fmt.Errorf("bucket: %w", err)
	}
	return validatePath(path)
}

func validatePath(path string) error {
	if !utf8.ValidString(path) {
		return fmt.Errorf("%w: invalid UTF-8", ErrInvalidAddress)
	}
	if len(path) >= 3 && path[1] == ':' && path[2] == '/' && ((path[0] >= 'a' && path[0] <= 'z') || (path[0] >= 'A' && path[0] <= 'Z')) {
		return fmt.Errorf("%w: absolute drive path", ErrInvalidAddress)
	}
	for _, char := range path {
		if char == '\\' || unicode.IsControl(char) {
			return fmt.Errorf("%w: backslash or control character", ErrInvalidAddress)
		}
	}
	for segment := range strings.SplitSeq(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("%w: empty, dot, or parent segment", ErrInvalidAddress)
		}
	}
	return nil
}
