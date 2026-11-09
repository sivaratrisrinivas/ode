import { readFileSync } from "node:fs";

/** The placeholder trip notes the demo and the tests share (`seed/notes.txt`). */
export const seedNotes = readFileSync(new URL("../seed/notes.txt", import.meta.url), "utf8");

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
};
