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

/** What Claude writes for the seed ledger: 4 clean lines per friend, a hook and a chorus. */
export const seedLyrics = {
  friends: [
    {
      name: "Tharun",
      lines: [
        "Tharun held the wheel while the whole car dreamed",
        "Headlights on the highway in a long quiet stream",
        "Key West was waiting at the end of the night",
        "He got us there sleeping and he got it right",
      ],
    },
    {
      name: "Vikram",
      lines: [
        "Vikram swore the sunset was just around the bend",
        "Wrong turn, wrong turn, and a pier at the end",
        "Key lime pie at nine under the string lights",
        "The best night of the trip came from getting lost right",
      ],
    },
    {
      name: "Sahiti",
      lines: [
        "Sahiti on the airboat watching the water glide",
        "Then a gator slid up close and she screamed with pride",
        "Everybody heard it across the whole swamp",
        "And Tharun caught it on video, a legend now",
      ],
    },
  ],
  hook: "Oh we were there, we were there, together on the road",
  chorus: "Here is to the friends who carried the whole trip home",
};
