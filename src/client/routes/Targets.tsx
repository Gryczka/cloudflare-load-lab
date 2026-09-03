import {
  Badge,
  Banner,
  Button,
  ClipboardText,
  Input,
  LayerCard,
  Table,
} from "@cloudflare/kumo";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken } from "../lib/api";

type Target = {
  id: string;
  origin: string;
  status: string;
  expiresAt?: string;
};

type Challenge = {
  id: string;
  origin: string;
  challenge: string;
  wellKnownUrl: string;
};

export function Targets() {
  const [token, setToken] = useState(getAdminToken());
  const [origin, setOrigin] = useState("https://staging.example.com");
  const [targets, setTargets] = useState<Target[]>([]);
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!getAdminToken()) return;
    try {
      setTargets((await api.targets()).targets);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load targets",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      setChallenge(await api.createTarget(origin));
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create target",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setBusy(true);
    setError("");
    try {
      await api.verifyTarget(id);
      setChallenge(undefined);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Verification failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function applyToken() {
    setAdminToken(token.trim());
    void load();
  }

  return (
    <div className="page targets-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">EGRESS SAFETY</span>
          <h1>Verified targets</h1>
          <p>
            Load can leave the generator grid only for an origin you prove you
            control.
          </p>
        </div>
        <Badge variant="green" className="badge-with-icon">
          <ShieldCheckIcon weight="fill" /> Deny by default
        </Badge>
      </div>

      <Banner
        icon={<ShieldCheckIcon weight="fill" />}
        title="Why verification is mandatory"
        description="A globally distributed load generator must never become an anonymous traffic cannon. Verification expires after 24 hours, redirects are disabled, and each Container receives an exact hostname allowlist."
      />

      <div className="targets-grid">
        <LayerCard className="target-create-card">
          <div className="builder-heading">
            <span>01</span>
            <div>
              <h2>Authenticate this browser</h2>
              <p>The token is retained in session storage only.</p>
            </div>
          </div>
          <div className="token-row target-token-row">
            <Input
              label="Administrator token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button variant="secondary" icon={KeyIcon} onClick={applyToken}>
              Apply
            </Button>
          </div>

          <div className="builder-heading target-step">
            <span>02</span>
            <div>
              <h2>Add an HTTPS origin</h2>
              <p>Paths and credentials are intentionally rejected here.</p>
            </div>
          </div>
          <div className="token-row target-token-row">
            <Input
              label="Origin"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
            <Button
              variant="primary"
              icon={PlusIcon}
              loading={busy}
              onClick={create}
            >
              Create challenge
            </Button>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </LayerCard>

        <LayerCard className="verification-card">
          <span className="eyebrow">OWNERSHIP CHALLENGE</span>
          {challenge ? (
            <>
              <h2>Publish two values</h2>
              <p>
                Serve the exact challenge as plain text, then ask the Worker to
                check it.
              </p>
              <label>Well-known URL</label>
              <ClipboardText text={challenge.wellKnownUrl} size="base" />
              <label>Response body</label>
              <ClipboardText text={challenge.challenge} size="base" />
              <Button
                variant="primary"
                icon={ArrowClockwiseIcon}
                loading={busy}
                onClick={() => verify(challenge.id)}
              >
                Verify now
              </Button>
            </>
          ) : (
            <div className="challenge-empty">
              <CheckCircleIcon weight="duotone" />
              <strong>Waiting for an origin</strong>
              <span>
                The generated challenge appears here. Nothing is sent to the
                target yet.
              </span>
            </div>
          )}
        </LayerCard>
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">TARGET INVENTORY</span>
            <h2>Approved origins</h2>
          </div>
          <Button variant="ghost" icon={ArrowClockwiseIcon} onClick={load}>
            Refresh
          </Button>
        </div>
        <LayerCard className="table-card">
          {targets.length === 0 ? (
            <div className="empty-state">
              <ShieldCheckIcon weight="duotone" />
              <strong>No private targets visible</strong>
              <span>
                Apply the deployment token to manage ownership challenges.
              </span>
            </div>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Origin</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Expires</Table.Head>
                  <Table.Head>Action</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {targets.map((target) => (
                  <Table.Row key={target.id}>
                    <Table.Cell>
                      <strong>{target.origin}</strong>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        variant={
                          target.status === "verified"
                            ? "green"
                            : target.status === "expired"
                              ? "red"
                              : "orange"
                        }
                        className="badge-with-dot"
                      >
                        {target.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {target.expiresAt
                        ? new Date(target.expiresAt).toLocaleString()
                        : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      {target.status !== "verified" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => verify(target.id)}
                        >
                          Verify
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </LayerCard>
      </section>
    </div>
  );
}
