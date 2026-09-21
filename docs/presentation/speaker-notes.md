# Sprechernotizen · Rumble Framework, gezeigt an Requisit

## Der rote Faden (die ganze Geschichte in vier Sätzen)

1. **Das Problem:** Agenten schreiben Code schnell. Was bricht, ist das Drumherum: Entscheidungen verschwinden im Chat, der Agent baut seine Vermutung, und niemand weiß, wer was geprüft hat.
2. **Die Form:** Drei Sessions, ein Repository. Denken (Rumble) endet mit Issues, Bauen (Pipeline) liest nie den Chat, die Docs sind das Gedächtnis. GitHub ist der einzige geteilte Zustand.
3. **Der Beweis:** Requisit, ein B2B-Bestellanforderungs-Service, heute Morgen ein leeres Repository. Jede Folie zeigt ein echtes Artefakt aus diesem Lauf: das Issue, die Labels, das Design, der PR, die Review-Findings, der Trail.
4. **Die Landung:** Vier Issues, vier PRs, 474 Tests, 38 Review-Findings, davon 5 rot und alle in einer Runde behoben. 3,39 Mio. Tokens für die Pipeline, 112 Tsd. für das Denken. Und der nächste Rumble beginnt bei den Docs, nicht bei null.

Wenn du dich verlierst: du bist in einem dieser vier Sätze. Sag den, in dem du gerade bist, und geh weiter.

---

## Vorbereitung (5 Minuten vorher)

1. `cd ~/requisit && npm ci && npm run seed && npm start` (mit `PORT=3123` in `.env`, 3000 ist auf dem Mac belegt). Terminal offen lassen.
2. `deck.html` öffnen, **F** für Vollbild. Blättern mit **→**, **M** springt jederzeit zurück auf das Schema.
3. Ein zweites Browserfenster mit `github.com/FRZWLF/requisit` (Issues, PRs) für Nachfragen.
4. Optional: `rumble-framework/site` über `python3 -m http.server 8000` für die animierten Replays (`replay.html?data=replays/requisit-issue-3.json`).

Fällt der Service aus: die Produktfolie zeigt den Hinweis, alles andere läuft aus den Daten im Deck.

---

# TEIL 1 · Was und warum (≈5 min)

## Folie 1 — Titel (30s)

> Das ist eine Geschichte in einem Satz: von einer Unterhaltung zu einem gelieferten Feature. Eine Design-Unterhaltung wird zu Entscheidungen, Entscheidungen werden zu Issues, Agenten bauen, prüfen und mergen, und die Docs erinnern sich. Alles, was Sie heute sehen, kommt aus einem einzigen echten Projekt, das heute Morgen ein leeres Repository war.

