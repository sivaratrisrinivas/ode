# One chunk per verse, line windows from word timestamps

The song is composed with one Eleven Music chunk per verse (~20 s), not one per line. One chunk per line gave exact line windows, but the day-1 probe sounded "okay, not great"; verse-level chunks sounded like a real song. Each line's window is found by aligning the returned word timestamps to the lyric lines; if alignment fails, the verse window is split into equal quarters.

## Consequences

The pitch can no longer say "one chunk per line, so every line has an exact window". Verse windows are exact; line windows are derived.
