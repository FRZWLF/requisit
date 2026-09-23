# Sprechertext · Rumble Framework, gezeigt an Requisit

Das hier ist zum Sprechen, nicht zum Lesen. Kurze Sätze, Pausen sind mit „—" markiert. Kursiv sind Regieanweisungen. Die Anrede ist „ihr", weil es Kolleginnen und Kollegen sind; wenn ihr euch siezt, einmal Suchen-Ersetzen.

Gesamt: etwa 25 Minuten plus Fragen.

---

## Der rote Faden (falls du den Faden verlierst)

Du erzählst eine einzige Geschichte: **Ich habe mit einem Agenten geredet, und am Ende lag ein Feature auf main. Dazwischen war ein Prozess, und den zeige ich euch an einem echten Projekt.**

Vier Stationen der Geschichte:

1. **Was bricht**, wenn Agenten Code schreiben: Gedächtnis, Scope, Vertrauen, Kosten.
2. **Wie der Prozess aussieht**: zwei Sessions, GitHub dazwischen, die Docs als Gedächtnis.
3. **Der Beweis**: Requisit, Station für Station, mit dem echten Issue, dem echten PR, dem echten Finding.
4. **Was rauskam und was es gekostet hat.** Und wie man das in ein bestehendes Projekt bringt.

Wenn du hängst: sag laut, in welcher der vier du bist, und geh weiter.

---

## Vorbereitung (fünf Minuten vorher)

1. Deck öffnen, **F** für Vollbild. Weiter mit **→**. **M** springt jederzeit zum Schema.
2. Zweites Fenster: `github.com/FRZWLF/requisit`, Issues und PRs, für Nachfragen.
3. Optional Requisit starten (`PORT=3123`, README-Quickstart). Auf der Produktfolie schaltet **L** dann auf den Live-Dienst. Ohne Dienst zeigt die Folie die Screenshots, das reicht.
4. Wasser. Die Titel-Animation läuft 40 Sekunden, das ist deine Zeit zum Ankommen.

---

# TEIL 1 · Was und warum (etwa 6 Minuten)

## Folie 1 — Titel

*Folie steht, die Szene rechts läuft. Nicht sofort losreden. Einmal in den Raum schauen.*

> Ich fang mit einer Frage an. — Wer von euch hat in den letzten Wochen einen Coding-Agenten etwas bauen lassen? — Und wer von euch könnte mir heute noch sagen, warum der Agent es genau so gebaut hat und nicht anders?

> Das ist der Punkt, um den es heute geht. Nicht, ob Agenten Code schreiben können. Das können sie. Sondern, was drumherum passieren muss, damit man dem Ergebnis trauen kann. Und damit man in drei Wochen noch weiß, was man da eigentlich entschieden hat.

> Ich zeige euch dafür ein Framework, das ich gebaut habe. Und ich zeige es nicht abstrakt, sondern an einem Projekt, das ich damit an einem Nachmittag hochgezogen habe. Von einem leeren Repository bis zu vier Features auf main.

*Auf die Szene zeigen.*

> Was ihr da rechts seht, ist die ganze Geschichte in Kurzform. Ich rede mit einem Agenten, der schreibt mit und fragt nach. Dann reicht er das Ergebnis an einen Orchestrator, und der holt sich einen Schwarm: Triage, Implementer, zwei Reviewer. Die arbeiten. Und am Ende bekomme ich das Feature zurück.

*Die Zahlen unten nur kurz antippen, nicht vorlesen.*

> Die Zahlen darunter sind echt. Vier Stunden, vier Features, fünfzehntausend Zeilen mit Tests, keine davon von Hand. Und neunzehn Minuten davon war ich am Reden. Der Rest waren Agenten.

## Folie 2 — Das Problem

> Also, was bricht? Ich sehe vier Dinge, immer wieder.

*Karten kommen nacheinander, mit jeder Karte einen Satz.*

> Erstens: das Gedächtnis. Der Chat ist weg, und der Code zeigt nur, *was* gebaut wurde, nie *warum*. „Warum ist das Geld hier ein Integer?" — Keine Ahnung mehr.

