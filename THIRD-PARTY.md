# Third-Party-Bestandteile

Dieses Repository enthält Dateien aus fremden Projekten. Ihr Copyright liegt bei den
jeweiligen Urhebern; die `LICENSE` im Wurzelverzeichnis gilt für den übrigen Code.

---

## spec-kit (GitHub, Inc.)

- **Projekt**: [github/spec-kit](https://github.com/github/spec-kit)
- **Lizenz**: MIT (Volltext unten)
- **Enthaltene Version**: `0.13.4.dev0` (siehe `.specify/init-options.json`)
- **Installiert über**: `specify init --here --integration claude`

Das SDD Toolkit orchestriert den spec-kit-Workflow und bringt dessen Kommandodefinitionen,
Vorlagen und Hilfsskripte mit, damit dieses Repository sich selbst mit dem Werkzeug
entwickeln lässt. Die Dateien stammen unverändert aus dem Upstream-Projekt; die
Prüfsummen stehen in `.specify/integrations/speckit.manifest.json` und
`.specify/integrations/claude.manifest.json`.

**Übernommene Dateien:**

```
.specify/scripts/bash/check-prerequisites.sh
.specify/scripts/bash/common.sh
.specify/scripts/bash/create-new-feature.sh
.specify/scripts/bash/setup-plan.sh
.specify/scripts/bash/setup-tasks.sh
.specify/templates/checklist-template.md
.specify/templates/constitution-template.md
.specify/templates/plan-template.md
.specify/templates/spec-template.md
.specify/templates/tasks-template.md
.claude/skills/speckit-analyze/SKILL.md
.claude/skills/speckit-checklist/SKILL.md
.claude/skills/speckit-clarify/SKILL.md
.claude/skills/speckit-constitution/SKILL.md
.claude/skills/speckit-converge/SKILL.md
.claude/skills/speckit-implement/SKILL.md
.claude/skills/speckit-plan/SKILL.md
.claude/skills/speckit-specify/SKILL.md
.claude/skills/speckit-tasks/SKILL.md
.claude/skills/speckit-taskstoissues/SKILL.md
```

**Nicht** aus spec-kit, sondern eigener Inhalt dieses Projekts sind unter anderem
`.specify/memory/constitution.md` (die Projekt-Verfassung) und alles unter `specs/`.

### Lizenztext

```
MIT License

Copyright GitHub, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Laufzeit-Abhängigkeiten

Die npm-Abhängigkeiten stehen in `package.json` und den `packages/*/package.json`; ihre
Lizenzen sind über `pnpm licenses list` einsehbar. Sie werden nicht mitgeliefert, sondern
bei der Installation bezogen.
