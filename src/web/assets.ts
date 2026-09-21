/**
 * The two static files, as source constants (D-013): one hand-written stylesheet and the
 * ~50 lines of vanilla JavaScript, served from `/static/` by the same router (D-012).
 *
 * They are constants rather than files on disk because `tsc` emits `.js` from `.ts` and
 * copies nothing else — a `.css` under `src/` would simply not exist in `dist/`, and a
 * handler that read it from the filesystem would be a path-resolution and traversal surface
 * for two files that never change at runtime. No build step is involved either way.
 */

export const STYLESHEET = `:root{--ink:#16181d;--muted:#5b6472;--line:#d7dce3;--bg:#f7f8fa;
--card:#fff;--accent:#1d4ed8;--bad:#b42318;--ok:#067647}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);
background:var(--bg)}
header.bar{display:flex;gap:1rem;align-items:baseline;padding:.75rem 1rem;background:var(--card);
border-bottom:1px solid var(--line);flex-wrap:wrap}
header.bar a{color:var(--accent);text-decoration:none}
header.bar .who{margin-left:auto;color:var(--muted);font-size:.9rem}
main{max-width:64rem;margin:0 auto;padding:1rem}
h1{font-size:1.4rem;margin:.5rem 0 1rem}
h2{font-size:1.1rem;margin:1.5rem 0 .5rem}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line)}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td.amount,th.amount{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.state{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--line);
border-radius:999px;padding:.1rem .5rem}
.card{background:var(--card);border:1px solid var(--line);padding:1rem;margin:1rem 0}
.refusal{background:#fff4f2;border:1px solid var(--bad);padding:.75rem 1rem;margin:1rem 0}
.refusal code{color:var(--bad)}
.muted{color:var(--muted)}
label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .15rem}
input,select,textarea{font:inherit;padding:.4rem;border:1px solid var(--line);border-radius:3px;
background:var(--card);color:var(--ink);max-width:100%}
button{font:inherit;padding:.45rem .9rem;border:1px solid var(--accent);border-radius:3px;
background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:var(--card);color:var(--accent)}
button[aria-disabled=true]{opacity:.5;cursor:progress}
form.inline{display:inline}
.actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;margin-top:1rem}
.preview{font-size:1.1rem}
.preview strong{font-variant-numeric:tabular-nums}
`;

/**
 * The whole client (D-013). It does exactly two things, and the page is complete without
 * both: it asks the *server* what a draft's total and matching rule would be (the rule is
 * never computed here — that would be a second implementation of D-008), and it keeps a
 * double-click from becoming a second POST. The `Idempotency-Key` it would reuse is the one
 * the server rendered into the form, so a submit without JavaScript is idempotent too.
 */
export const CLIENT_SCRIPT = `(function () {
  'use strict';
  var form = document.querySelector('form[data-preview]');
  if (form) {
    var total = document.getElementById('preview-total');
    var rule = document.getElementById('preview-rule');
    var pending = null;
    var refresh = function () {
      if (pending) { clearTimeout(pending); }
      pending = setTimeout(function () {
        fetch(form.getAttribute('data-preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)).toString(),
          credentials: 'same-origin'
        }).then(function (response) {
          return response.ok ? response.json() : null;
        }).then(function (answer) {
          if (!answer) { return; }
          // textContent, never innerHTML: nothing the server sends is parsed as markup here.
          total.textContent = answer.totalText;
          rule.textContent = answer.ruleText;
        }).catch(function () { /* the server-rendered figures stay as they are */ });
      }, 200);
    };
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
  }
  Array.prototype.forEach.call(document.querySelectorAll('form[data-once]'), function (once) {
    var sent = false;
    once.addEventListener('submit', function (event) {
      if (sent) { event.preventDefault(); return; }
      sent = true;
      Array.prototype.forEach.call(once.querySelectorAll('button'), function (button) {
        button.setAttribute('aria-disabled', 'true');
      });
    });
  });
})();
`;