> Zweitens: der Scope. Jede Frage, die ich im Prompt offen lasse, beantwortet der Agent selbst. Still. Und dann streitet das Review über die Annahme, nicht über den Code.

> Drittens: Vertrauen. Grüne CI ist kein Review. Ich will wissen, was getestet wurde, was jemand absichtlich kaputt gemacht hat, um zu sehen, ob der Test anschlägt, und wo vom Plan abgewichen wurde.

> Und viertens, das vergisst man gern: Kosten. Niemand weiß, was ein Feature gekostet hat. Oder welche Station im Prozess das Budget aufgefressen hat.

> Das Framework gibt jedem dieser vier Punkte einen festen Ort. Eine Zeile in den Docs. Ein Issue, das der komplette Vertrag ist. Ein Urteil mit einer Stelle, wo ein Mensch draufschaut. Und einen Trail pro Issue, der sagt, was es gekostet hat.

## Folie 3 — Das Beispiel

> Damit das nicht abstrakt bleibt, das Beispielprojekt. Requisit. Ein B2B-Service für Bestellanforderungen.

> Eine Einkäuferin macht einen Entwurf. Eine Freigaberegel greift, je nach Betrag. Ein Genehmiger entscheidet, mit Begründung. Und die Bestellung geht an den Händler. Mehrere Firmen auf einer Instanz, Geld nie als Fließkommazahl, ein Audit-Eintrag bei jedem Zustandswechsel.

> Warum das? Weil es klein genug ist, um es an einem Nachmittag zu lesen. Und echt genug, um die Dinge drin zu haben, die normalerweise schiefgehen: Berechtigungen, Mandantentrennung, Geld.

*Rechts auf den Brief zeigen.*

> Das rechts ist der komplette Input. Eine Seite, 386 Wörter. Mehr habe ich dem Agenten nicht gegeben. Die vier markierten Zeilen sind die, aus denen später Entscheidungen wurden.

## Folie 4 — Fünf Wörter

> Bevor ich ins Schema gehe, fünf Wörter, die gleich dauernd fallen. Sonst verliert ihr mich.

> Eine **Phase** ist eine Produktstufe mit einem Ausstiegskriterium. Requisit ist in Phase eins, der erste Durchstich.

> Ein **Arc** ist ein Durchlauf: einmal denken, einmal Issues schreiben, einmal die Pipeline laufen lassen. Arc eins waren vier Issues.

> Die **Rumble-Session** ist das Denken. Ein Mensch und das Modell. Sie endet mit einem Kommando, task-out, und dann liegen die Issues auf GitHub.

> Das **Umbrella-Issue** hält die Reihenfolge. In Wellen, höchstens drei Builder gleichzeitig. Jedes einzelne Issue nenne ich einen Split, ungefähr dreitausend Zeilen.

> Und die **Pipeline-Session** ist eine frische Session, die nur das Umbrella liest. Sie orchestriert, sie liest nie selbst Code, und sie hört auf, wenn das Umbrella zu ist.

## Folie 5 — Die Docs

> Jetzt das Gedächtnis. Darauf lege ich am meisten Wert, weil es das ist, was überall sonst fehlt.

> Vier Arten von Zeilen. Jede hat eine Nummer, und die Nummer kann ein Check finden.

> **D** wie Decision: was gewählt wurde, warum, und was verworfen wurde. Wird nie editiert. Wenn ein PR später auf die Realität trifft, hängt er einen Zusatz dran.

> **G** wie Gap: eine offene Frage. Mit dem Auslöser, der sie wieder aufmacht. Nicht „irgendwann Postgres", sondern „Postgres, wenn wir eine zweite Instanz brauchen".

> **M** wie Measurement: eine Zahl, die wir wissen wollen. Die steht als „pending" da, bis sie gemessen ist. Nie ein Ziel, das sich als Ergebnis verkleidet.

> Und das Research-Log: jede Suche, die eine Entscheidung geändert hat, mit Quellen. Damit der nächste nicht nochmal sucht.

