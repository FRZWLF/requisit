import { refusalBlock } from './layout.ts';
import type { Refusal } from '../../refusal.ts';

/**
 * The one place a token is typed (D-025). It is a `POST` field, never a query parameter, so
 * the token reaches no URL, no `Referer`, no access log and no browser history; the answer
 * sets an `HttpOnly` cookie and the token never appears in a page again.
 */
export function signInPage(refusal: Refusal | null): string {
  return `${refusal === null ? '' : refusalBlock(refusal)}
<form method="post" action="/sign-in" data-once>
<label for="token">Personal token</label>
<input id="token" name="token" type="password" autocomplete="off" spellcheck="false" required>
<div class="actions"><button type="submit">Sign in</button></div>
</form>
<p class="muted">The demo tokens are printed by the seed script. The token is kept in an
HttpOnly, SameSite=Strict cookie for this browser session and is never shown again.</p>
`;
}
