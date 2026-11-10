import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { FriendView } from "./FriendView.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root element");

// A friend's private link is /f/<token>; everything else is the payer's page.
const friendLink = /^\/f\/([^/]+)\/?$/.exec(location.pathname);

createRoot(container).render(<StrictMode>{friendLink?.[1] === undefined ? <App /> : <FriendView token={friendLink[1]} />}</StrictMode>);
