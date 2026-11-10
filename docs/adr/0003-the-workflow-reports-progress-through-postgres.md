# The Workflow reports progress through Postgres, and its task is never retried

The song pipeline runs as one Render Workflow task (`make-ode`) that the web service starts and polls. Render's run status is only pending, running or an end state, so the status steps (writing, composing, finding lines) cannot come from it. The task writes its step to a row in Postgres, which both processes can reach, and the web service shows that row. Render's status is read only to tell a run that ended without saving an Ode from one that is slow: such a run is recorded as failed, so the payer sees "try again" instead of waiting forever. A run that is no longer the one in progress cannot move the row or save an Ode.

The task is registered with `maxRetries: 0`. Render's default of three retries would compose, and pay Eleven Music for, the song again after a crash. The payer's "Try again" is the retry. The task catches every failure it can name and records it rather than throwing, so Render sees a failed run only when the task could not start at all (a run ID that is not one, or a missing database URL or key) or could not reach the database to record the failure. The web service then sees the Workflow report the run ended and records it as lost.

## Consequences

The in-memory run state of the first version is gone, so a web service restart keeps showing the run and a second web service instance cannot start a second run. A web service that dies between recording a run and starting it leaves a run that is recorded as lost after 30 seconds. Off Render the same job runs inside the web service process (`in-process-workflow.ts`), which is for development only; on Render, missing Workflow settings stop startup and are never that fallback.