> Die Beispiele auf der Folie sind echt. D-003 ist die Geldentscheidung. G-004 ist Postgres. M-006 ist die Wartezeit auf eine Genehmigung.

> Und die Regel dahinter: ein Verweis auf eine Zeile, die es nicht gibt, ist ein rotes Finding. Das prüft ein Skript, und das läuft mit den Tests.

## Folie 6 — Das Schema

*Alles erscheint zusammen, die Pfeile zeichnen sich. Von links oben nach rechts unten durchgehen.*

> So läuft es wirklich. Zwei Sessions. Und das Einzige, was sie teilen, ist GitHub, die Spalte rechts.

> Oben: ich und der Rumble-Agent. Wir reden, und aus dem Gespräch werden Zeilen in den Docs. Nicht Chat, Zeilen. Dann task-out, ich bestätige die Entwürfe, und auf GitHub liegen ein Umbrella und vier Issues.

*Auf die rote Linie zeigen.*

> Dann diese Linie. Neue Session. Nichts kommt mit, außer dem, was auf GitHub steht. — Warum? Zwei Gründe. Der Rumble-Kontext ist voll mit Abwägungen, Verworfenem, halben Ideen. Das würde den Builder beeinflussen. Und die Pipeline muss aus GitHub allein laufen können, damit morgen jemand anderes die nächste Welle übernehmen kann.

> Unten: ich tippe pipeline. Der Orchestrator holt sich das Umbrella und spawnt pro Welle seine Agenten. Triage, Architekt, Builder, Quality, Security. Jeder in seinem eigenen Worktree, jeder mit genau einer Aufgabe. Die PRs gehen nach main. Der Trail geht als Kommentar zurück ins Issue. Und bei hohem Risiko schaue ich nach dem Merge selbst drauf.

> Und ganz unten der gestrichelte Pfeil: der nächste Arc beginnt bei den Docs. Nicht beim Chat.

*Die zwei gepunkteten Pillen sind die Stellen, wo ein Mensch entscheidet. Wenn jemand fragt „läuft das ganz allein?", darauf zeigen.*

---

# TEIL 2 · Die Stationen, jede mit dem echten Artefakt (etwa 14 Minuten)

*Jede Folie ist gleich gebaut: links die Rolle, rechts das echte Ding aus Requisit. Die Rolle in zwei, drei Sätzen. Dann rüberzeigen und das Artefakt erzählen. Das Artefakt ist der interessante Teil.*

## Station 1 — Rumble

> Station eins, der Rumble. Ein Mensch und das Modell, eigene Session, Websuche an, kein Code.

> Der Input ist alles, was ich weiß. Ein Brief, alte Entscheidungen, Randbedingungen, Geschmack. Das Modell fragt zurück, recherchiert, wägt ab. Und es schreibt Zeilen. Entscheidungen mit den verworfenen Alternativen. Offene Fragen mit Auslöser. Messgrößen. Eine Roadmap. Ein Bedrohungsmodell.

*Rechts.*

> Das hier sind die ersten Zeilen aus Requisit. D-001 der Stack. D-003 Geld als ganze Minor Units, mit der Begründung, was wir *nicht* nehmen: keine Geldbibliothek, keine Floats. D-004 Mandantentrennung, und zwar durch die Form der Tabellen, nicht durch Disziplin.

> Das Ganze war eine Session. Sechs Websuchen, 24 Quellen, 112 Tausend Tokens. Und sie endet mit einem Kommando: task-out. Sie baut nie. Sie orchestriert nie.

## Station 2 — Task-out

> Station zwei. Das Issue ist der ganze Vertrag. Geschrieben für einen Agenten, der nichts weiß. Kein Chat, kein Kontext, nur das Issue.

> Also steht alles drin. Ziel. Kontext mit den Entscheidungen, die zu ehren sind, und mit dem, was ausdrücklich *nicht* gebaut wird. Testbare Abnahmekriterien. Was die Tests beweisen sollen. Was nicht dazugehört. Abhängigkeiten.

