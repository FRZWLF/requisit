# Sprechertext · 10-Minuten-Fassung

Gleiche Folien, gleiches Deck — aber nur sieben Folien bekommen Redezeit. Der Rest wird
durchgeblättert, mit höchstens einem Satz. Die Langfassung ([speaker-notes.md](speaker-notes.md))
bleibt für einen längeren Slot; die Q&A-Karten und die Zahlentabelle von dort gelten hier genauso.

Gesamt: etwa 9 Minuten Text. Mit deinem Tempo landest du bei ~10–11. Wenn du bei der
Kostenfolie schon über Minute 9 bist: Produkt-Folie auslassen, direkt zu den Kosten.

**Die eine Regel dieser Fassung:** Alles, was du weglässt, ist nicht weg — es ist Q&A.
Sag das am Ende einmal laut, dann ist das Kürzen kein Verlust, sondern ein Angebot.

Zeitplan an der Uhr (Foliennummer = Reihenfolge im Deck):

| Uhr | Folie | Zeit |
|---|---|---|
| 0:00 | 1 Titel | 1:00 |
| 1:00 | 2 Problem | 1:00 |
| 2:00 | 3 Requisit *(ein Atemzug)* + 4–5 *(durchblättern)* | 0:45 |
| 2:45 | 6 Schema | 2:00 |
| 4:45 | 7 *(blättern)* · 8 Task-out | 1:00 |
| 5:45 | 9–11 *(blättern, ein Satz)* · 12 Review | 1:45 |
| 7:30 | 13–15 *(blättern, ein Satz)* | 0:30 |
| 8:00 | 16 Produkt | 0:30 |
| 8:30 | 17 Kosten | 1:00 |
| 9:30 | 18 *(blättern)* · 19 Schluss | 0:30 |

---

## Folie 1 — Titel (1:00)

*Nicht sofort losreden. Einmal in den Raum schauen. Aber: nur EINE Frage, nicht zwei.*

> Wer von euch hat in den letzten Wochen einen Coding-Agenten etwas bauen lassen — und
> könnte mir heute noch sagen, *warum* der Agent es genau so gebaut hat?

> Darum geht es. Nicht, ob Agenten Code schreiben können. Sondern was drumherum passieren
> muss, damit man dem Ergebnis traut. Ich zeige euch dafür ein Framework — an einem echten
> Projekt, das ich damit an einem Nachmittag hochgezogen habe. Leeres Repository bis vier
> Features auf main.

*Auf die Szene zeigen, ein Satz:*

> Rechts die ganze Geschichte in Kurzform: ich rede mit einem Agenten, der reicht das
> Ergebnis an einen Orchestrator, der holt sich einen Schwarm. Die Zahlen darunter sind
> echt — vier Stunden, vier Features, fünfzehntausend Zeilen, und neunzehn Minuten davon
> war ich am Reden.

## Folie 2 — Das Problem (1:00)

*Vier Karten, je EIN Satz. Nicht ausmalen.*

> Was bricht? Vier Dinge. Das Gedächtnis — der Chat ist weg, der Code sagt nie *warum*.
> Der Scope — jede offene Frage beantwortet der Agent still selbst. Das Vertrauen — grüne
> CI ist kein Review. Und die Kosten — niemand weiß, was ein Feature gekostet hat.

> Das Framework gibt jedem der vier einen festen Ort: eine Zeile in den Docs, ein Issue
> als Vertrag, ein Urteil, auf das ein Mensch schaut, und ein Kostenbuch pro Issue.

## Folie 3 — Requisit (0:20, ein Atemzug)

> Das Beispiel: Requisit, ein B2B-Service für Bestellanforderungen. Entwurf, Freigaberegel,
> Genehmigung mit Begründung, Audit. Klein genug für einen Nachmittag, echt genug für die
> Dinge, die schiefgehen: Berechtigungen, Mandanten, Geld. Der komplette Input war eine
> Seite — 386 Wörter.

## Folien 4–5 — durchblättern (0:20)

*Vokabeln und Docs-Zeilen NICHT erklären. Beim Blättern ein Satz:*

> Zwei Begriffe reichen euch gleich: eine **Rumble-Session** ist das Denken mit dem Modell,
> und die Docs halten jede Entscheidung als nummerierte Zeile fest — ein Verweis auf eine
> Zeile, die es nicht gibt, ist ein rotes Finding.

## Folie 6 — Das Schema (2:00) — das Herzstück

*Von links oben nach rechts unten. Hier darfst du langsam sein.*

> So läuft es. Zwei Sessions, und das Einzige, was sie teilen, ist GitHub.

> Oben: ich und der Rumble-Agent. Wir reden, recherchieren, wägen ab — und aus dem
> Gespräch werden Zeilen in den Docs. Geld als ganze Minor Units. Mandantentrennung durch
> die Form der Tabellen. Dann task-out: auf GitHub liegen ein Umbrella und vier Issues.

