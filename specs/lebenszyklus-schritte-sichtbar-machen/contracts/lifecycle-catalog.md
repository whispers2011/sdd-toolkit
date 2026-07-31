# Contract: Öffentliche API des Lebenszyklus-Katalogs

**Modul**: `packages/shared/src/lifecycleCatalog.ts`, re-exportiert über
`packages/shared/src/index.ts` (`export * from './lifecycleCatalog.js'`)
**Konsumenten**: `packages/web/src/components/WorkflowOverview.tsx`, Tests in `shared` und `server`
**Datenmodell**: [../data-model.md](../data-model.md) · **Entscheidungen**: [../research.md](../research.md)

Dieses Modul ist eine **Bibliothek aus reinen Daten**. Der Vertrag ist damit der exportierte
TypeScript-Typ plus die unten festgehaltenen Invarianten — es gibt keine HTTP-Oberfläche, kein
Wire-Format und keine Serialisierung.

---

## 1. Exportierte Typen

```ts
/** Ort im Code — Datei plus benannte Stelle, bewusst ohne Zeilennummern. */
export interface CodeLocation {
  /** Repo-relativer POSIX-Pfad, z. B. 'packages/server/src/git/worktrees.ts'. */
  file: string;
  /** Benannte Stelle: Funktion, Methode ('Klasse.methode') oder Konstante. */
  symbol: string;
}

/** Eine einzelne Handlung innerhalb einer Lebenszyklus-Stufe. */
export interface LifecycleStep {
  /** kebab-case, eindeutig innerhalb der Stufe, stabil (React-Key). */
  id: string;
  /** Deutscher Name, ≤ 60 Zeichen. */
  name: string;
  /** 1–3 Sätze, ≤ 400 Zeichen. */
  description: string;
  /** Wodurch/wann der Schritt ausgelöst wird. */
  trigger: string;
  location: CodeLocation;
  /** Zwingende Reihenfolge samt Folge ihrer Umkehrung (FR-009). */
  orderNote?: string;
  /** Bedingung, unter der der Schritt läuft bzw. entfällt. */
  condition?: string;
}

/** Eine der fünf Stellen im Ablauf, an denen das Toolkit fest verdrahtet arbeitet. */
export interface LifecycleStage {
  id: LifecycleStageId;
  title: string;
  /** Einordnungssatz: wann in der Reihenfolge. */
  when: string;
  /** ≥ 1 Schritt; Array-Reihenfolge = Ausführungsreihenfolge. */
  steps: readonly LifecycleStep[];
  /** Was das Toolkit hier bewusst NICHT tut (FR-004). */
  notDoneHere?: string;
}

export const LIFECYCLE_STAGES: readonly ['worktree_create', 'phase_start', 'phase_end', 'integration', 'merge'];
export type LifecycleStageId = (typeof LIFECYCLE_STAGES)[number];
```

Optionale Felder folgen `exactOptionalPropertyTypes: true`: sie werden **weggelassen**, nicht
auf `undefined` gesetzt.

---

## 2. Exportierte Werte

| Export | Typ | Garantie |
|---|---|---|
| `LIFECYCLE_STAGES` | `readonly LifecycleStageId[]` | Lebenszyklus-Reihenfolge; genau fünf Werte |
| `LIFECYCLE_CATALOG` | `Record<LifecycleStageId, LifecycleStage>` | vollständig; `LIFECYCLE_CATALOG[id].id === id` |
| `PHASE_LIFECYCLE_STAGES` | `Record<FeaturePhase, readonly LifecycleStageId[]>` | vollständig über `FEATURE_PHASES`; Werte existieren im Katalog |
| `INTEGRATION_STAGE_ORIGIN` | `Record<IntegrationStage, LifecycleStageId \| null>` | vollständig über den `IntegrationStage`-Union; Nicht-`null`-Werte existieren im Katalog |
| `lifecycleStage(id)` | `(id: LifecycleStageId) => LifecycleStage` | Total-Funktion, wirft nie, liefert nie `undefined` |
| `orderedLifecycleStages()` | `() => readonly LifecycleStage[]` | alle Stufen in `LIFECYCLE_STAGES`-Reihenfolge |

