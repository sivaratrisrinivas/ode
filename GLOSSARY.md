# Ode

A song about a shared trip, sung for the friends who covered the payer's costs, where each friend's lines unlock as the payer pays that friend back.

## People

**Payer**:
The person who owes money from the trip and makes the Ode.
_Avoid_: Debtor, user, me, buyer

**Friend**:
A person the payer owes money to from the trip.
_Avoid_: Creditor, payee, lender

## The trip and the money

**Trip**:
The shared outing the debts and the song come from.

**Trip notes**:
The payer's free-text memories of the trip, including who covered what.
_Avoid_: Receipts, input

**Ledger**:
The confirmed list of friends, each with the amount owed and an inside joke.
_Avoid_: Bill, split, expenses

**Amount owed**:
What the payer owes one friend, minus that friend's even share of any group cost the payer covered.
_Avoid_: Debt, balance

**Amount repaid**:
The total the payer has sent one friend, counted before fees. Never exceeds the amount owed.
_Avoid_: Received, net

**Inside joke**:
One trip memory per friend that the lyrics are built around.

## The song

**Ode**:
The whole song for one trip: an intro, one verse per friend separated by hooks, and a final chorus.
_Avoid_: Tape, track, cassette

**Lyrics**:
The words of the Ode: a verse per friend, a hook and a chorus. Written from the ledger, never sung with amounts, brand names or song titles.
_Avoid_: Script, text

**Verse**:
One friend's four lines in the Ode.

**Line**:
One of a friend's four sung lines; each stands for 25% of that friend's amount owed.

**Flagged**:
A lyric line that still fails the checks after one regeneration. It stays in the lyrics preview, marked, for the payer to edit.

**Hook**:
The short refrain between verses; always audible.

**Chorus**:
The final section of the Ode; it drops only when every friend is fully repaid.
_Avoid_: Outro, finale

**Locked**:
The state of a line not yet paid for: muffled audio and blurred lyrics.

**Unlock**:
A line becoming clear because the amount repaid reached its 25% step. Lines unlock in order.

**Drop**:
The chorus unlocking on the last payment.

**Release date**:
The date the payer promises the whole Ode will drop; fixed once set. Passing it without full repayment makes the Ode delayed; it does not drop the chorus.
_Avoid_: Deadline, due date

**Delayed**:
An Ode whose release date has passed with friends still unpaid.

## Sharing

**Friend view**:
A friend's private page: the whole Ode with locked lines muffled, and only that friend's own amounts.

**Verse share**:
A short song a friend can share: intro, that friend's unlocked lines, the hook, and the chorus only once dropped. A friend with no unlocked line cannot share. It has a link of its own (`/s/<token>`) that says nothing about the friend's private page, and it is fixed when the friend makes it: later unlocks or the drop need a new share. Its card reads "An Ode for [name] · [trip]".
_Avoid_: Mini song, share card, Ode for X

## Demo

**Seeded Ode**:
The pre-made Ode from the real 2025 Florida trip, sung in the payer's cloned voice; every visitor gets their own unpaid copy.

**Visitor copy**:
One browser's payments against the Seeded Ode, kept under the `ode_visitor` cookie. The Ode and its audio are shared; only what has been paid is the visitor's own. "Reset demo" clears it; a missing or cleared cookie starts a new, unpaid one.
