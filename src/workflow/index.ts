// The Render Workflow's entry point: its start command is `node src/workflow/index.ts`.
// Render loads this file to register the tasks below, so it reads no environment: that happens when a run starts.
import { task } from "@renderinc/sdk/workflows";
import { MAKE_ODE_TASK } from "../server/render-workflow.ts";
import { makeOdeRun } from "./make-ode.ts";

// The task is never retried by Render (`maxRetries: 0`): a retry would compose, and pay for, the song again.
// The payer's "Try again" is the retry (ADR 0003). A run takes well under a minute and each call out has its own
// timeout; five minutes is the backstop for a hung call, and the web service gives up on a run after ten.
task({ name: MAKE_ODE_TASK, timeoutSeconds: 300, retry: { maxRetries: 0, waitDurationMs: 1_000 } }, makeOdeRun);
