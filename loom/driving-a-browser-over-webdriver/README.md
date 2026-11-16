---
name: driving-a-browser-over-webdriver
description: Read before driving Safari (or any browser) through an external WebDriver — `execute/sync` wraps your script as a function body, so its `null` means the call produced nothing and NOT that the element is absent, which cost three Safari runs; and the endpoints, the real window, and the screenshot worth looking at
as_of: 2026-10-02
---

# A driver's null is not evidence of absence

Measured 2026-10-02 on this machine: Safari 26.5.2 driven over `safaridriver`, from Deno, with plain
`fetch`. Three runs were wasted, and nothing about them looked wrong — HTTP 200, a well-formed JSON body,
no error to read. The script sent to `POST /session/<id>/execute/sync` was an IIFE with no outer `return`:

```js
(function () {
  /* ... */ return document.querySelector(".panel");
})();
```

WebDriver answered `{"value": null}`, and the run recorded "the page has no panel". The panel was there
the whole time. **A driver's null is not evidence of absence; it is evidence of nothing.**

## Why: a completion value is not a function body

The same string works verbatim under Chrome DevTools Protocol, which is exactly why the habit carried
over. CDP's `Runtime.evaluate` returns the script's **completion value**, so the value of an IIFE is what
the IIFE returned. WebDriver wraps the script in a **function body** and returns the completion value of
that function — an IIFE whose result nobody returns completes with `undefined`, serialized as `null`. So
the same text is correct for one driver and meaningless for the other. Write
`return (function () { ... })()`, or better a bare expression or a body that ends in `return`.

## The positive control, before believing any negative

Drive one thing you KNOW is present and assert you get the value you expect, in the same session, before
any absence is allowed to stand:

```js
// expect "BODY"; null here means the plumbing is wrong, not that the page is empty
await execute("return document.body.tagName");
```

An unreported element and a missing element have the same shape without this — a 200 carrying `null`. One
call is the difference between three wasted runs and none.

## `/element/<eid>/click` and `/actions` are different instruments

`POST /session/<id>/element/<eid>/click` **scrolls the element into view first**, then clicks it. Raw
pointer input — `POST /session/<id>/actions` with `origin: "viewport"` — does not scroll. That is what
makes them two tests rather than one: **hit-testing and paint order**, what is actually on top at a
viewport point, can only be tested with `/actions`, because the element endpoint will scroll a covered
element into view and click it where a real user could not have. Pick the endpoint that answers the
question you meant to ask.

## safaridriver refuses a session until Safari allows it — and says what is missing

`safaridriver` opens no session until **Allow Remote Automation** is on (Safari's Develop menu → Allow
Remote Automation; the Develop menu itself sits behind Advanced preferences). The refusal names that
setting, and the message is the whole reason this became usable: the driver said what was missing. Read a
driver's refusal text as the instruction it usually is.

## A real window, and a fresh unauthenticated profile per session

Safari opens a REAL, VISIBLE window — this is not a headless driver, and anyone at the machine can watch
it work. Each session also starts with a **fresh, unauthenticated profile**: a login made in one session
does not survive into the next. So a flow that needs auth must log in inside the session that needs it,
or the whole run must reuse ONE session instead of opening a session per step.

## Take the screenshot, and look at it

`GET /session/<id>/screenshot` returns a base64 PNG, and a driver makes it cheap to write out and open.
The run that lost three measurements to `null` had, twenty minutes earlier, a screenshot showing the very
panel it had concluded was missing. Decode it and look before reasoning further from numbers: the answer
was in hand and unread.

## The whole flow is plain fetch

No client library, no WebSocket, no protocol handshake — every step is a `fetch` against
`http://127.0.0.1:<port>`, where `<port>` is the one safaridriver was started on:

```text
POST   /session                          capabilities; answers with the session id
POST   /session/<id>/url                 navigate
POST   /session/<id>/execute/sync        run a script (a function BODY — return explicitly)
POST   /session/<id>/element             find one element, answers with its element id
POST   /session/<id>/element/<eid>/click scroll into view, then click
POST   /session/<id>/actions             raw input — the hit-testing / paint-order test
GET    /session/<id>/screenshot          base64 PNG; save it and look
DELETE /session/<id>                     end the session
```
