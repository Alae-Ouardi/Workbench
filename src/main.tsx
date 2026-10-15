import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Root from "./Root";
import { TrayHub } from "./components/tray/TrayHub";
import { MeetingProvider } from "./meetings/MeetingProvider";
import { PrefsProvider } from "./tp-workspace/prefs";

const isTray = getCurrentWindow().label === "tray";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTray ? (
      <PrefsProvider>
        <MeetingProvider showPopup={false}>
          <TrayHub />
        </MeetingProvider>
      </PrefsProvider>
    ) : (
      <Root />
    )}
  </React.StrictMode>,
);
