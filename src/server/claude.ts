import Anthropic from "@anthropic-ai/sdk";
import { ClaudeUnavailable, type Claude } from "./ports.ts";
import { err, ok } from "./result.ts";

const MODEL = "claude-opus-5-5";

/**
 * The production Claude port: one Messages API call whose reply is constrained to the request's JSON schema.
 *
 * @param apiKey - An Anthropic API key.
 */
export function createAnthropicClaude(apiKey: string): Claude {
  const client = new Anthropic({ apiKey });

  return {
    async structured({ instructions, schema, input }) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          // Thinking tokens count toward max_tokens, so leave room beyond the small JSON reply.
          max_tokens: 16_000,
          system: instructions,
          messages: [{ role: "user", content: input }],
          output_config: { effort: "medium", format: { type: "json_schema", schema } },
        });
        if (response.stop_reason !== "end_turn") {
          return err(new ClaudeUnavailable(`stopped with ${response.stop_reason ?? "no stop reason"}`));
        }
        const text = response.content.find((block) => block.type === "text");
        if (text === undefined) return err(new ClaudeUnavailable("the reply had no text"));
        return ok(JSON.parse(text.text));
      } catch (cause) {
        // Anthropic.APIError (network, rate limit, 5xx) and malformed JSON both mean "no usable answer".
        return err(new ClaudeUnavailable(cause));
      }
    },
  };
}