*Rechts auf die Felder zeigen.*

> Das ist Issue Nummer zwei. Schaut euch den Kontext an: er zählt die Decisions auf, und er sagt, was nicht dazugehört. Der Implementierer muss nie fragen, was der Rumble schon beantwortet hat.

> Links die Wellen. Zwei zuerst, dann drei, dann vier und fünf parallel.

## Station 3 — Triage

> Station drei ist die billigste. Das kleinste Modell stempelt, was alle anderen danach lesen. Ein Bereich, eine Größe, ein Risiko.

> Und diese Stempel entscheiden. Größe L ruft den Architekten. Die Größe wählt das Modell für den Builder. Risiko hoch löst ein Security-Review aus, und danach schaue ich selbst drauf.

*Rechts.*

> Issue zwei: area api, size L, risk high, pipeline build. Ein Satz Begründung. Das ist der ganze Output, und darunter seht ihr, was diese vier Labels bei diesem Issue tatsächlich ausgelöst haben.

## Station 4 — Architekt

> Station vier, nur für die Großen. Das stärkste Modell, nur lesend, entwirft. Aber innerhalb der entschiedenen Zeilen. Es entscheidet nicht, ob wir SQLite nehmen. Das ist entschieden. Es entwirft, wie die Module aussehen, welche Verträge, welcher Testplan, und für jedes Abnahmekriterium die Mutation, die ein Reviewer verlangen soll.

> Und es schlägt neue D-Zeilen vor. Die kann ich ablehnen, bevor eine Zeile Code geschrieben ist.

*Rechts.*

> Das ist das Design für Issue zwei, als Gliederung. Zwei von vier Issues waren groß, beide haben ein Design bekommen. Ehrlich dazu: beide PRs haben die Größenschätzung des Designs gerissen. Das steht so in M-009, und der Grund kommt gleich.

## Station 5 — Implementierung

> Station fünf. Ein Agent, ein isolierter Git-Worktree, im Hintergrund. Bis zu drei gleichzeitig.

> Er bekommt: die Issue-Nummer, den Branch, das Verify-Kommando, und die Anweisung „Draft-PR, nicht mergen". Und er muss ein paar Dinge tun, bevor der PR aufgeht. Das Board laufen lassen. Mutationen probieren, also absichtlich etwas kaputt machen und aufschreiben, ob ein Test rot wurde. Die Docs-Zeilen schreiben, die das Issue verlangt. Und jede Abweichung vom Design begründen.

*Rechts.*

> PR sieben. Zwei Commits, und der Body listet alles auf: welche Suiten, 99 Tests, 18 Mutationen, alle rot. Das ist die Evidenz, mit der die Reviewer anfangen. Sie fangen nicht bei null an.

## Station 6 — Review

> Station sechs, das Review. Zwei Linsen. Qualität immer. Security, wenn das Risiko hoch ist. Eigene Worktrees, nur lesend.

> Sie verwenden die Evidenz aus dem PR wieder. Die genannten Suiten, plus höchstens zwei eigene Mutationen. Und, das ist mir wichtig: sie verifizieren jedes Finding, bevor sie es aufschreiben. Ein Kommentar, gruppiert in rot und gelb, und am Ende eine Verdict-Zeile, die jeder lesen kann, auch wer nicht dabei war.

*Rechts auf das Finding zeigen. Das ist der stärkste Moment des Vortrags, Zeit lassen.*

> Das hier ist das echte Rot aus Issue zwei. Die eine Rundungsfunktion im Geldmodul konnte den sicheren Integer-Bereich verlassen. In Version eins unerreichbar. Aber exportiert, und das nächste Issue hätte sie erreicht.

> Der Reviewer hat das nicht vermutet. Er hat es nachgerechnet. Da steht die Zahl, da steht die richtige Zahl daneben, und der Fix ist gleich mit drin. — Das ist der Unterschied zwischen „sieht komisch aus" und einem Finding.

## Station 7 — Fix-Schleife

> Station sieben. Derselbe Implementierer, derselbe Branch, die Findings wörtlich.