*Auf die rote Linie zeigen.*

> Dann diese Linie. Neue Session, nichts kommt mit außer dem, was auf GitHub steht. Warum?
> Der Rumble-Kontext ist voll mit Verworfenem und halben Ideen — das würde den Builder
> beeinflussen. Und morgen soll jemand anderes die nächste Welle übernehmen können.

> Unten die Pipeline: Triage stempelt Größe und Risiko, ein Architekt entwirft die großen
> Issues, Builder arbeiten in isolierten Worktrees, drei gleichzeitig, dann zwei Reviewer.
> Die PRs gehen nach main, der Kosten-Trail zurück ins Issue. Und die gepunkteten Stellen —
> das bin ich. Es läuft nicht von allein, das ist Absicht.

## Folie 7 — blättern (ein Satz)

> Den Rumble habt ihr im Schema gesehen — eine Session, sechs Websuchen, und sie endet
> mit Issues, nie mit Code.

## Folie 8 — Task-out: das Issue als Vertrag (1:00)

> Das hier ist der Vertrag. Geschrieben für einen Agenten, der *nichts* weiß — kein Chat,
> kein Kontext, nur das Issue.

*Rechts auf die Felder zeigen.*

> Issue Nummer zwei, echt: Ziel, die Entscheidungen, die zu ehren sind, testbare
> Abnahmekriterien — und ausdrücklich, was *nicht* gebaut wird. Der Implementierer muss
> nie fragen, was der Rumble schon beantwortet hat. Das ist die Antwort auf das
> Scope-Problem von Folie zwei.

## Folien 9–11 — blättern (ein Satz)

> Triage, Architekt, Implementierung — die Details überspringe ich, ein Satz: das Ende
> jeder Implementierung ist ein Draft-PR, der seine eigene Evidenz mitbringt. 99 Tests,
> 18 Mutationen, absichtlich kaputt gemacht und geprüft, ob ein Test rot wird.

## Folie 12 — Das Review-Finding (1:45) — der stärkste Moment, Zeit lassen

> Und mit dieser Evidenz fangen die Reviewer an, nicht bei null. Zwei Linsen — Qualität
> immer, Security bei hohem Risiko. Und jedes Finding wird verifiziert, bevor es
> aufgeschrieben wird.

*Rechts auf das Finding zeigen. Pause.*

> Das hier ist das echte Rot aus Issue zwei. Die Rundungsfunktion im Geldmodul konnte den
> sicheren Integer-Bereich verlassen. In Version eins unerreichbar — aber exportiert, und
> das nächste Issue hätte sie erreicht.

> Der Reviewer hat das nicht vermutet. Er hat es *nachgerechnet*. Da steht die Zahl, da
> steht die richtige Zahl daneben, und der Fix ist gleich mit drin. — Das ist der
> Unterschied zwischen „sieht komisch aus" und einem Finding.

## Folien 13–15 — blättern (0:30)

> Danach: eine Fix-Runde, höchstens zwei, dann kommt ein Mensch. Der Merge, das volle
> Board auf main, und der Trail — wer, was, wie viele Tokens. Und die Docs wachsen mit:
> die vier PRs haben sieben Entscheidungen dazugelegt, genau da, wo das Design auf die
> Realität getroffen ist.

## Folie 16 — Produkt (0:30) *(bei Zeitnot komplett auslassen)*

> So sieht Requisit aus. Entwurf, Regel, Ablehnung mit Begründung, die Historie dazu.
> Vier Issues, vier PRs, 474 Tests, null Laufzeit-Abhängigkeiten.

## Folie 17 — Kosten (1:00)

> Die Kosten. Vorweg: ob das viel ist, kann niemand sagen — weil niemand die Zahl für die
> eigene Arbeit kennt. Das Framework verspricht nicht „billig". Es verspricht eine Zahl
> pro Station und für jede Station einen Regler.

> 848 Tausend Tokens pro Feature. Ein Drittel Bauen, über ein Drittel Review, ein Sechstel
> Fixen. Und das Denken — der Rumble — ist *drei Prozent*. Das Teure ist das Rot: ein
> Finding heißt Fix-Runde plus Re-Review. Deshalb misst man, statt zu raten.

## Folie 18 — blättern (ein Satz)

> Und ihr braucht kein leeres Repository — ADRs, CONTRIBUTING, CI, das ist alles schon das
> Gedächtnis unter anderen Namen. Fragt mich gleich danach.

## Folie 19 — Schluss (0:30)

*Langsam.*

> Vier Wörter. Denken. Vertrag. Bauen. Erinnern. — Denken in einer Session, die mit
> Issues endet. Bauen in einer Session, die nie Code liest. Und das Gedächtnis in den
> Docs, vom Board geprüft.

> Alles, was ich heute übersprungen habe — Triage, Architekt, die Fix-Schleife, wie das
> in ein bestehendes Projekt kommt — beantworte ich gern jetzt. Beide Repos sind offen. —
> Fragen?
