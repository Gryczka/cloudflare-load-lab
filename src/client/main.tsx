import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const storedMode = localStorage.getItem("loadlab-theme");
const initialDark =
  storedMode === "dark" ||
  (storedMode === null &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.mode = initialDark ? "dark" : "light";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
