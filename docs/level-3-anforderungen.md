# Zielbild: Level 3 „Supervised Autonomy" (Steps of AI Adoption, B. Cherny, Jul 2026)

Quelle: `ai-adoption.xlsx` (Kopie des Artifacts „Steps of AI Adoption")

## Die Stufen im Überblick

| Step | Rolle | ~Agents | Kern |
|---|---|---|---|
| 0 Gated | – | 0 | Zugang zu AI-Tools gated, keine Infrastruktur |
| 1 Assisted | Du + 1 Agent (Pair) | ~1 | Eine Session, jede Änderung wird reviewt, synchron |
| 2 Parallel | Orchestrator | ~10 | 5–10 Agents, je eigener Worktree/Checkout, Self-Verification, Review von Diffs statt Keystrokes |
| **3 Supervised Autonomy** | **Manager of Managers (Org-Baum)** | **~100** | **Claude schreibt (fast) allen Code; Frage ist nicht mehr „hast du den Code gelesen?" sondern „welcher Kontext fehlte dem Modell?"** |
| 4 AI-native | VP steering by intent | ~1000+ | Loop vollständig geschlossen, Agents starten Agents, Monitoring by exception |

## Was Level 2→3 konkret verlangt (und unser Tool liefern muss)

Aus „How to get from step 2 to 3" + Level-3-Spalten:

1. **Worktree-Isolation für parallele (Sub-)Agents** — damit Agents nicht kollidieren. ⟶ Kernfeature: Worktree pro Feature, automatisiertes Merge-Handling.
2. **Self-Verification-Loop, dem man vertraut** — Tests + Build + Lint + E2E als Gate, bevor ein Mensch etwas sieht. ⟶ Verifikations-Pipeline pro Feature vor Merge.
3. **Automatisiertes Code-Review & Security-Review** — by default an. ⟶ Review-Agent-Stufe in der Merge-Queue.
4. **Arbeit in Loops und Routinen zerlegen** — wiederkehrende Arbeit fan-out-fähig machen. ⟶ SDD-Phasen als wiederholbare, automatisch getriggerte Schritte.
5. **Claude kickt Claude an** — Phasenübergänge und Folgeaufgaben ohne manuellen Anstoß. ⟶ Auto-Progression im SDD-Workflow (Spec fertig → Plan-Agent startet automatisch, konfigurierbar).
6. **Kontext-Zufuhr** — Claude kann Code, Wikis, Diskussionen lesen. ⟶ MCP-Integration pro Projekt/Agent-Profil.
7. **Monitoring statt Babysitting** — Engpass ist „Trust in the loop" und Entscheidungs-Durchsatz, nicht Tippen. ⟶ Dashboard mit Status by exception: nur zeigen, was Aufmerksamkeit braucht (wartet auf Input, Konflikt, Review fällig).
8. **Token-/Kosten-Effizienz beobachten** — Nutzung steigt, Kosten brauchen Sichtbarkeit. ⟶ Kosten/Token pro Execution erfassen (speckit-assistant macht das bereits vor).

## Konsequenz für das Tool

Das Tool ist die **Orchestrierungs- und Vertrauensschicht**, die Level 3 ermöglicht:
Mensch reviewt fertige, selbst-verifizierte, konflikt-bereinigte Diffs pro Feature —
nicht laufende Sessions. Die Konsole pro Feature bleibt als Drill-Down erhalten
(Eingreifen, wenn ein Agent wartet), ist aber nicht mehr der primäre Arbeitsmodus.
