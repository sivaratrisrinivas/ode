import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { FriendView } from "./FriendView.tsx";
import { SplitScreen } from "./SplitScreen.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root element");

// A friend's private link is /f/<token>; /split is the payer's page beside a friend's; everything else is the payer's
// page. The split screen loads the payer's page as `/?quiet`, which does not play the unlock (the friend's pane does).
const friendLink = /^\/f\/([^/]+)\/?$/.exec(location.pathname);
const quiet = new URLSearchParams(location.search).has("quiet");

function page() {
  if (friendLink?.[1] !== undefined) return <FriendView token={friendLink[1]} />;
  if (/^\/split\/?$/.test(location.pathname)) return <SplitScreen />;
  return <App quiet={quiet} />;
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
