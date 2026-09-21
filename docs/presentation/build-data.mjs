#!/usr/bin/env node
// Builds the deck's data files from the docs and GitHub. Nothing hand-written.
//   node docs/presentation/build-data.mjs <showcased-issue> [umbrella]
// → data/decisions.js  rows from docs/02, /14, /16, the brief, research count, anchors line, waves
// → data/trail.js      the showcased issue's trail (rumble-framework/scripts/replay-from-gh.mjs)
// → data/cost.js       stage × model × tokens parsed from every 📋 trail comment of the umbrella's issues
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..'), FW = join(ROOT, '..', 'rumble-framework');
const [issue, umbrella] = process.argv.slice(2);
const REPO = JSON.parse(readFileSync(join(ROOT, 'framework.json'), 'utf8')).repo;
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, cwd: ROOT });
const doc = p => readFileSync(join(ROOT, p), 'utf8');
const cells = line => line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
const rows = (text, prefix) => text.split('\n').filter(l => new RegExp(`^\\|\\s*~{0,2}${prefix}-\\d+`).test(l)).map(l => { const c = cells(l); return { id: c[0].replace(/~~/g, ''), struck: /^~~/.test(c[0]), date: c[1], title: c[2], rationale: c[3] || '', status: c[4] || '' }; });