*(Die Szene rechts erzählt genau das in drei Akten, ca. 40 s pro Durchlauf: Sie erklären, der Rumble-Roboter schreibt mit und fragt zurück, zeigt das Blatt (Issues #2–#5), Daumen hoch. Dann reicht er das Blatt dem Orchestrator, der Triage, Implementer, Quality- und Security-Reviewer spawnt; sie arbeiten, Häkchen. Der Orchestrator gibt einen Monitor mit dem Produkt zurück, der Rumble-Roboter bringt ihn zu Ihnen, Sie nehmen ihn ab. Einmal durchlaufen lassen, dann weiter. Die vier Zahlen darunter: 4 Stunden vom leeren Repo zu vier Features auf main, 15,3 Tsd. Zeilen und 474 Tests ohne eine Zeile von Hand, 38 Review-Findings vor dem Merge, 19 Minuten menschliche Unterhaltung. Die Token-Zahl kommt erst auf der Kostenfolie, dort ist sie pro Station eingeordnet.)*

## Folie 2 — Das Problem (50s)

> Wer mit Coding-Agenten arbeitet, kennt das: der Code kommt schnell. Vier andere Dinge brechen. Erstens Gedächtnis: „Warum ist das Geld ein Integer?“ Niemand weiß es mehr, der Chat ist weg, der Code zeigt nur das Was. Zweitens Scope: eine offene Frage im Prompt wird zur stillen Annahme im Diff. Drittens Vertrauen: grüne CI ist kein Review. Viertens Kosten: niemand weiß, was ein Feature gekostet hat oder welche Station das Budget gefressen hat. Das Framework gibt jedem der vier einen Ort: eine Zeile in den Docs, ein Issue als Vertrag, ein Urteil mit einem menschlichen Gate, einen Trail pro Issue.

*(Die vier Karten erscheinen nacheinander; die Pfeilzeile unten ist jeweils die Antwort.)*

## Folie 3 — Das Beispiel (40s)

> Damit das nicht abstrakt bleibt: Requisit. Ein B2B-Service für Bestellanforderungen. Einkäufer erstellen einen Entwurf, eine Freigaberegel greift, ein Genehmiger entscheidet mit Begründung, die Bestellung geht an den Händler. Viele Organisationen auf einer Instanz, Geld nie als Float, ein Audit-Eintrag pro Zustandswechsel. Klein genug für einen Nachmittag, echt genug, um Autorität, Mandantentrennung und Geld zu haben, also die Dinge, die schiefgehen. Rechts: der Brief, der komplette Input, eine Seite, 386 Wörter. Die vier markierten Zeilen sind die, die Entscheidungen wurden: Freigaberegel sichtbar, Mandantentrennung, Geld ohne Floats, ehrliche Freigaben. Der Rest ist eingeklappt.

## Folie 4 — Fünf Wörter (45s)

> Bevor wir ins Schema gehen, fünf Wörter, die gleich dauernd fallen. Eine Phase ist eine Produktstufe mit Ausstiegskriterium; Requisit ist in Phase 1, dem v1-Flow. Ein Arc ist ein Rumble, ein Task-out, ein Pipeline-Lauf; Arc 1 waren vier Issues an einem Nachmittag. Die Rumble-Session denkt und entscheidet und endet mit task-out. Das Umbrella-Issue hält die Reihenfolge in Wellen, jeder Split ist ein Issue von etwa dreitausend Zeilen, maximal drei Builder pro Welle. Und die Pipeline-Session ist eine frische Session, die nur das Umbrella liest: sie orchestriert, liest nie Code, und geht, wenn das Umbrella zu ist.

*(Die Boxen sind ineinander geschachtelt: Phase außen, Arc innen, die drei Kästen darunter. Rechts unten die echten Wellen: #2, dann #3, dann #4 und #5 parallel.)*

## Folie 5 — Die Docs (60s)

> Das Gedächtnis sind vier Arten von Zeilen, jede mit einer Nummer, die ein Check finden kann. D, Decisions: was gewählt wurde, warum, und was verworfen wurde; append-only, ein PR ergänzt ein Addendum, editiert nie. G, Gaps: eine offene Frage mit dem Auslöser, der sie wieder öffnet. M, Measurements: eine Zahl, die „pending“ heißt, bis sie gemessen ist, nie ein Ziel als Ergebnis verkleidet. Und das Research-Log: jede Suche, die eine Entscheidung geändert hat, mit Quellen. Die Beispiele sind echt: D-003 Geld in Minor Units, G-004 Postgres, M-006 Genehmigungswartezeit. Eine Referenz ohne Zeile ist ein rotes Finding, und check-anchors läuft im Board.

## Folie 6 — Das Schema (75s)

**Alles erscheint zusammen, die Pfeile zeichnen sich in 2 s. Mitsprechen:**

> Zwei Sessions, und das Einzige, was sie teilen, ist GitHub, die Spalte rechts. Oben die Rumble-Session: Sie und der Rumble-Agent reden, daraus werden Zeilen in den Docs, nicht Chat. Task-out, Sie bestätigen die Entwürfe, und in GitHub liegen ein Umbrella und vier Issues in drei Wellen. Dann die rote Linie: neue Session, nur was auf GitHub steht, kommt mit. Warum? Der Rumble-Kontext steckt voller Abwägungen, die den Builder beeinflussen würden, und die Pipeline muss aus GitHub allein reproduzierbar sein, damit jemand anderes die nächste Welle übernehmen kann. Unten: Sie tippen pipeline, der Orchestrator holt sich das Umbrella und spawnt pro Welle Triage, Architekt, Builder, Quality, Security, jeder in seinem eigenen Worktree. Die PRs gehen nach main, jeder Trail als Kommentar zurück ins Issue, und bei risk-high prüfen Sie nach. Ganz unten: die Docs als Gedächtnis, und der gestrichelte Pfeil zurück: der nächste Rumble startet bei den Docs, nicht beim Chat.

*(Die zwei gepunkteten Pillen mit dem Punkt sind die menschlichen Gates.)*

---

# TEIL 2 · Die Stationen, je mit dem echten Artefakt (≈15 min)

Jede Chapter-Folie ist gleich gebaut: links die Rolle (wer, Input, was, Output, Ende), rechts das Artefakt aus Requisit. Sag die Rolle in zwei Sätzen, dann zeig auf das Artefakt.

## Stage 1 — Rumble (90s)

> Ein Mensch und das Modell, eigene Session, Websuche an, kein Code. Der Input ist alles, was der Mensch weiß. Es fragt zurück, recherchiert, wägt ab und schreibt Zeilen: Entscheidungen mit den verworfenen Alternativen, offene Fragen mit dem Auslöser, der sie wieder öffnet, Messgrößen, eine Roadmap, ein Bedrohungsmodell.

**Rechts:**

> Das sind die ersten Zeilen aus Requisit. D-001 der Stack, D-003 Geld als ganze Minor Units, D-004 Mandantentrennung als Form, nicht als Disziplin. Sechs Websuchen mit 24 Quellen sind im Research-Log. Das Ganze: eine Session, 112 Tausend Tokens, und sie endet mit einem Kommando: task-out. Sie baut nie, sie orchestriert nie.

## Stage 2 — Task-out (75s)

> Das Issue ist der ganze Vertrag, geschrieben für einen Agenten ohne jeden Kontext. Ziel, Kontext mit den Entscheidungen, die zu ehren sind, und dem, was ausdrücklich NICHT gebaut wird, testbare Abnahmekriterien, Testerwartungen, Out of scope, Abhängigkeiten. Dazu ein Umbrella-Issue mit der Reihenfolge in Wellen.

**Rechts, auf die Felder zeigen:**

> Issue #2 aus Requisit. Beachten Sie den Kontext: er zählt die Decisions auf und sagt, was nicht dazugehört. Ein Implementierer muss nie fragen, was der Rumble schon beantwortet hat. Links die Wellen: #2 zuerst, dann #3, dann #4 und #5 parallel.

## Stage 3 — Triage (60s)

> Das billigste Modell stempelt, was der Rest der Pipeline liest: Area, Size, Risk. Offene Abhängigkeit heißt blocked, Fragen heißen needs-human. Und die Labels entscheiden: size L ruft den Architekten, die Size wählt das Modell, risk high löst ein Security-Review aus und ein Nach-Review durch einen Menschen.

**Rechts:**

> Issue #2: area api, size L, risk high, pipeline build. Mit einem Satz Begründung. Das ist der ganze Output.

## Stage 4 — Architekt (60s)

> Nur für die Großen. Das stärkste Modell, nur lesend, entwirft innerhalb der entschiedenen Zeilen: Modul-Layout, Verträge, den Testplan je Abnahmekriterium mit der Mutation, die ein Reviewer verlangen soll, neue D-Zeilen, einen Plan für einen PR. Ein Mensch kann die D-Zeilen ablehnen, bevor eine Zeile Code entsteht.

**Rechts:**

> Das Design für #2. Zwei von vier Issues waren size L, beide haben ein Design bekommen. Ehrlich dazu: beide PRs haben die Größenschätzung des Designs gerissen, das steht in M-009.

## Stage 5 — Implementierung (75s)

> Ein Agent, ein isolierter Git-Worktree, im Hintergrund, bis zu drei gleichzeitig. Er bekommt Issue-Nummer, Branch, das Verify-Kommando und die Anweisung: Draft-PR, nicht mergen. Er muss das Board vor dem PR laufen lassen, Mutationen probieren und aufschreiben, was rot wurde, die Docs-Zeilen schreiben, Abweichungen vom Design begründen.

**Rechts:**

> PR #7. Zwei Commits, und der Body listet: welche Suiten, wie viele Tests, 18 Mutationen, alle rot. Das ist die Ausgangs-Evidenz für die Reviewer. Sie fangen nicht bei null an.

## Stage 6 — Review (90s)

> Zwei Linsen: Qualität immer, Security bei risk high. Eigene Worktrees, nur lesend. Sie verwenden die Evidenz des PRs wieder, die genannten Suiten plus höchstens zwei eigene Mutationen, und sie verifizieren jedes Finding, bevor sie es aufschreiben. Ein Kommentar, gruppiert in rot und gelb, endet mit einer Verdict-Zeile. Und: ein Reviewer setzt für ein Rot nie needs-human, ein Rot geht in die Fix-Schleife.

**Rechts, auf das Finding zeigen:**

> Das echte Rot aus #2: die eine Rundungsfunktion des Geldmoduls konnte den sicheren Integer-Bereich verlassen. In v1 unerreichbar, aber exportiert, das nächste Issue hätte es erreicht. Der Reviewer hat es nicht vermutet, er hat es nachgerechnet und den Fix gleich mitgeliefert.

## Stage 7 — Fix-Schleife (60s)

> Derselbe Implementierer, derselbe Branch, die Findings wörtlich. Er behebt jedes Rot, die Nits, wo billig, antwortet sonst mit Begründung, und schreibt einen Kommentar, der jedes Finding auf einen Commit oder eine Begründung abbildet. Re-Review nur durch den Reviewer, der das Rot hielt, nur neue Rots. Nach Runde zwei: ein Mensch. Der Orchestrator zählt.

**Rechts:**

> Eine Runde bei #2: ein Rot und neun Nits behoben, 99 Tests statt 86, Re-Reviews clean.

## Stage 8 — Gate und Trail (75s)

> Die Orchestrator-Session mergt, prüft und schreibt. Sie zieht main selbst in den Branch, auflösen, verifizieren, committen, nie in einem Befehl. Ready, Squash-Merge, dann das volle Board auf main, nach jedem Merge. Risk-high-PRs gehen an einen Menschen zur Nachprüfung. Und der Trail: Stationen mal Modell mal Ergebnis mal Tokens. Das ist das Kostenbuch, das der nächste Rumble liest.

**Rechts:**

> Der Trail von #2: 806 Tausend Tokens, Zeile für Zeile. Daraus ist die Kostenfolie gleich gerechnet.

## Stage 9 — Die Docs (60s)

> Das Gedächtnis: Entscheidungen append-only mit Addenda, wenn ein PR auf die Realität trifft, Gaps mit Auslösern, Messungen, die „pending" sagen, bis gemessen ist, ein Research-Log mit Quellen. Die Regel: eine Aufgabe, die ändert, was ein Doc beschreibt, ändert das Doc im selben Branch. Ein Verweis ohne Zeile ist ein rotes Finding, und ein Check im Board erzwingt das.

**Rechts:**

> Nach Arc 1: 25 Entscheidungen, 18 aus dem Rumble, der Rest aus den PRs. 23 Gaps. Vier von zehn Zahlen gemessen, der Rest steht ehrlich als pending da.

---

# TEIL 3 · Ergebnis, Kosten, Übertragung (≈8 min)

## Produkt (60s)

**Vier echte Seiten (Screenshots aus dem laufenden Dienst); L schaltet auf den Live-Dienst um, wenn er läuft:**

> Requisit läuft. Links oben die Liste der Einkäuferin: drei Anforderungen, drei Zustände, in jeder Zeile die Regel, die gegriffen hat. Rechts der Genehmiger: „wartet auf Otto Owner“, Ablehnen braucht eine Begründung. Unten links die abgelehnte Anforderung mit genau dieser Begründung und der Historie: wer, was, unter welcher Regel, zu welchem Betrag. Unten rechts die Kopie: neuer Entwurf, Link auf die abgelehnte, genehmigt, die Bestellung liegt im Outbox des Händlers. Vier Issues, vier PRs, 474 Tests, null Laufzeit-Abhängigkeiten. Und der Quickstart aus der README ist selbst ein Test, der seed und start als echte Prozesse startet.

## Kosten (75s)

> Erst der Rahmen: ob das viel ist, kann niemand sagen, weil ohne Trail niemand die eigenen Zahlen kennt. Das Framework verspricht nicht billig, es verspricht eine Zahl pro Station und einen Regler dafür. Jetzt die Zahlen aus den Trails, oben pro Feature: 848 Tausend Tokens im Schnitt. Implementierung ist ein knappes Drittel, Reviews ein Viertel, Fix-Runden ein Sechstel. Die zwei risk-high-Issues mit einem Rot kosteten das Zwei- bis Dreifache des einen ohne. Und der Rumble selbst: 112 Tausend, 13 Prozent eines Issues. Das Denken ist der billige Teil, und was es gekauft hat, sieht man an den Fix-Runden: die drehten sich um Dinge, die der Rumble nicht entschieden hatte, nie um entschiedene Zeilen.

## Bestehendes Projekt (60s)

> Die meisten haben das schon, unter anderen Namen. ADRs: die Config zeigt auf den ADR-Index, eine D-Zeile pro ADR, Nummern bleiben. CONTRIBUTING und Security-Policy: werden als Projekt-Abschnitte an den Standards-Kern gehängt, bei Sicherheit gewinnen sie. Die CI bleibt; dazu kommen render check und check-anchors. Backlog, Wiki-Zahlen, offene Fragen: der erste Rumble ist ein lesender Rumble, erst Gaps, dann die kleinste echte Änderung. Und wer nicht auf GitHub ist: der Prozess braucht vier Objekte, Issues, Labels, Branches, PR-Kommentare. Heute GitHub; ein anderer Host ist ein Binding, das man schreibt, keine Prozessänderung.

## Schluss (20s)

> Denken. Vertrag. Bauen. Erinnern. Rumbeln in einer Session, die mit Issues endet, nie mit Code. Bauen in einer Session, die nie Code liest. Das Gedächtnis in den Docs, vom Board geprüft, damit die nächste Unterhaltung da beginnt, wo diese aufgehört hat.

---

## Q&A-Karten

**„Wo passt das bei uns hin?“** — Wo das bei uns hingehört. Agenten auf Einkäufer- und Händlerseite: was ein Agent darf, ist eine Zeile, bevor es Code ist; in Requisit genehmigt der Entwurfsagent nie, im Rumble entschieden, risk-high auf jedem PR, der ihn berührt, im Review durchgesetzt. Erster Schritt wäre ein Rumble über die Befugnisse. PWA: eine framework.json, die CI, die wir haben; erster Schritt: rendern, check in die CI, ein kleines Issue durch die Pipeline. Neuer Commerce-Core: die ADRs sind das Gedächtnis schon; erster Schritt ein lesender Rumble darüber, dann die kleinste echte Änderung als Arc 1. Und beides läuft aus einer Quelle: Claude Code und Codex.

**„Ist 3,4 Millionen viel?“** — Gegenfrage: verglichen womit? Ohne Trail hat niemand die Zahl für die eigene Arbeit. Das Rote ist das Teure: ein Finding kostet eine Fix-Runde plus Re-Review auf Opus. Ein billigeres Modell, das ein Rot mehr produziert, ist am Ende teurer. Darum messen statt raten: Sonnet für size-M ist ein Regler in der Binding, der nächste Arc zeigt in Tokens und Rot-Findings, ob er hält.

**„Meine Kollegin nutzt ein anderes Tool.“** — Die Pipeline sieht nur Issues mit pipeline-build, das nur Triage setzt, und Triage läuft nur, wenn ich pipeline starte. Labels kommen aus der Config, Kollisionen werden umbenannt. Die eine Vereinbarung: Entscheidungen bekommen eine Zeile.

**„Entscheidet der Agent die Architektur?"**
Nein. Der Rumble entscheidet, mit dem Menschen. Der Architekt entwirft innerhalb entschiedener Zeilen und schlägt neue vor, die ein Mensch sehen kann, bevor gebaut wird.

**„Was, wenn der Reviewer falsch liegt?"**
Zwei Fix-Runden, dann needs-human. Verdict und Evidenz stehen im PR, ein Mensch liest sie wie jedes Review und widerspricht per Review-Kommentar, den die Fix-Schleife wie ein Finding behandelt. In Requisit: die Reviewer haben zwei Mutationen als „grün per Konstruktion" erklärt, statt sie zu erzwingen, das steht so im PR.

**„Was hat es gekostet, in Geld?"**
Auf einem Abo ohne Token-Preis. Die Token stehen pro Station im Trail (M-007), eine Umrechnung auf API-Listenpreise ist eine Zeile Rechnung, absichtlich nicht als Ergebnis verkauft.

**„Warum haben zwei PRs die 3k-Zeilen-Grenze gerissen?"**
Testvolumen, nicht Feature-Volumen. #3 waren 2,6k Zeilen Code und 2,8k Zeilen Tests, die der Testplan des Designs verlangte. Der Orchestrator hat bewusst einen PR gelassen, weil der Schnittpunkt eine erste Hälfte über der Grenze und ein zweites risk-high-Review gekostet hätte. M-009 sagt: Grenze auf src-Zeilen beziehen oder L-Issues in API-Hälfte und Test-Hälfte schneiden.

**„Existierende ADRs?"**
Folie „Bestehendes Projekt": docs.decisions zeigt auf den ADR-Index, Nummern bleiben, neue Entscheidungen werden ADR-Datei und Zeile.

**„Codex oder Claude?"**
Beides, eine Quelle, zwei Bindings. Requisit rendert beide Agentensätze aus demselben framework.json.

**„Was ist im Rumble schiefgegangen?"**
Ehrlich: die drei echten Bugs kamen aus Lücken, die der Rumble nicht entschieden hatte, nicht aus entschiedenen Zeilen: Refusals nach dem ersten Write, der Akteur im Idempotenz-Schlüssel, der Merchant-Scope. Alle drei stehen jetzt als D-Addenda bzw. G-Zeilen, der nächste Rumble liest sie.

---

## Zahlen mit Quelle

| Zahl | Was | Quelle |
|---|---|---|
| 4 Issues · 4 PRs | Arc 1 | Umbrella #6, PRs #7–#10 |
| 474 Tests | Board auf main nach #10 | Trail auf #5 |
| 25 D · 23 G · 10 M (4 gemessen) | Docs nach Arc 1 | check-anchors, docs/16 |
| 38 Findings, 5 rot | Erst-Reviews der vier PRs | Verdict-Zeilen auf #7–#10 |
| 3 390 984 Tokens | Pipeline Arc 1 | M-007, Trails |
| 111 974 Tokens | der Rumble | M-008 |
| 4 164 · 5 502 · 3 177 · 2 443 Zeilen | PR-Größen | M-009 |
| 6 Suchen · 24 Quellen | Research-Log | docs/15 |
