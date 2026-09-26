# Line Learner

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
