import { readFileSync } from "node:fs";
import { seedLyrics } from "./seed-lyrics.ts";

/** The placeholder trip notes the demo and the tests share (`seed/notes.txt`). */
export const seedNotes = readFileSync(new URL("../../seed/notes.txt", import.meta.url), "utf8");

/**
 * What Claude returns for the seed notes: each friend's amount before group costs
 * (Tharun: his $420 stay split 4 ways = $105; Vikram: ~$90 of gas; Sahiti: $60 airboat + ~$25 burritos)
 * and the $30 parking the payer covered for the group.
 */
export const seedExtraction = {
  friends: [
    {
      name: "Tharun",
      amountOwedCents: 10500,
      amountIsEstimate: true,
      insideJoke: "Drove the overnight stretch to Key West while everyone slept",
    },
    {
      name: "Vikram",
      amountOwedCents: 9000,
      amountIsEstimate: true,
      insideJoke: "Got everyone lost hunting the sunset spot and found a pier and key lime pie at 9pm",
    },
    {
      name: "Sahiti",
      amountOwedCents: 8500,
      amountIsEstimate: true,
      insideJoke: "Screamed when the alligator came close to the boat",
    },
  ],
  groupCosts: [{ description: "Parking in Orlando", amountCents: 3000 }],
  trip: "Florida '25",
};

/** What Claude writes for the seed ledger (4 clean lines per friend, a hook and a chorus). It lives in `src/testing/` because the reliability script sings these lines too. */
export { seedLyrics };

/** The PayPal sandbox account each friend is paid through (`notes/day1-checks.md`). */
export const seedFriendAccounts: Readonly<Record<string, string>> = {
  Tharun: "tharunbandaru18@gmail.com",
  Vikram: "vikram_vickey10@outlook.com",
  Sahiti: "sahitishastrula1402@gmail.com",
};

/** A judge's own trip notes: two friends who are not the seed's, so an Own Ode is told apart from the Seeded Ode. */
export const goaNotes = "Goa '26: Meera covered the villa, I owe her $200. Dev paid for the scooters, $60.";

/** What Claude returns for `goaNotes`. */
export const goaExtraction = {
  friends: [
    { name: "Meera", amountOwedCents: 20_000, amountIsEstimate: false, insideJoke: "Haggled with a scooter shop owner and lost" },
    { name: "Dev", amountOwedCents: 6_000, amountIsEstimate: false, insideJoke: "Fell asleep on the beach and got sunburnt in stripes" },
  ],
  groupCosts: [],
  trip: "Goa '26",
};

/**
 * What Claude writes for any ledger: the seed lyrics for the seed's friends, four plain lines for anyone else.
 *
 * @param input - The `write-lyrics` request's input: the JSON of the friends to write for.
 */
export function lyricsForFriends(input: string) {
  const { friends }: { friends: { name: string }[] } = JSON.parse(input);
  const sung = new Map(seedLyrics.friends.map((friend) => [friend.name, friend.lines]));
  return {
    friends: friends.map(({ name }) => ({
      name,
      lines: sung.get(name) ?? [`${name} laughed the whole way there`, "We sang along to the radio", "The sun went down slow", "And nobody wanted to go home"],
    })),
    hook: seedLyrics.hook,
    chorus: seedLyrics.chorus,
  };
}