> Er behebt jedes Rot. Die Gelben, wo es billig ist. Sonst antwortet er mit einer Begründung. Und er schreibt einen Kommentar, der jedes Finding auf einen Commit oder eine Begründung abbildet. Dann Re-Review, aber nur durch den Reviewer, der das Rot hatte, und nur neue Rots. Nach Runde zwei ist Schluss, dann kommt ein Mensch. Der Orchestrator zählt mit.

*Rechts.*

> Bei Issue zwei war es eine Runde. Ein Rot und neun Gelbe behoben, 99 Tests statt 86, und beide Re-Reviews sagen: sauber.

## Station 8 — Gate und Trail

> Station acht. Jetzt merged die Orchestrator-Session. Sie liest keinen Code, aber sie merged, prüft und schreibt.

> Sie zieht main selbst in den Branch. Auflösen, verifizieren, committen, drei Schritte, nie ein verketteter Befehl. Dann Squash-Merge. Dann das volle Board auf main, nach jedem einzelnen Merge. Und wenn das Risiko hoch war, bekomme ich den PR zur Nachprüfung.

> Und dann der Trail. Station mal Modell mal Ergebnis mal Tokens. Das ist das Kostenbuch. Das liest der nächste Rumble.

*Rechts.*

> Der Trail von Issue zwei. 806 Tausend Tokens, Zeile für Zeile, wer was gemacht hat und was es gekostet hat. Daraus ist die Kostenfolie gleich gerechnet.

## Station 9 — Die Docs, danach

> Station neun schließt den Kreis. Die Docs nach dem Arc.

> Der Rumble hatte 18 Entscheidungen geschrieben. Die vier PRs haben sieben dazugelegt und vierzehn ergänzt, genau da, wo das Design auf die Realität getroffen ist. Zum Beispiel: wer eine Anfrage wiederholt, muss dieselbe Person sein. Das stand nirgends.

> Die Regel: eine Aufgabe, die ändert, was ein Doc beschreibt, ändert das Doc im selben Branch. Und der Check im Board erzwingt es.

*Rechts.*

> Nach Arc eins: 25 Entscheidungen, 23 offene Fragen, zehn Messgrößen, vier davon gemessen. Der Rest steht ehrlich als pending da. Und die vier Fragen unten sind die Websuchen, die etwas geändert haben.

---

# TEIL 3 · Ergebnis, Kosten, Übertragung (etwa 5 Minuten)

## Produkt

*Vier Screenshots. Wenn der Dienst läuft, L drücken und live durchklicken.*

> So sieht Requisit aus. Links oben die Liste der Einkäuferin. Drei Anforderungen, drei Zustände, und in jeder Zeile steht die Regel, die gegriffen hat.

> Rechts der Genehmiger. „Wartet auf Otto Owner". Ablehnen geht nur mit Begründung.

> Unten links die abgelehnte Anforderung. Da steht genau diese Begründung, und darunter die Historie: wer, was, unter welcher Regel, zu welchem Betrag.

> Und unten rechts die Kopie. Neuer Entwurf, mit Link auf die abgelehnte. Genehmigt. Die Bestellung liegt beim Händler in der Outbox.

> Vier Issues, vier PRs, 474 Tests, null Laufzeit-Abhängigkeiten. Und der Quickstart aus der README ist selbst ein Test. Er startet seed und start als echte Prozesse und geht den Ablauf durch.

## Kosten

*Erst den Rahmen setzen, dann die Zahlen. Nicht andersrum.*

> Jetzt die Kosten. Und bevor ihr die Zahl seht, eine Sache vorweg. Ob das viel ist, kann niemand sagen. Weil niemand die Zahl für die eigene Arbeit kennt. Ohne Trail misst keiner.

> Was das Framework verspricht, ist nicht „billig". Es verspricht eine Zahl pro Station. Und für jede Station einen Regler.

> Also: 848 Tausend Tokens pro Feature im Schnitt. Ein knappes Drittel ist Bauen. Über ein Drittel ist Review, erster Durchgang und Nachprüfung. Ein Sechstel ist Fixen. Und der Rumble, das Denken, ist drei Prozent.

