import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TrayPopover } from "./components/TrayPopover";

const isTray = getCurrentWindow().label === "tray";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTray ? <TrayPopover /> : <App />}
  </React.StrictMode>,
);
