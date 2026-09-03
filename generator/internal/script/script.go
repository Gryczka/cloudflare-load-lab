package script

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Task struct {
	Name              string            `json:"name"`
	Method            string            `json:"method"`
	Path              string            `json:"path"`
	Body              string            `json:"body,omitempty"`
	Headers           map[string]string `json:"headers"`
	ExpectedStatusMin int               `json:"expectedStatusMin"`
	ExpectedStatusMax int               `json:"expectedStatusMax"`
	ThinkTimeMS       int               `json:"thinkTimeMs"`
}

type Stage struct {
	DurationSeconds int `json:"durationSeconds"`
	Target          int `json:"target"`
}

type Profile struct {
	Mode          string  `json:"mode"`
	InitialTarget int     `json:"initialTarget"`
	Stages        []Stage `json:"stages"`
	MaxVUs        int     `json:"maxVus"`
}

type Input struct {
	TargetOrigin string
	Tasks        []Task
	Profile      Profile
}

func Generate(input Input) ([]byte, error) {
	if err := validate(input); err != nil {
		return nil, err
	}
	target, _ := json.Marshal(strings.TrimRight(input.TargetOrigin, "/"))
	tasks, _ := json.Marshal(input.Tasks)
	options, err := options(input.Profile)
	if err != nil {
		return nil, err
	}

	result := fmt.Sprintf(`import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = %s;
const targetOrigin = %s;
const tasks = %s;

export default function () {
  for (const task of tasks) {
    const headers = Object.assign({
      'User-Agent': 'Cloudflare-Load-Lab/0.1 (+https://github.com/Gryczka/cloudflare-load-lab)'
    }, task.headers || {});
    if (task.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = http.request(task.method, targetOrigin + task.path, task.body || null, {
      headers,
      redirects: 0,
      tags: { name: task.name }
    });
    check(response, {
      [task.name + ': expected status']: (r) =>
        r.status >= task.expectedStatusMin && r.status <= task.expectedStatusMax
    });
    if (task.thinkTimeMs > 0) sleep(task.thinkTimeMs / 1000);
  }
}
`, options, target, tasks)
	return []byte(result), nil
}

func options(profile Profile) ([]byte, error) {
	stages := make([]map[string]any, len(profile.Stages))
	for index, stage := range profile.Stages {
		stages[index] = map[string]any{
			"duration": fmt.Sprintf("%ds", stage.DurationSeconds),
			"target":   stage.Target,
		}
	}

	var scenario map[string]any
	switch profile.Mode {
	case "arrival-rate":
		preallocated := profile.MaxVUs / 2
		if preallocated < 1 {
			preallocated = 1
		}
		scenario = map[string]any{
			"executor":        "ramping-arrival-rate",
			"startRate":       profile.InitialTarget,
			"timeUnit":        "1s",
			"preAllocatedVUs": preallocated,
			"maxVUs":          profile.MaxVUs,
			"stages":          stages,
			"gracefulStop":    "2s",
		}
	case "virtual-users":
		scenario = map[string]any{
			"executor":         "ramping-vus",
			"startVUs":         profile.InitialTarget,
			"stages":           stages,
			"gracefulRampDown": "1s",
			"gracefulStop":     "2s",
		}
	default:
		return nil, fmt.Errorf("unsupported profile mode %q", profile.Mode)
	}

	return json.Marshal(map[string]any{
		"discardResponseBodies": true,
		"scenarios":             map[string]any{"loadlab": scenario},
	})
}

func validate(input Input) error {
	if input.TargetOrigin == "" || len(input.Tasks) == 0 || len(input.Profile.Stages) == 0 {
		return fmt.Errorf("target, tasks, and stages are required")
	}
	if input.Profile.MaxVUs < 1 {
		return fmt.Errorf("maxVus must be positive")
	}
	for _, task := range input.Tasks {
		if !strings.HasPrefix(task.Path, "/") || strings.HasPrefix(task.Path, "//") {
			return fmt.Errorf("task path %q must be origin-relative", task.Path)
		}
	}
	return nil
}
