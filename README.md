# Line Runner

A phone scene partner for learning lines: it reads the other parts
aloud, listens for yours, prompts when you say "line", and quietly notes
lines that drifted from the script.

This first version is a **voice test**: one short, original practice
scene, to check that Chrome on an Android phone can listen and speak
well enough for the real thing. No script is stored here; show scripts
are licensed and stay on the actor's own phone.

- Open the page in Chrome on the phone and follow "What to try".
- Add `?sim=1` to the address to type instead of speak (for testing on
  a computer).
- Logic tests: `npm test` (Node 20 or later).

## Script format (for the full app)

Plain text, read by `script.js`:

```
@version 2026-09-26
# Act 1, Scene 3: Scene title
MOTHER: A line.
OLD MAN: A line.
(A stage direction: shown, never spoken or checked.)
[SONG: Song title]
OLD MAN: The first lyric line or two, practiced as lines.
[SKIP TO END OF SONG]
[END SONG]
```

Each spoken line gets a stable id from its scene, speaker and words, so
progress survives edits to other lines.
