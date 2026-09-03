package script

import (
	"strings"
	"testing"
)

func TestGenerateEscapesUserValues(t *testing.T) {
	output, err := Generate(Input{
		TargetOrigin: "https://example.com",
		Tasks: []Task{{
			Name: "quote ` ${value}", Method: "GET", Path: "/health",
			Headers: map[string]string{}, ExpectedStatusMin: 200, ExpectedStatusMax: 299,
		}},
		Profile: Profile{Mode: "arrival-rate", InitialTarget: 1, MaxVUs: 5, Stages: []Stage{{DurationSeconds: 2, Target: 2}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), `"quote `+"`"+` ${value}"`) {
		t.Fatalf("value was not safely JSON encoded: %s", output)
	}
}

func TestGenerateRejectsProtocolRelativePath(t *testing.T) {
	_, err := Generate(Input{
		TargetOrigin: "https://example.com",
		Tasks:        []Task{{Name: "escape", Method: "GET", Path: "//evil.example"}},
		Profile:      Profile{Mode: "virtual-users", MaxVUs: 1, Stages: []Stage{{DurationSeconds: 1, Target: 1}}},
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}
