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

## Folie 2 — Das Problem (45s)

> Wer mit Coding-Agenten arbeitet, kennt das: der Code kommt schnell. Drei andere Dinge brechen. Erstens Gedächtnis: zwei Wochen später weiß niemand mehr, warum das Geld ein Integer ist, der Chat ist weg, der Code zeigt nur das Was. Zweitens Scope: eine offene Frage im Prompt wird zur stillen Annahme im Diff, und das Review streitet über die Annahme statt über den Code. Drittens Vertrauen: grüne CI ist kein Review. Das Framework gibt jedem der drei einen Ort: eine Zeile in den Docs, ein Issue als Vertrag, einen Trail pro Issue.

## Folie 3 — Das Beispiel (40s)

> Damit das nicht abstrakt bleibt: Requisit. Ein B2B-Service für Bestellanforderungen. Einkäufer erstellen einen Entwurf, eine Freigaberegel greift, ein Genehmiger entscheidet mit Begründung, die Bestellung geht an den Händler. Viele Organisationen auf einer Instanz, Geld nie als Float, ein Audit-Eintrag pro Zustandswechsel. Klein genug für einen Nachmittag, echt genug, um Autorität, Mandantentrennung und Geld zu haben, also die Dinge, die schiefgehen. Rechts: der Brief, der komplette Input. Eine Seite.

## Folie 4 — Das Schema (60s)

**Erst die Lanes, dann die Knoten von links nach rechts:**

> Drei Sessions, neun Stationen, ein Repository. Oben die Rumble-Session: ein Mensch und das Modell denken und entscheiden, sie endet mit Issues. In der Mitte die Pipeline-Session: ein Orchestrator, der nie Code liest, und Agenten, die je eine Aufgabe haben. Unten das Repository: die Docs als Gedächtnis, und der Pfeil zurück nach oben: der nächste Rumble liest die Docs, nicht den Chat. Wir zoomen jetzt in jede Station.

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

**L drücken, dann durchklicken:**

> Requisit läuft. Ein Einkäufer entwirft, die Regel greift, der Genehmiger lehnt mit Begründung ab, das Audit zeigt es, der Händler pollt die Bestellung. Vier Issues, vier PRs, 474 Tests, null Laufzeit-Abhängigkeiten. Und der Quickstart aus der README läuft wörtlich, das prüft ein Test, der seed und start als echte Prozesse startet.

## Kosten (75s)

> Ehrliche Zahlen aus den Trails. 3,39 Millionen Tokens für vier Issues. Implementierung ist ein knappes Drittel, Reviews ein Viertel, Fix-Runden ein Sechstel. Die zwei risk-high-Issues mit einem Rot kosteten das Zwei- bis Dreifache des einen ohne. Und der Rumble selbst: 112 Tausend, 13 Prozent eines Issues. Das Denken ist der billige Teil, und was es gekauft hat, sieht man an den Fix-Runden: die drehten sich um Dinge, die der Rumble nicht entschieden hatte, nie um entschiedene Zeilen.

## Bestehendes Projekt (60s)

> Sie haben das meiste schon unter anderen Namen. ADRs: die Decisions-Doc zeigt auf den ADR-Index, eine D-Zeile pro ADR, Nummern bleiben. CONTRIBUTING und Security-Policy: werden an die Standards angehängt, Ihre gewinnen bei Sicherheit. Ihre CI bleibt, zwei Checks kommen dazu. Und der erste Rumble ist ein Lese-Rumble: erst die Gaps, dann die kleinste echte Änderung.

## Teams (60s)

> Das Issue ist der Vertrag, also ist der Autor egal. Alle rumbeln, die Zeilen kommen als PR und werden geprüft wie Code. Ein Mensch pro Arc orchestriert, der Zustand liegt auf GitHub, die nächste Welle kann jemand anderes übernehmen. Verdicts und Trails sind für jemanden geschrieben, der nicht dabei war. Und wer mergt, ist Konfiguration: gate.merge human, und das Gate stoppt bei „ready for review".

## Hier (45s)

> Wo das bei uns hinpasst: Agent-Features auf Buyer- und Merchant-Seite sind genau das, eine Entscheidung plus ein Vertrag plus ein geprüfter PR. Was ein Agent darf, ist eine D-Zeile und ein Risk-Label, bevor es Code ist. PWA und Commerce Core bekommen je ein framework.json, ein Framework-Repo. Und es läuft mit Claude Code und Codex aus derselben Quelle.

## Schluss (20s)

> Denken. Vertrag. Bauen. Erinnern. Rumbeln in einer Session, die mit Issues endet, nie mit Code. Bauen in einer Session, die nie Code liest. Das Gedächtnis in den Docs, vom Board geprüft, damit die nächste Unterhaltung da beginnt, wo diese aufgehört hat.

---

## Q&A-Karten

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
