package taskproperties

import (
	"slices"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
)

func TestCodecPreservesPropertiesAndPatchPresence(t *testing.T) {
	items := []core.PullRequestProperty{{URL: "  any\x00\ntext 中文 ", Title: ""}, {URL: "  any\x00\ntext 中文 ", Title: ""}, {URL: "", Title: strings.Repeat("long", 20000)}}
	encoded := Encode(core.TaskProperties{PullRequests: items})
	if strings.ContainsRune(encoded, 0) || !strings.Contains(encoded, `\u0000`) {
		t.Fatal("NUL was not escaped for PostgreSQL text")
	}
	decoded, err := Decode([]byte(encoded))
	if err != nil || !slices.Equal(decoded.PullRequests, items) {
		t.Fatalf("property content changed: %+v, %v", decoded, err)
	}
	for _, properties := range []core.TaskProperties{{}, {PullRequests: []core.PullRequestProperty{}}} {
		decoded, err := Decode([]byte(Encode(properties)))
		if err != nil || decoded.PullRequests == nil || len(decoded.PullRequests) != 0 {
			t.Fatalf("empty storage document: %+v, %v", decoded, err)
		}
	}
	patch, err := DecodePatch([]byte(`{}`))
	if err != nil || patch.PullRequests != nil {
		t.Fatalf("empty patch gained mutation intent: %+v, %v", patch, err)
	}
	patch, err = DecodePatch([]byte(`{"pullRequests":[]}`))
	if err != nil || patch.PullRequests == nil || *patch.PullRequests == nil || len(*patch.PullRequests) != 0 {
		t.Fatalf("clear patch lost mutation intent: %+v, %v", patch, err)
	}
}

func TestCodecRejectsCorruptStoredStructures(t *testing.T) {
	for _, invalid := range []string{
		`null`, `{}`, `{"unknown":[]}`, `{"pullRequests":[],"pullRequests":[]}`, `{"pullRequests":null}`, `{"pullRequests":{}}`,
		`{"pullRequests":[null]}`, `{"pullRequests":[{}]}`, `{"pullRequests":[{"url":null,"title":"x"}]}`,
		`{"pullRequests":[{"url":"x"}]}`, `{"pullRequests":[{"url":"x","title":1}]}`,
		`{"pullRequests":[{"url":"x","title":"y","extra":true}]}`, `{"pullRequests":[{"url":"x","title":"y","title":"z"}]}`,
	} {
		if _, err := Decode([]byte(invalid)); err == nil {
			t.Fatalf("corrupt stored properties accepted: %s", invalid)
		}
	}
}