---

## 3. Invarianten (testgesichert)

**Struktur**
1. Jede `LifecycleStageId` hat einen Katalogeintrag, dessen `id` dem Schlüssel entspricht.
2. Jede Stufe hat mindestens einen Schritt. Eine leere Stufe ist ein Fehler, kein Leerzustand.
3. Schritt-`id`s sind innerhalb ihrer Stufe eindeutig.
4. `title`, `when`, `name`, `description`, `trigger`, `location.file`, `location.symbol` sind
   nicht leer; gesetzte `orderNote`/`condition`/`notDoneHere` ebenfalls nicht.
5. `name` ≤ 60 Zeichen, `description` ≤ 400 Zeichen.

**Code-Orte**
6. `location.file` beginnt mit `packages/`, endet auf `.ts` oder `.tsx` und enthält keine
   Zeilenangabe (kein `:` gefolgt von Ziffern).
7. Die Datei existiert im Repository.
8. Das letzte Glied von `location.symbol` (nach dem letzten `.`) kommt als Text in dieser Datei vor.

**Domänen-Abdeckung**
9. Jede `FeaturePhase` hat einen Eintrag in `PHASE_LIFECYCLE_STAGES` mit mindestens einer Stufe.
10. Jede `IntegrationStage` hat einen Eintrag in `INTEGRATION_STAGE_ORIGIN`.
11. Beide Records referenzieren ausschließlich existierende Stufen.

**Inhaltliche Zusagen**
12. Stufe `integration` bildet die Reihenfolge aus FR-007 ab: Worktree festschreiben → Zustand
    mit Git abgleichen → Verify → Review-Gate → Review-Berichte committen → Queue bzw.
    Human-Review. Insbesondere steht „Worktree festschreiben" **vor** dem Git-Abgleich.
13. Der Schritt „Worktree festschreiben" trägt einen `orderNote`, der die Voranstellung und die
    Folge der Umkehrung benennt.
14. Stufe `worktree_create` trägt ein `notDoneHere` zum Thema Installation von Abhängigkeiten.

---

## 4. Verhaltenszusagen

- **Rein**: kein IO, kein `node:`-Import, keine Netzwerk-/Datei-/DB-Zugriffe, keine Zeitfunktion,
  kein Zufall. Das Modul ist im Browser-Bundle uneingeschränkt verwendbar.
- **Konfigurationsunabhängig**: keine Abhängigkeit von `AutomationSettings`,
  `OptimizationSettings`, `Project` oder `Feature`. Derselbe Inhalt für jedes Projekt, auch ohne
  ausgewähltes Feature (FR-015).
- **Unveränderlich**: alle Strukturen sind `readonly` bzw. werden nie mutiert; Konsumenten
  erhalten dieselbe Referenz.
- **Additiv**: das Modul importiert nur Typen aus `./types.js` und wird von keinem bestehenden
  Modul importiert. Kein bestehender Export ändert Signatur oder Verhalten (FR-016, SC-006).

---

## 5. Kompatibilität und Erweiterung

| Änderung | Folge |
|---|---|
| Neue `FeaturePhase` in `FEATURE_PHASES` | Compile-Fehler in `PHASE_LIFECYCLE_STAGES` (US2-AS1) |
| Neue `IntegrationStage` | Compile-Fehler in `INTEGRATION_STAGE_ORIGIN` (US2-AS2) |
| Neue `LifecycleStageId` | Compile-Fehler in `LIFECYCLE_CATALOG` |
| Umbenennen/Verschieben einer referenzierten Code-Stelle | Testfehler mit Nennung von Stufe und Schritt (US2-AS4) |
| Neues Pflichtfeld an `LifecycleStep` | Compile-Fehler an jedem Schritt — bewusst |

Neue optionale Felder sind rückwärtskompatibel; die UI ignoriert unbekannte Felder nicht,
sondern muss sie bewusst rendern (siehe [ui-contract.md](./ui-contract.md)).