> Zwei Dinge daran. Das Denken ist der billige Teil, und was es gekauft hat, sieht man an den Fix-Runden: die drehten sich um Dinge, die der Rumble *nicht* entschieden hatte. Nie um entschiedene Zeilen.

> Und: das Teure ist das Rot. Ein rotes Finding heißt Fix-Runde plus Re-Review. Die zwei Issues mit einem Rot haben das Zwei- bis Dreifache gekostet. Ein billigeres Modell, das ein Rot mehr produziert, ist am Ende teurer. Deshalb misst man, statt zu raten.

## Bestehendes Projekt

> Die Frage, die jetzt kommt: wir haben kein leeres Repository. — Braucht ihr auch nicht. Die meisten haben das alles schon, unter anderen Namen.

> ADRs? Die Config zeigt auf den ADR-Index. Eine D-Zeile pro ADR, die Nummern bleiben.

> CONTRIBUTING, Security-Policy? Werden als Projektabschnitte an den Standardkern gehängt. Bei Sicherheit gewinnen eure.

> Die CI? Bleibt. Dazu kommen zwei Checks: einer, der die generierten Dateien prüft, einer für die Docs-Verweise.

> Backlog, Wiki-Seiten voller Zahlen, offene Fragen? Der erste Rumble ist ein lesender Rumble. Erst die Lücken sammeln, dann die kleinste echte Änderung.

> Und wer nicht auf GitHub ist: der Prozess braucht vier Dinge. Issues, Labels, Branches, PR-Kommentare. Heute ist das GitHub. Ein anderer Host ist ein Binding, das man schreibt. Der Prozess ändert sich nicht.

## Schluss

*Langsam. Das ist der letzte Satz, den sie mitnehmen.*

> Vier Wörter. Denken. Vertrag. Bauen. Erinnern.

> Denken in einer Session, die mit Issues endet, nie mit Code. Bauen in einer Session, die nie Code liest, mit Agenten, die je eine Sache tun. Und das Gedächtnis in den Docs, vom Board geprüft. Damit die nächste Unterhaltung da anfängt, wo diese aufgehört hat.

> Beide Repos sind offen, die Links stehen da. — Fragen?

---

## Q&A-Karten

**„Ist 3,4 Millionen Tokens viel?"**
Verglichen womit? Niemand hat die Zahl für die eigene Arbeit, weil ohne Trail niemand misst. Was ich sagen kann: das Teure ist das Rot. Ein Finding kostet eine Fix-Runde plus Re-Review, beides auf dem großen Modell. Ein billigeres Modell, das ein Rot mehr produziert, ist am Ende teurer. Darum ist Modell pro Station ein Regler in der Config, und der nächste Arc zeigt in Tokens und Rot-Findings, ob der Regler hält.

**„Was hat es in Geld gekostet?"**
Auf einem Abo ohne Token-Preis. Die Token stehen pro Station im Trail. Auf API-Listenpreise umgerechnet wären es grob ein paar hundert Euro für vier Features, abhängig vom Verhältnis Eingabe zu Ausgabe, das der Trail nicht trennt. Absichtlich nicht als Ergebnis verkauft.

**„Meine Kollegin nutzt ein anderes Tool. Kommt sich das in die Quere?"**
Nein. Nichts läuft von allein. Die Pipeline startet, wenn ich sie starte, und sie sieht nur Issues mit dem Label pipeline-build, das nur die Triage setzt. Alles andere im Repo ist für sie unsichtbar. Labels kommen aus der Config; wenn ein anderes Tool auch size-L benutzt, benenne ich meine um und rendere neu. Agenten arbeiten in eigenen Worktrees an den Issues, die sie bekommen haben, niemandes Agent nimmt sich einen fremden PR. Gemeinsam ist nur main, und da gelten die Regeln für Menschen. Die eine Vereinbarung, die zählt: Entscheidungen bekommen eine Zeile, egal mit welchem Werkzeug. Der Check fängt hängende Verweise, nicht stilles Abdriften.

