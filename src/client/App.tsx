import { TooltipProvider } from "@cloudflare/kumo";
import { AppShell } from "./components/AppShell";
import { Architecture } from "./routes/Architecture";
import { Dashboard } from "./routes/Dashboard";
import { Integrations } from "./routes/Integrations";
import { NewRun } from "./routes/NewRun";
import { RunDetail } from "./routes/RunDetail";
import { Targets } from "./routes/Targets";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const capture =
    new URLSearchParams(window.location.search).get("capture") === "tile";
  if (path === "/architecture" && capture) return <Architecture capture />;

  let page: React.ReactNode;
  if (path === "/") page = <Dashboard />;
  else if (path === "/new") page = <NewRun />;
  else if (path === "/targets") page = <Targets />;
  else if (path === "/integrations") page = <Integrations />;
  else if (path === "/architecture") page = <Architecture />;
  else if (path === "/preview")
    page = <RunDetail id="sample-global-pulse" sample />;
  else if (path.startsWith("/runs/"))
    page = <RunDetail id={path.slice("/runs/".length)} />;
  else page = <Dashboard />;

  return (
    <TooltipProvider>
      <AppShell>{page}</AppShell>
    </TooltipProvider>
  );
}
