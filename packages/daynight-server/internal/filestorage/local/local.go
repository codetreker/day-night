package local

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"
	"sync"
	"syscall"

	"github.com/codetreker/daynight/packages/daynight-server/internal/filestorage"
)

var ErrCaseInsensitive = errors.New("file storage root must distinguish uppercase and lowercase names")

type Storage struct {
	root      *os.Root
	namespace sync.Mutex
}

var _ filestorage.Storage = (*Storage)(nil)

func New(root string) (*Storage, error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	directory, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	if err := checkCaseSensitive(directory); err != nil {
		return nil, errors.Join(err, directory.Close())
	}
	return &Storage{root: directory}, nil
}

func (s *Storage) Close() error {
	return s.root.Close()
}

func (s *Storage) Put(ctx context.Context, bucket, name string, content io.Reader) (info filestorage.FileInfo, result error) {
	address, err := checkedAddress(ctx, bucket, name)
	if err != nil {
		return info, err
	}
	file, temporary, err := s.beginPut(address)
	if err != nil {
		return info, err
	}
	defer func() {
		if temporary != "" {
			result = errors.Join(result, s.discard(temporary))
		}
	}()
	size, copyErr := io.Copy(file, contextReader{ctx: ctx, reader: content})
	result = errors.Join(copyErr, ctx.Err(), file.Close())
	if result != nil {
		return info, result
	}
	if err := s.publish(temporary, address); err != nil {
		return info, err
	}
	temporary = ""
	return filestorage.FileInfo{Size: size}, nil
}

func (s *Storage) Open(ctx context.Context, bucket, name string) (filestorage.Object, error) {
	address, err := checkedAddress(ctx, bucket, name)
	if err != nil {
		return filestorage.Object{}, err
	}
	if err := s.regular(address); err != nil {
		return filestorage.Object{}, err
	}
	file, err := s.root.Open(address)
	if err != nil {
		return filestorage.Object{}, err
	}
	info, err := file.Stat()
	if err == nil && !info.Mode().IsRegular() {
		err = filestorage.ErrNotRegular
	}
	if err != nil {
		return filestorage.Object{}, errors.Join(err, file.Close())
	}
	return filestorage.Object{
		Body: &contextFile{file: file, ctx: ctx},
		Info: filestorage.FileInfo{Size: info.Size()},
	}, nil
}

func (s *Storage) Delete(ctx context.Context, bucket, name string) error {
	address, err := checkedAddress(ctx, bucket, name)
	if err != nil {
		return err
	}
	s.namespace.Lock()
	defer s.namespace.Unlock()
	if err := s.regular(address); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := s.root.Remove(address); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return s.pruneParents(address)
}

func checkedAddress(ctx context.Context, bucket, name string) (string, error) {
	if err := filestorage.ValidateAddress(bucket, name); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return bucket + "/" + name, nil
}

func (s *Storage) beginPut(address string) (file *os.File, temporary string, result error) {
	s.namespace.Lock()
	defer s.namespace.Unlock()
	defer func() {
		if result != nil {
			result = errors.Join(result, s.pruneParents(address))
		}
	}()
	if err := s.root.MkdirAll(path.Dir(address), 0o700); err != nil {
		return nil, "", err
	}
	if err := s.fileTarget(address, false); err != nil {
		return nil, "", err
	}
	temporary = path.Join(path.Dir(address), ".daynight-upload-"+rand.Text())
	file, err := s.root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	return file, temporary, err
}

func (s *Storage) publish(temporary, address string) error {
	s.namespace.Lock()
	defer s.namespace.Unlock()
	if err := s.fileTarget(address, true); err != nil {
		return err
	}
	return s.root.Rename(temporary, address)
}

func (s *Storage) discard(temporary string) error {
	s.namespace.Lock()
	defer s.namespace.Unlock()
	if err := s.root.Remove(temporary); err != nil {
		return err
	}
	return s.pruneParents(temporary)
}

func (s *Storage) pruneParents(address string) error {
	for directory := path.Dir(address); strings.Contains(directory, "/"); directory = path.Dir(directory) {
		info, err := s.root.Lstat(directory)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return nil
		}
		err = s.root.Remove(directory)
		if errors.Is(err, syscall.ENOTEMPTY) || errors.Is(err, syscall.EEXIST) {
			return nil
		}
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}

// Empty physical directories are reusable names; active child uploads keep them
// nonempty. The namespace lock excludes this instance's publishers and deleters
// while an empty directory is checked and removed.
func (s *Storage) fileTarget(address string, replaceEmpty bool) error {
	info, err := s.root.Lstat(address)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode().IsRegular() {
		return nil
	}
	if !info.IsDir() {
		return fmt.Errorf("%w: %s", filestorage.ErrNotRegular, address)
	}
	directory, err := s.root.Open(address)
	if err != nil {
		return err
	}
	entries, readErr := directory.ReadDir(1)
	closeErr := directory.Close()
	if readErr != nil && readErr != io.EOF {
		return errors.Join(readErr, closeErr)
	}
	if closeErr != nil {
		return closeErr
	}
	if len(entries) != 0 {
		return fmt.Errorf("%w: %s", filestorage.ErrNotRegular, address)
	}
	if replaceEmpty {
		return s.root.Remove(address)
	}
	return nil
}

func (s *Storage) regular(address string) error {
	info, err := s.root.Lstat(address)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: %s", filestorage.ErrNotRegular, address)
	}
	return nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	count, err := r.reader.Read(buffer)
	if contextErr := r.ctx.Err(); contextErr != nil {
		return count, errors.Join(err, contextErr)
	}
	return count, err
}

// Keep optimized io.Copy paths from bypassing the context-aware Read method.
type contextFile struct {
	file *os.File
	ctx  context.Context
}

func (f *contextFile) Read(buffer []byte) (int, error) {
	return (contextReader{ctx: f.ctx, reader: f.file}).Read(buffer)
}

func (f *contextFile) Close() error {
	return errors.Join(f.ctx.Err(), f.file.Close())
}

func checkCaseSensitive(root *os.Root) (result error) {
	name := ".daynight-case-" + rand.Text()
	if err := root.Mkdir(name, 0o700); err != nil {
		return err
	}
	defer func() { result = errors.Join(result, root.RemoveAll(name)) }()
	if err := createProbeFile(root, name+"/A"); err != nil {
		return err
	}
	err := createProbeFile(root, name+"/a")
	if errors.Is(err, fs.ErrExist) {
		return ErrCaseInsensitive
	}
	return err
}

func createProbeFile(root *os.Root, name string) error {
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return file.Close()
}
