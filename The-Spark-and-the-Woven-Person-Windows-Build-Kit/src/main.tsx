import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { captureSource } from "./exportPage";

// Snapshot the pristine single-file document before React touches the DOM,
// so the film can save an exact standalone copy of itself.
captureSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
