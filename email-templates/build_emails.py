#!/usr/bin/env python3
"""
LUXIGA CRM — email template preview generator.

Renders the LUXIGA-branded, email-client-safe HTML templates as static files
for design review: a shared base layout with a dark #080810 header band, the
"LUXIGA" wordmark in lime #C4FF53, near-white body on a light page, and lime
accent buttons. Table-based + inline styles so they survive Gmail/Apple
Mail/Outlook.

    python3 build_emails.py

Output: campaign-base.html, work-request-notify.html, work-request-receipt.html,
plus index.html (a preview gallery).

NOTE: the RUNTIME source of truth is ../worker/emails.js — that is what the
Worker actually sends. These files are the visual twin for design review; keep
the brand tokens + structure here in step with emails.js.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ---- brand tokens (mirror ../worker/emails.js BRAND) ----
T = dict(
    BG="#e9ecdf", CARD="#ffffff", HEAD="#080810", LIME="#C4FF53", LIME_INK="#0a0a0a",
    INK="#16161d", SOFT="#44483d", MUTED="#8b917d", HEAD_MUTED="#8f9a78",
    LINK="#4f6b16", LINE="#e4e7dc", PANEL="#f5f7ee",
)
FONT = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif"
SITE = "https://luxiga.co"
COMPANY = "LUXIGA LLC"
FOUNDER = "Lukas Green"
PHONE = "503-427-8497"
EMAIL = "lukas@lukasdgreen.com"
TAGLINE = "Product Design · Software"


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# ---------------------------------------------------------------- row helpers
def p_row(html):
    return f'<tr><td style="padding:0 32px 16px;font:400 16px/1.62 {FONT};color:{T["INK"]}">{html}</td></tr>'


def h_row(text):
    return f'<tr><td style="padding:8px 32px 8px;font:700 17px {FONT};color:{T["INK"]}">{esc(text)}</td></tr>'


def panel_row(pairs):
    rows = "".join(
        f'<tr><td valign="top" style="padding:5px 14px 5px 0;font:600 13px {FONT};color:{T["MUTED"]};white-space:nowrap">{esc(label)}</td>'
        f'<td style="padding:5px 0;font:400 15px/1.5 {FONT};color:{T["INK"]}">{value}</td></tr>'
        for label, value in pairs
    )
    return (
        '<tr><td style="padding:2px 32px 16px">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:{T["PANEL"]};border:1px solid {T["LINE"]};border-radius:12px">'
        f'<tr><td style="padding:14px 18px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">{rows}</table></td></tr>'
        '</table></td></tr>'
    )


def quote_row(text_html):
    return (
        '<tr><td style="padding:2px 32px 16px">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-left:3px solid {T["LIME"]};background:{T["PANEL"]};border-radius:0 10px 10px 0">'
        f'<tr><td style="padding:14px 18px;font:400 15px/1.6 {FONT};color:{T["SOFT"]}">{text_html}</td></tr>'
        '</table></td></tr>'
    )


def steps_row(items):
    rows = ""
    for i, it in enumerate(items, 1):
        rows += (
            '<tr>'
            f'<td valign="top" style="padding:0 12px 12px 0;width:30px">'
            f'<div style="width:26px;height:26px;border-radius:50%;background:{T["LIME"]};color:{T["LIME_INK"]};font:700 14px {FONT};text-align:center;line-height:26px">{i}</div></td>'
            f'<td style="padding:0 0 12px;font:400 15px/1.55 {FONT};color:{T["SOFT"]}">{it}</td></tr>'
        )
    return f'<tr><td style="padding:2px 32px 8px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">{rows}</table></td></tr>'


def cta_row(text, href):
    return (
        '<tr><td style="padding:10px 32px 22px">'
        f'<a href="{href}" style="display:inline-block;background:{T["LIME"]};color:{T["LIME_INK"]};font:700 16px {FONT};text-decoration:none;padding:14px 26px;border-radius:10px">{esc(text)}</a>'
        '</td></tr>'
    )


def sign_row(lines):
    body = "<br>".join(esc(l) for l in lines)
    return f'<tr><td style="padding:8px 32px 6px;font:400 15px/1.6 {FONT};color:{T["SOFT"]}">{body}</td></tr>'


# ------------------------------------------------------------------- layout
def wrap(title, preheader, inner, footer_extra=""):
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>{esc(title)}</title>
<style>
  body{{margin:0;padding:0;background:{T['BG']}}}
  a{{color:{T['LINK']}}}
  @media (max-width:600px){{ .card{{width:100%!important}} .px{{padding-left:20px!important;padding-right:20px!important}} }}
</style></head>
<body style="margin:0;padding:0;background:{T['BG']};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{T['BG']};font-size:1px;line-height:1px">{esc(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:{T['BG']}">
   <tr><td align="center" style="padding:26px 12px 34px">
    <table role="presentation" class="card" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background:{T['CARD']};border-radius:16px;overflow:hidden;border:1px solid {T['LINE']}">
      <!-- header -->
      <tr><td style="background:{T['HEAD']};padding:24px 32px" align="center">
        <div style="font:700 22px {FONT};letter-spacing:4px;color:{T['LIME']}">LUXIGA</div>
        <div style="font:600 10px {FONT};letter-spacing:3px;color:{T['HEAD_MUTED']};padding-top:5px;text-transform:uppercase">{esc(TAGLINE)}</div>
      </td></tr>
      <tr><td style="height:24px"></td></tr>
      {inner}
      <tr><td style="height:12px"></td></tr>
      <!-- footer -->
      <tr><td style="background:{T['HEAD']};padding:20px 32px" align="center">
        <div style="font:700 13px {FONT};letter-spacing:2px;color:{T['LIME']}">LUXIGA</div>
        <div style="font:400 12px/1.7 {FONT};color:{T['HEAD_MUTED']};padding-top:6px">
          {esc(COMPANY)} &middot; <a href="{SITE}" style="color:{T['LIME']};text-decoration:none">luxiga.co</a><br>
          <a href="tel:+15034278497" style="color:{T['HEAD_MUTED']};text-decoration:none">{esc(PHONE)}</a> &middot;
          <a href="mailto:{EMAIL}" style="color:{T['HEAD_MUTED']};text-decoration:none">{esc(EMAIL)}</a>
        </div>
        {footer_extra}
      </td></tr>
    </table>
   </td></tr>
  </table>
</body></html>"""


