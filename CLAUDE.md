# Projekt-Regeln für Agents

## Prozesse niemals über generische Muster beenden

`pkill -f` / `killall` mit unspezifischen Mustern (`vite`, `node`, `tsx`, `pnpm`) sind in diesem
Projekt verboten. Dieses Repo ist das SDD-Toolkit selbst: Während du arbeitest, läuft eine
Toolkit-Instanz (`pnpm dev` → `tsx watch src/index.ts` + `vite`), und **deine Session ist ein
Kindprozess dieses Servers**. Ein `pkill -f "vite"` trifft dessen Web-Prozess mit, `pnpm --parallel`
reißt daraufhin den Server mit runter (Exit 143) — und damit dich selbst. Der laufende Task bricht
mitten in der Arbeit ab.

Das ist am 26.07.2026 zweimal passiert (21:03 und 23:12, jeweils durch
`pkill -f "tsx src/index.ts"; pkill -f "vite"` beim Aufräumen einer Test-Instanz).

**Stattdessen:** eigene Prozesse nur gezielt beenden — über die gemerkte PID des selbst
gestarteten Prozesses oder über den eigenen Port:

```sh
lsof -ti:4899 | xargs -r kill        # nur die eigene Test-Instanz
kill "$MEINE_PID"                     # PID beim Start gemerkt
```

Wenn du zum Testen eine eigene Instanz brauchst, nimm freie Ports (nicht 4820/4830, die gehören
der laufenden Toolkit-Instanz) und räume ausschließlich diese wieder ab.