// --- decisions.js
const dec = doc('docs/02-decisions.md'), gaps = doc('docs/14-gap-analysis.md'), meas = doc('docs/16-measurements.md');
const decisions = rows(dec, 'D'), gapRows = rows(gaps, 'G').map(r => ({ ...r, title: r.date, rationale: r.title })); // gaps: Id | Question | Why | ...
const mrows = [...meas.matchAll(/^(?:#{2,4}\s+|\|\s*|\*\*)(M-\d+)\b[^\n]*/gm)].map(m => ({ id: m[1], title: m[0].replace(/^[#|* ]+/, '').replace(/\*\*/g, '').trim().slice(0, 120) }));
const measured = mrows.filter(r => !/pending|steht aus/i.test(meas.slice(meas.indexOf(r.id), meas.indexOf(r.id) + 600))).length;
const addenda = decisions.filter(r => /addend/i.test(r.title + ' ' + r.rationale + ' ' + r.status)).length;   // rows a PR extended
const researchDoc = doc('docs/15-research-log.md');
const researchTitles = [...researchDoc.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
const research = researchTitles.length;
const researchSources = (researchDoc.match(/https?:\/\/[^\s)>\]]+/g) || []).length;
let anchors = ''; try { anchors = sh('node', [join(FW, 'scripts/check-anchors.mjs'), '.']).trim().split('\n').pop(); } catch (e) { anchors = String(e.stdout || '').trim().split('\n').pop(); }
let waves = [];
if (umbrella) { const b = JSON.parse(sh('gh', ['issue', 'view', umbrella, '-R', REPO, '--json', 'body'])).body; waves = [...b.matchAll(/wave\s*\d+\s*[:=→-]+\s*\**\s*([^*·\n]+)/gi)].map(m => (m[1].match(/#?\d+/g) || []).map(x => '#' + x.replace('#', ''))); }
writeFileSync(join(HERE, 'data/decisions.js'), 'window.DECISIONS = ' + JSON.stringify({ decisions, gaps: gapRows, measurements: mrows, measured, addenda, research, researchTitles, researchSources, anchors, waves, brief: doc('docs/00-brief.md'), built: new Date().toISOString() }, null, 1) + ';\n');

// --- timeline.js: every issue of the umbrella as one lane — the day as data
if (umbrella) {
  const b = JSON.parse(sh('gh', ['issue', 'view', umbrella, '-R', REPO, '--json', 'body'])).body;
  const nums = [...new Set((b.match(/#\d+/g) || []).map(s => s.slice(1)))].filter(n => n !== umbrella);
  const lanes = [];
  for (const n of nums) {
    let d; try { d = JSON.parse(sh('node', [join(FW, 'scripts/replay-from-gh.mjs'), REPO, n])); } catch { continue; }
    const ev = d.events;
    if (!ev.some(e => e.kind === 'pr')) continue;
    const tests = (ev.filter(e => e.kind === 'trail').map(e => (e.text.match(/(\d+)\/\1\b/) || [])[1]).find(Boolean)) || null;
    lanes.push({ issue: Number(n), title: d.title, events: ev.filter(e => ['labeled', 'design', 'commit', 'pr', 'review', 'fix-round', 'merged'].includes(e.kind)).map(e => ({ at: e.at, kind: e.kind, text: (e.kind === 'review' ? e.verdict : e.text || '').slice(0, 90), red: e.kind === 'review' ? /[1-9]\d* red|🔴/.test(e.verdict || '') : undefined, sha: e.sha })), tests: tests ? Number(tests) : null });
  }
  writeFileSync(join(HERE, 'data/timeline.js'), 'window.TIMELINE = ' + JSON.stringify({ lanes, built: new Date().toISOString() }, null, 1) + ';\n');
}

// --- trail.js
if (issue) writeFileSync(join(HERE, 'data/trail.js'), 'window.TRAIL = ' + sh('node', [join(FW, 'scripts/replay-from-gh.mjs'), REPO, issue]) + ';\n');

// --- cost.js: every "📋" comment on the umbrella's task issues; table rows "| stage | model | outcome | tokens |"
const costRows = []; let prs = 0, findings = 0;
if (umbrella) {
  const b = JSON.parse(sh('gh', ['issue', 'view', umbrella, '-R', REPO, '--json', 'body'])).body;
  const nums = [...new Set((b.match(/#\d+/g) || []).map(s => s.slice(1)))].filter(n => n !== umbrella);
  for (const n of nums) {
    const cs = JSON.parse(sh('gh', ['api', '--paginate', `repos/${REPO}/issues/${n}/comments`]));
    for (const c of cs) {
      if (!/📋 Pipeline/.test(c.body || '')) continue;
      for (const l of c.body.split('\n')) { const m = l.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([\d.,]+)\s*k?\s*\|/i); if (m && !/^stage/i.test(m[1]) && !/^-+$/.test(m[1])) { let t = Number(m[4].replace(/,/g, '')); if (/k\s*\|/.test(l)) t *= 1000; costRows.push({ issue: '#' + n, stage: m[1], model: m[2], outcome: m[3], tokens: Math.round(t) }); } }
      prs += 1;   // one trail = one merged PR (stacked PRs would list more; count the "PR #" mentions then)
      for (const l of c.body.split('\n')) { if (/^\|\s*(quality|security) review[^|]*\|/i.test(l)) { const m = l.match(/\((\d+) red, (\d+) nits?\)/); if (m) findings += +m[1] + +m[2]; } }
    }
  }
}
// lines merged (M-009 result: "#N 4 164 lines"), and the minutes of human conversation = first commit → the rumble commit
const lines = [...meas.matchAll(/#\d+ (\d[\d ]*\d)(?: lines)? \((?:L|M|S),/g)].reduce((s, m) => s + +m[1].replace(/ /g, ''), 0) || null;
const log = sh('git', ['log', '--reverse', '--format=%at %s']).trim().split('\n');
const first = +log[0].split(' ')[0], rumbleLine = log.find(l => /docs: rumble/.test(l));
const humanMinutes = rumbleLine ? Math.round((+rumbleLine.split(' ')[0] - first) / 60) : null;
writeFileSync(join(HERE, 'data/cost.js'), 'window.COST = ' + JSON.stringify({ rows: costRows, total: costRows.reduce((s, r) => s + r.tokens, 0), prs: prs || null, findings: findings || null, lines, humanMinutes, note: costRows.length ? `from the 📋 trail comments of umbrella #${umbrella}; tokens as the runtime reported them` : '', liveUrl: process.env.REQUISIT_LIVE_URL || 'http://localhost:3000/' }, null, 1) + ';\n');
console.log(`decisions ${decisions.length} · gaps ${gapRows.length} · measurements ${mrows.length} (${measured} measured) · research ${research} · waves ${waves.length} · trail ${issue ? 'issue #' + issue : 'skipped'} · cost rows ${costRows.length}`);
