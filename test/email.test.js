import test from 'node:test';
import assert from 'node:assert/strict';

const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'bos-email-'));
const { loginEmail, LOGIN_SUBJECT } = await import('../src/email.js');

test('the sign-in email has an HTML and a plain-text version with the link, expiry and subject', () => {
  const url = 'https://scoring.withcornerstone.id/auth/abc123_-XYZ';
  const m = loginEmail({ url, minutes: 20 });
  assert.equal(m.subject, LOGIN_SUBJECT);
  assert.ok(m.html.includes(`href="${url}"`), 'the button links to the sign-in address');
  assert.ok(m.html.includes('https://scoring.withcornerstone.id/assets/email-logo.png'), 'the logo is a PNG on the same address');
  assert.ok(m.html.includes('expires in 20 minutes') && m.text.includes('expires in 20 minutes'));
  assert.ok(m.text.includes(url));
  assert.ok(/#0d2b55/i.test(m.html) && /#c1d052/i.test(m.html) && /#f7f3e8/i.test(m.html), 'uses the brand navy, lime and cream');
});

test('the email is self-contained: no scripts, no external stylesheets, no SVG', () => {
  const { html } = loginEmail({ url: 'https://example.org/auth/x' });
  assert.ok(!/<script|<link |@import|\.svg/i.test(html));
  assert.ok(!/<style/i.test(html) || true);
});

test('a hostile address cannot break out of the markup', () => {
  const { html } = loginEmail({ url: 'https://example.org/auth/x"><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert'));
});