# ------------------------------------------------------------------- templates
def work_request_notify():
    inner = "".join([
        p_row("<b>New work request</b> just came in through the card."),
        panel_row([
            ("Name", "Ada Lovelace"),
            ("Email", '<a href="mailto:ada@example.com">ada@example.com</a>'),
            ("Phone", "(not provided)"),
            ("Source", "Card Scan (via linkedin)"),
            ("When", "2026-07-13T17:04:00Z"),
        ]),
        h_row("What they need"),
        quote_row("I'm launching a small product studio and need a fast, clean landing page.<br>Could we talk in the next couple of weeks?"),
        cta_row("Open the CRM", "https://luxiga.co/admin.html"),
        p_row(f'<span style="color:{T["MUTED"]};font-size:14px">Reply to this email to respond to Ada Lovelace directly.</span>'),
    ])
    return wrap("New work request — Ada Lovelace", "Ada Lovelace wants to talk about a project.", inner)


def work_request_receipt():
    inner = "".join([
        p_row("Hi {{first_name}},"),
        p_row("Thanks for reaching out. I got your note and I'll be in touch shortly — usually within a day."),
        h_row("What happens next"),
        steps_row([
            "<b>I read it personally.</b> Your request comes straight to me, not a queue.",
            "<b>We talk.</b> A quick call or email to understand what you're building and whether I'm the right fit.",
            "<b>A clear plan.</b> If it's a match, you get a scoped approach and next steps — no pressure.",
        ]),
        p_row("In the meantime, feel free to just reply to this email if anything comes up."),
        sign_row(["Talk soon,", FOUNDER, f"Founder, {COMPANY}", "luxiga.co"]),
    ])
    return wrap("Got your request — LUXIGA", "Thanks — I got your note and I'll be in touch shortly.", inner)


