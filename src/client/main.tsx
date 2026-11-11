import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { FriendView } from "./FriendView.tsx";
import { SplitScreen } from "./SplitScreen.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root element");

// A friend's private link is /f/<token>. Every visitor lands on the split screen, the payer's page beside a friend's
// (`/`, also `/split`); it loads the payer's page as `/?quiet`, which does not play the unlock (the friend's pane does).
// `/payer` is the payer's page on its own.
const friendLink = /^\/f\/([^/]+)\/?$/.exec(location.pathname);
const quiet = new URLSearchParams(location.search).has("quiet");

function page() {
  if (friendLink?.[1] !== undefined) return <FriendView token={friendLink[1]} />;
  if (quiet || /^\/payer\/?$/.test(location.pathname)) return <App quiet={quiet} />;
  return <SplitScreen />;
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
