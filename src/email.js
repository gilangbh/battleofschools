// Email templates. Mail apps ignore most CSS, so everything is table layout with inline styles, a PNG logo (not SVG)
// and system fonts. The colours and tone follow the site: navy, cream, lime, heavy headings.
import { getSetting } from './db.js';

const C = { navy: '#0d2b55', navy2: '#12356a', cream: '#f7f3e8', lime: '#c1d052', paper: '#fffdf6', muted: '#4d5e74', line: '#d9d6c9', red: '#e65346' };
const FONT = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The shared frame: navy masthead with the logo, a cream card for the message, and a quiet footer. */
function layout({ base, preheader, kicker, heading, body, footer }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.navy};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.navy};font-size:1px;line-height:1px;">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.navy};">
<tr><td align="center" style="padding:28px 14px 36px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td style="padding:0 4px 18px;">
      <img src="${esc(base)}/assets/email-logo.png" width="190" alt="Battle of Schools" style="display:block;width:190px;max-width:100%;height:auto;border:0;">
    </td></tr>
    <tr><td style="background:${C.lime};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="background:${C.cream};padding:34px 32px 30px;font-family:${FONT};color:${C.navy};">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${esc(kicker)}</p>
      <h1 style="margin:0 0 18px;font-family:${FONT};font-size:30px;line-height:34px;font-weight:900;letter-spacing:-1px;color:${C.navy};">${esc(heading)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:22px 6px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#b9c5d6;">${footer}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (html) => `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:25px;color:${C.navy};">${html}</p>`;

/** A button that survives Outlook: a padded table cell, not a styled link alone. */
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr>
  <td align="center" bgcolor="${C.lime}" style="background:${C.lime};border:2px solid ${C.navy};">
    <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:800;color:${C.navy};text-decoration:none;">${esc(label)} &rarr;</a>
  </td></tr></table>`;

/** A line of small print with a coloured marker. */
const note = (html) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
  <td width="4" style="background:${C.navy};font-size:0;line-height:0;">&nbsp;</td>
  <td style="background:#efe9d3;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:21px;color:${C.navy};">${html}</td></tr></table>`;

function footerFor() {
  const title = getSetting('event_title', 'Homecoming 2026');
  const date = getSetting('event_date', '28 November 2026');
  const venue = getSetting('venue', 'Padel Pro Satrio Club');
  return `<span style="color:${C.lime};font-weight:700;letter-spacing:1px;text-transform:uppercase;">Compete. Connect. Celebrate.</span><br>
${esc(title)} · ${esc(date)} · ${esc(venue)}<br>An event by Cornerstone Collective`;
}

export const LOGIN_SUBJECT = 'Your Battle of Schools sign-in link';

/** The sign-in email. `minutes` is how long the link lasts. Returns { subject, html, text }. */
export function loginEmail({ url, minutes = 20 }) {
  const base = new URL(url).origin;
  const html = layout({
    base,
    preheader: `Your sign-in link works once and expires in ${minutes} minutes.`,
    kicker: 'Captains and tournament staff',
    heading: 'Sign in to Battle of Schools scores',
    body: `${p('Tap the button to sign in. You do not need a password.')}
${button(url, 'Sign in')}
${note(`<strong>This link works once and expires in ${minutes} minutes.</strong> If it has run out, ask for a new one on the sign-in page.`)}
${p(`<span style="font-size:14px;line-height:22px;color:${C.muted};">Button not working? Copy this address into your browser:</span><br><a href="${esc(url)}" target="_blank" style="font-size:13px;line-height:20px;color:${C.navy};word-break:break-all;">${esc(url)}</a>`)}
<p style="margin:0;padding-top:14px;border-top:1px solid ${C.line};font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">If you did not ask to sign in, you can ignore this email. Nobody can use the link without it, and it stops working by itself.</p>`,
    footer: footerFor(),
  });
  const text = `Sign in to Battle of Schools scores

Open this link to sign in. You do not need a password.

${url}

The link works once and expires in ${minutes} minutes. If it has run out, ask for a new one on the sign-in page.

If you did not ask to sign in, you can ignore this email.

Compete. Connect. Celebrate.
${getSetting('event_title', 'Homecoming 2026')} · ${getSetting('event_date', '28 November 2026')} · ${getSetting('venue', 'Padel Pro Satrio Club')}
An event by Cornerstone Collective
`;
  return { subject: LOGIN_SUBJECT, html, text };
}