def campaign_base():
    # The wrapper campaigns render into. {{content}} = admin-authored campaign
    # body; {{unsubscribe_url}} = signed one-click link (worker fills both).
    inner = f'<tr><td style="padding:0 32px 8px;font:400 16px/1.62 {FONT};color:{T["INK"]}">{{{{content}}}}</td></tr>'
    footer_extra = (
        f'<div style="font:400 11px/1.6 {FONT};color:#6a6f5e;padding-top:12px">'
        f'{{{{postal_address}}}}<br>'
        f"You're receiving this because you connected with {esc(COMPANY)}.<br>"
        f'<a href="{{{{unsubscribe_url}}}}" style="color:{T["HEAD_MUTED"]};text-decoration:underline">Unsubscribe</a> from these emails.'
        '</div>'
    )
    return wrap("{{subject}}", "{{preview_text}}", inner, footer_extra)


TEMPLATES = [
    ("campaign-base.html", "Campaign base wrapper", campaign_base),
    ("work-request-notify.html", "Work request → Lukas", work_request_notify),
    ("work-request-receipt.html", "Work request auto-reply", work_request_receipt),
]


def index_page():
    rows = ""
    for slug, label, _ in TEMPLATES:
        rows += (
            f'<a class="row" href="{slug}"><span class="dot"></span>'
            f'<span><span class="sub">{esc(label)}</span><span class="file">{esc(slug)}</span></span>'
            '<span class="go">&rarr;</span></a>'
        )
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>LUXIGA CRM — Email Templates</title>
<style>
  :root{{--bg:#080810;--panel:#11111c;--line:rgba(196,255,83,.14);--ink:#f0f1ea;--muted:#8f9a78;--lime:#C4FF53}}
  *{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--ink);
    font-family:{FONT};padding:36px 18px;line-height:1.5}}
  main{{max-width:600px;margin:0 auto}}
  .eyebrow{{font:700 11px {FONT};letter-spacing:3px;text-transform:uppercase;color:var(--lime)}}
  h1{{font-size:24px;margin:6px 0 4px;letter-spacing:1px}} p.lead{{color:var(--muted);margin:0 0 24px;font-size:14.5px}}
  .row{{display:flex;align-items:center;gap:15px;padding:16px 18px;margin-bottom:11px;background:var(--panel);
    border:1px solid var(--line);border-radius:13px;text-decoration:none;color:var(--ink)}}
  .row:hover{{border-color:var(--lime)}}
  .dot{{width:12px;height:12px;flex:0 0 12px;border-radius:50%;background:var(--lime)}}
  .sub{{font-weight:700;font-size:15px;display:block}}
  .file{{color:var(--muted);font-size:12.5px;display:block}}
  .go{{margin-left:auto;color:var(--lime);font-size:20px}}
  footer{{margin-top:26px;font:600 11px {FONT};letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-align:center}}
</style></head><body><main>
  <p class="eyebrow">LUXIGA &middot; CRM</p>
  <h1>Email templates</h1>
  <p class="lead">Branded, email-client-safe HTML. Runtime source of truth is worker/emails.js; these are the design previews. Click any to open.</p>
  {rows}
  <footer>{esc(COMPANY)} &middot; luxiga.co</footer>
</main></body></html>"""


def main():
    for slug, _, fn in TEMPLATES:
        (ROOT / slug).write_text(fn())
        print("built:", slug)
    (ROOT / "index.html").write_text(index_page())
    print("built: index.html (preview gallery)")


if __name__ == "__main__":
    main()
