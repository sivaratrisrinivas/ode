import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ode.css";
import { App } from "./App.tsx";
import { FriendView } from "./FriendView.tsx";
import { SharePage } from "./SharePage.tsx";
import { SplitScreen } from "./SplitScreen.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root element");

// A friend's private link is /f/<token>. Every visitor lands on the split screen, the payer's page beside a friend's
// (`/`, also `/split`); it loads the payer's page as `/?quiet`, which does not play the unlock (the friend's pane does).
// `/payer` is the payer's page on its own.
const friendLink = /^\/f\/([^/]+)\/?$/.exec(location.pathname);
const quiet = new URLSearchParams(location.search).has("quiet");
// `/?pane` is the payer's page as the landing page's only pane: it plays its own unlocks.
const pane = new URLSearchParams(location.search).has("pane");
// A verse share's link is /s/<token>: public, and showing only what the friend shared.
const shareLink = /^\/s\/([^/]+)\/?$/.exec(location.pathname);

// A page shown inside the split screen is a pane of it: the stylesheet drops what the page around it already says.
if (window.self !== window.top) document.documentElement.dataset.pane = "";

function page() {
  if (shareLink?.[1] !== undefined) return <SharePage token={shareLink[1]} />;
  if (friendLink?.[1] !== undefined) return <FriendView token={friendLink[1]} />;
  if (quiet || pane || /^\/payer\/?$/.test(location.pathname)) {
    document.title = "Your Ode";
    return <App quiet={quiet} />;
  }
  return <SplitScreen />;
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
