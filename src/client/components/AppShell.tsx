import {
  Badge,
  Button,
  CloudflareLogo,
  Sidebar,
  Tooltip,
} from "@cloudflare/kumo";
import {
  ChartLineUpIcon,
  CirclesThreePlusIcon,
  CloudArrowUpIcon,
  GithubLogoIcon,
  GlobeHemisphereWestIcon,
  HouseIcon,
  KeyIcon,
  MoonIcon,
  PlugsConnectedIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

const navigation = [
  { href: "/", label: "Overview", icon: HouseIcon },
  { href: "/new", label: "New test", icon: CirclesThreePlusIcon },
  { href: "/targets", label: "Targets", icon: KeyIcon },
  { href: "/integrations", label: "Integrations", icon: PlugsConnectedIcon },
  {
    href: "/architecture",
    label: "Architecture",
    icon: GlobeHemisphereWestIcon,
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = window.location.pathname;
  const [dark, setDark] = useState(
    () => localStorage.getItem("loadlab-theme") === "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    localStorage.setItem("loadlab-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Sidebar.Provider defaultOpen className="app-frame">
      <Sidebar>
        <Sidebar.Header>
          <a href="/" className="brand-lockup" aria-label="Load Lab home">
            <span className="brand-mark">
              <ChartLineUpIcon weight="bold" />
            </span>
            <span className="brand-copy">
              <strong>Load Lab</strong>
              <small>CONTAINER GRID</small>
            </span>
          </a>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>Control plane</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {navigation.map(({ href, label, icon }) => (
                <Sidebar.MenuButton
                  key={href}
                  href={href}
                  icon={icon}
                  tooltip={label}
                  active={
                    pathname === href ||
                    (href === "/" && pathname.startsWith("/runs/"))
                  }
                >
                  {label}
                </Sidebar.MenuButton>
              ))}
            </Sidebar.Menu>
          </Sidebar.Group>
          <Sidebar.Group>
            <Sidebar.GroupLabel>Runtime</Sidebar.GroupLabel>
            <div className="sidebar-runtime">
              <span className="runtime-dot" />
              <div>
                <strong>6 regions ready</strong>
                <small>Basic · scale to zero</small>
              </div>
            </div>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer>
          <a
            className="github-link"
            href="https://github.com/Gryczka/cloudflare-load-lab"
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogoIcon />
            <span>Source</span>
          </a>
          <Sidebar.Trigger />
        </Sidebar.Footer>
      </Sidebar>

      <div className="app-content">
        <header className="topbar">
          <div className="topbar-left">
            <Sidebar.Trigger />
            <Badge variant="orange" className="badge-with-dot">
              Cloudflare Containers
            </Badge>
          </div>
          <div className="topbar-right">
            <span className="edge-label">
              <CloudArrowUpIcon /> globally orchestrated
            </span>
            <Tooltip
              content={dark ? "Use light theme" : "Use dark theme"}
              render={
                <Button
                  variant="ghost"
                  shape="square"
                  size="sm"
                  icon={dark ? SunIcon : MoonIcon}
                  aria-label={dark ? "Use light theme" : "Use dark theme"}
                  onClick={() => setDark((value) => !value)}
                />
              }
            />
          </div>
        </header>
        <main className="main-content">{children}</main>
        <footer className="app-footer">
          <span>
            Unrefined App Garden experiment · not an official Cloudflare product
          </span>
          <span className="footer-cloudflare">
            Powered by <CloudflareLogo variant="glyph" className="cf-glyph" />{" "}
            Cloudflare
          </span>
        </footer>
      </div>
    </Sidebar.Provider>
  );
}