**„Wo passt das bei uns hin?"**
Drei Stellen, jede mit einem ersten Schritt. Agenten auf Einkäufer- und Händlerseite: was ein Agent darf, ist eine Zeile, bevor es Code ist. In Requisit genehmigt der Entwurfsagent nie, das ist im Rumble entschieden und wird im Review durchgesetzt. Erster Schritt: ein Rumble über die Befugnisse. PWA: eine Config-Datei, die CI, die wir haben. Erster Schritt: rendern, den Check in die CI, ein kleines Issue durch die Pipeline. Neuer Commerce-Core: die ADRs sind das Gedächtnis schon. Erster Schritt: ein lesender Rumble darüber, dann die kleinste echte Änderung als Arc eins. Und alles läuft aus einer Quelle für Claude Code und Codex.

**„Entscheidet der Agent die Architektur?"**
Nein. Der Rumble entscheidet, mit mir. Der Architekt entwirft innerhalb der entschiedenen Zeilen und schlägt neue vor, und die sehe ich, bevor gebaut wird.

**„Was, wenn der Reviewer falsch liegt?"**
Zwei Fix-Runden, dann ein Mensch. Verdict und Evidenz stehen im PR, ich lese sie wie jedes Review und widerspreche per Kommentar, und die Fix-Schleife behandelt das wie ein Finding. Bei Requisit haben die Reviewer zwei Mutationen als „grün per Konstruktion" durchgewinkt, statt sie zu erzwingen. Das steht so im PR.

**„Warum haben zwei PRs die 3k-Zeilen-Grenze gerissen?"**
Testvolumen, nicht Feature-Volumen. Issue drei waren 2,6 Tausend Zeilen Code und 2,8 Tausend Zeilen Tests, die der Testplan des Designs verlangt hat. Der Orchestrator hat bewusst einen PR gelassen, weil der Schnitt eine erste Hälfte über der Grenze und ein zweites Security-Review gekostet hätte. M-009 sagt: die Grenze auf Code-Zeilen beziehen, oder große Issues in eine API-Hälfte und eine Test-Hälfte schneiden.

**„Läuft das ganz allein?"**
Nein, und das ist Absicht. Drei Stellen sind meine: ich bestätige die Issue-Entwürfe beim Task-out, ich starte die Pipeline, und ich prüfe PRs mit hohem Risiko nach dem Merge. Dazu jede Frage, die ein Agent nicht beantworten kann; die landet als needs-human bei mir.

**„Codex oder Claude?"**
Beides. Eine Quelle, zwei Bindings. Requisit rendert beide Agentensätze aus derselben Config.

**„Was ist im Rumble schiefgegangen?"**
Ehrlich: die drei echten Bugs kamen aus Lücken, die der Rumble nicht entschieden hatte. Refusals nach dem ersten Schreibzugriff, der Akteur im Idempotenz-Schlüssel, der Merchant-Scope. Alle drei stehen jetzt als Zusätze und offene Fragen in den Docs, der nächste Rumble liest sie.

---

## Zahlen mit Quelle

| Zahl | Was | Quelle |
|---|---|---|
| 4 Issues · 4 PRs | Arc 1 | Umbrella #6, PRs #7–#10 |
| 4 h | erstes Pipeline-Ereignis bis letzter Merge | Timeline aus den Issues |
| 19 min | erster Commit bis Rumble-Commit | git log |
| 15 286 Zeilen | gemergte Zeilen, Arc 1 | M-009 |
| 474 Tests | Board auf main nach #10 | Trail auf #5 |
| 38 Review-Findings, 5 rot | erste Reviews | Trails #2–#5 |
| 25 D · 23 G · 10 M (4 gemessen) | Docs nach Arc 1 | check-anchors, docs/16 |
| 3 390 984 Tokens | Pipeline Arc 1 | M-007, Trails |
| 111 974 Tokens | der Rumble | M-008 |
| 6 Suchen · 24 Quellen | Research-Log | docs/15 |
