package tree_sitter_yap_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_yap "github.com/tree-sitter/tree-sitter-yap/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_yap.Language())
	if language == nil {
		t.Errorf("Error loading Yap grammar")
	}
}
