import {
  Badge,
  Button,
  ClipboardText,
  LayerCard,
  Tabs,
} from "@cloudflare/kumo";
import {
  ArrowSquareOutIcon,
  BracketsCurlyIcon,
  GithubLogoIcon,
  GitlabLogoIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

const snippets = {
  cli: `# Validate without starting Containers
loadlab plan loadlab.yml

# Launch, stream progress, and use threshold status as the exit code
loadlab run loadlab.yml --wait --junit reports/load-lab.xml`,
  github: `name: performance-gate
on: [deployment_status]
jobs:
  load:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @gryczka/load-lab run loadlab.yml --wait --junit load-lab.xml
        env:
          LOADLAB_API_URL: \${{ vars.LOADLAB_API_URL }}
          LOADLAB_TOKEN: \${{ secrets.LOADLAB_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: load-lab-report
          path: load-lab.xml`,
  gitlab: `performance:load:
  image: node:24
  stage: verify
  script:
    - npx @gryczka/load-lab run loadlab.yml --wait --junit load-lab.xml
  variables:
    LOADLAB_API_URL: $LOADLAB_API_URL
  artifacts:
    when: always
    reports:
      junit: load-lab.xml
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`,
};

export function Integrations() {
  const [tab, setTab] = useState<keyof typeof snippets>("cli");

  return (
    <div className="page integrations-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">AUTOMATION SURFACE</span>
          <h1>Make latency a test failure.</h1>
          <p>
            One versioned API powers the UI, CLI, merge gates, and scheduled
            workflows.
          </p>
        </div>
        <Badge variant="purple" icon={<BracketsCurlyIcon weight="bold" />}>
          API v1
        </Badge>
      </div>

      <div className="integration-hero">
        <LayerCard className="integration-code-card">
          <div className="integration-code-head">
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as keyof typeof snippets)}
              tabs={[
                { value: "cli", label: "CLI" },
                { value: "github", label: "GitHub Actions" },
                { value: "gitlab", label: "GitLab CI" },
              ]}
            />
            <ClipboardText text="Copy" textToCopy={snippets[tab]} size="sm" />
          </div>
          <pre className="integration-code">
            <code>{snippets[tab]}</code>
          </pre>
        </LayerCard>
        <div className="integration-points">
          <IntegrationPoint
            icon={TerminalWindowIcon}
            title="Automation-first"
            description="Plan, run, watch, stop, and export without opening the dashboard."
          />
          <IntegrationPoint
            icon={BracketsCurlyIcon}
            title="Machine-readable results"
            description="JSON for pipelines, JUnit for test suites, stable exit codes for gates."
          />
          <IntegrationPoint
            icon={GithubLogoIcon}
            title="Idempotent runs"
            description="Commit metadata and idempotency keys keep retries from multiplying traffic."
          />
        </div>
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CONFIGURATION AS CODE</span>
            <h2>A small, reviewable contract</h2>
          </div>
          <Button
            variant="secondary"
            icon={ArrowSquareOutIcon}
            onClick={() =>
              window.open(
                "https://github.com/Gryczka/cloudflare-load-lab/tree/main/examples",
                "_blank",
              )
            }
          >
            Browse examples
          </Button>
        </div>
        <div className="config-grid">
          <LayerCard className="yaml-card">
            <div className="code-file-label">loadlab.yml</div>
            <pre>{`version: 1
name: checkout-pr
targetId: verified-staging

tasks:
  - name: health
    method: GET
    path: /api/health

profile:
  mode: arrival-rate
  initialTarget: 5
  stages:
    - { durationSeconds: 30, target: 100 }
    - { durationSeconds: 60, target: 100 }

regions:
  - { code: ENAM, weight: 40, shards: 1 }
  - { code: WEUR, weight: 30, shards: 1 }
  - { code: APAC, weight: 30, shards: 1 }

thresholds:
  p95Ms: 300
  errorRate: 0.01`}</pre>
          </LayerCard>
          <div className="workflow-cards">
            <LayerCard className="workflow-card">
              <GithubLogoIcon weight="duotone" />
              <div>
                <h3>Pull request gate</h3>
                <p>
                  Test a preview deployment, attach JUnit, and compare against
                  main.
                </p>
              </div>
              <Badge variant="green">READY</Badge>
            </LayerCard>
            <LayerCard className="workflow-card">
              <GitlabLogoIcon weight="duotone" />
              <div>
                <h3>GitLab environment</h3>
                <p>
                  Run after staging deploy and surface thresholds in the
                  pipeline.
                </p>
              </div>
              <Badge variant="green">READY</Badge>
            </LayerCard>
            <LayerCard className="workflow-card">
              <TerminalWindowIcon weight="duotone" />
              <div>
                <h3>Local smoke run</h3>
                <p>
                  Validate configuration and estimate shards before reserving
                  capacity.
                </p>
              </div>
              <Badge variant="blue">CLI</Badge>
            </LayerCard>
          </div>
        </div>
      </section>
    </div>
  );
}

function IntegrationPoint({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof TerminalWindowIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="integration-point">
      <span>
        <Icon weight="duotone" />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
