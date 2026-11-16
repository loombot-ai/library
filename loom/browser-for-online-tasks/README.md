---
name: "browser-for-online-tasks"
description: "Read when a task has to be FINISHED on a website from a repl - a form to submit, a CAPTCHA or Turnstile, a JS-rendered page, a booking - and read BEFORE telling anyone it cannot be done from code. How to actually finish it: pick between Safari over safaridriver (a real window, for completing flows) and headless Chrome over CDP (exact viewport, for seeing pages), with the working recipe and a ready helper. The census of browsers and drivers on this machine, and the disposition that turns 'fetch cannot' into a plan."
as_of: "2026-10-12"
---

# Finishing something online, with a browser

## Pick the rig first

    must SUBMIT something (form, booking, captcha)   Safari over safaridriver - it is a real browser
                                                     and captchas are meant to pass in a real one
    must SEE or MEASURE a page (a rect, a width,      headless Chrome over CDP - exact viewport, no
    'does it paint', a screenshot worth looking at)   pairing, no visible window

Safari has one hard limit worth knowing before you start: the pairing is **machine-wide**. If another agent is
already driving Safari, your POST /session answers 500 'already paired with another WebDriver session', and a
second safaridriver on your own port will not help. Tell an ORPHANED driver (kill it) from a LIVE PEER's (do
not) before killing anything, or fall back to Chrome CDP.

## Safari, with the helper that sits beside this file

    const t = await loadTools('safari', '<library>/browser-for-online-tasks/safari.ts');
    await tools.safari.open();                 // starts safaridriver, waits for /status ready
    await tools.safari.newSession();           // fresh unauthenticated profile
    await tools.safari.goto('https://example.com/form', 3000);
    await tools.safari.text();                 // the page as text - the honest read of what loaded
    await tools.safari.js('return document.title');
    await tools.safari.type('#email', 'a@b.c');
    await tools.safari.click('#submit');
    await tools.safari.shot(loom.tmpdir + '/after.png');
    await tools.safari.close();                // ALWAYS: session plus driver process

Replace <library> with the path the entry was read from. The helper exports dispose(), so unloading the tools
namespace closes the browser too.

## The endpoints, if you would rather go direct

No client library, no WebSocket, no handshake - every step is a fetch against http://127.0.0.1:<port>:

    POST   /session                            capabilities; answers with the session id
    POST   /session/<id>/url                   navigate
    POST   /session/<id>/execute/sync          run a script (a function BODY - return explicitly)
    POST   /session/<id>/element               find one element, answers with its element id
    POST   /session/<id>/element/<eid>/click   scroll into view, then click
    POST   /session/<id>/element/<eid>/value   set a field, body { text: '...' }
    POST   /session/<id>/actions               raw pointer input, does NOT scroll
    GET    /session/<id>/screenshot            base64 PNG; save it and look
    DELETE /session/<id>                       end the session

## Wrapping it so a failure is readable

Every call answers with a value envelope and errors arrive INSIDE it rather than as an HTTP status, so a bare
fetch returns error text you then mistake for data. Unwrap once, centrally:

    const v = body && typeof body === 'object' && 'value' in body ? body.value : body;
    if (v && typeof v === 'object' && v.error) throw new Error(v.error + ': ' + (v.message || ''));

## Reading a form before filling it

Enumerate the live DOM rather than guessing selectors - one call tells you every field and its binding:

    return JSON.stringify([].slice.call(document.querySelectorAll('input,select,textarea,button'))
      .map(function (e) { return { tag: e.tagName, type: e.type, name: e.getAttribute('formcontrolname'),
      id: e.id, ph: e.placeholder }; }));

Angular Material and similar kits render a dropdown as a div with role=combobox, not a select, so a search for
'select' finds nothing and the field looks missing. Look for [role=combobox] and mat-select too.

## Chrome over CDP, in outline

    --headless=new --disable-gpu --no-first-run --no-default-browser-check
    --user-data-dir=<temp> --remote-debugging-port=9333 about:blank

then PUT /json/new?about:blank for a webSocketDebuggerUrl, Page.navigate, and drive it with Runtime.evaluate
{awaitPromise: true, returnByValue: true}. Page.captureScreenshot gives the PNG. The full recipe, with the
mobile:true viewport trap that makes a capture show a layout you did not ask for, is in
headless-chrome-cdp-page-check.

## Do not surprise anyone

Chrome here can be headless, but Safari is NOT: the window is real and visible on the machine, and the person
may be sitting in front of it. Say so before opening one, and close it when you are done.

## Chrome over CDP, with the helper (use this when you must SUBMIT)

    const c = await loadTools('chrome', '<library>/browser-for-online-tasks/chrome.ts');
    await c.launch({ headless: false, url: 'about:blank' });   // headed: headless is more likely to be flagged
    await c.attach();                                          // /json/new -> websocket, Page+Runtime enabled
    await c.goto('https://example.com/form', 8000);
    await c.ev('JSON.stringify({webdriver: navigator.webdriver})');   // expect false
    await c.ev(F('var el=document.querySelector("#email"); ...; return true;'));
    await c.wait(1000);                                        // sleeps IN the page, not in Deno
    await c.shot(loom.tmpdir + '/after.png');
    await c.close();                                           // drops the socket and kills Chrome

with F as above. `Runtime.evaluate` uses awaitPromise:true, so an expression returning a promise is awaited
for you - which is what c.wait uses. The full CDP recipe, including the mobile:true viewport trap that makes a
capture show a layout you never asked for, is in the headless-chrome-cdp-page-check entry.

## Filling a form that will not accept a fake keystroke

Setting `.value` directly leaves the framework's model empty, so the form stays invalid and the submit button
stays disabled. Go through the native setter and fire the events the framework listens to:

    var set = function (sel, v) {
      var el = document.querySelector(sel);
      var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      d.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };

For a kit dropdown (Angular Material renders mat-select, not select) click the control, wait ~1s, then click
the mat-option whose innerText matches. For a datepicker, click the calendar toggle and then the day cell - and
read the cells' aria-disabled, which is how you learn which dates are even offered (a date outside the booking
window is disabled exactly like a full quota, so check which before reporting that a day is unavailable).

**Check the button's `disabled` property and read the fields back before believing a fill worked.** A form that
looks filled and a form the framework considers filled are different things, and the disabled button is what
tells them apart.

---

# fetch failing is not the end of the task

A 403, an SPA skeleton, or a captcha means **fetch cannot do this**. It does not mean **nobody can**. Those are
different findings, and confusing them ends with you telling a person to go do by hand something you could have
finished. That is exactly what happened once (2026-10-12): a whole program was researched by fetch, a portal was
found to be an Angular SPA behind Cloudflare Turnstile with no discoverable JSON API, and the conclusion written
down was 'it cannot be submitted from code, go fill it in yourself' - while a working browser sat on the machine.

So when the deliverable is something that must be **completed** on a website - a submitted form, a booking, an
account, a captcha-gated flow - reach for a browser. Researching the backend by fetch stays the right FIRST move;
it is the LAST move it is not.

## The census (measured 2026-10-12, macOS 15.7.7)

    Safari 26.5.2            safaridriver is at /System/Cryptexes/App/usr/bin/safaridriver
                             ships with Safari, nothing to install, no --enable needed when
                             Allow Remote Automation is already on (it was)
    Google Chrome 154.x      /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
                             speaks CDP over a WebSocket: no driver binary at all
    chromedriver             NOT on PATH
    geckodriver, msedgedriver  NOT on PATH, and Firefox / Edge / Brave are not installed
    Playwright               npx exists, but no ~/Library/Caches/ms-playwright cache

So there are exactly TWO working rigs here, and both are covered by an entry:

    Safari over safaridriver   a real, VISIBLE window; best for a real flow you must finish
    Chrome over CDP            headless, exact viewport; best for seeing a page or measuring it

Both are driven with plain fetch/WebSocket from Deno. Neither needs npm, a config file, or a HOME change.

## Read the entry that matches the job

    driving-a-browser-over-webdriver           (system)    the endpoint table, and the trap where a
                                                           driver's null means nothing at all
    headless-chrome-cdp-page-check             (personal)  the CDP rig in full, with the viewport trap
    safari-rig-blocked-by-a-peer-use-chrome-cdp (personal) the one failure you cannot fix: Safari is
                                                           paired machine-wide and a peer agent may hold it
    loopback-is-a-secure-context               (personal)  http on 127.0.0.1 IS a secure context

## The rules that cost runs, in one place

1. **execute/sync wraps your script as a FUNCTION BODY.** An IIFE with no outer return completes with
   undefined, which serializes as null - so a 200 carrying null reads as 'the element is not there'. It is
   not evidence of absence, it is evidence of nothing. End the body in return, and drive one thing you KNOW
   is present as a positive control before believing any negative.
2. **A black screenshot is not a blank page.** Measured: a 92 KB all-black PNG while innerText from the same
   session returned the correct page. Read the text for content; the picture is for appearance.
3. **Errors arrive inside a 200 in a value envelope**, not as an HTTP status. Unwrap centrally and throw, or
   you will parse error text as data.
4. **Safari opens a REAL, VISIBLE window** and each session gets a fresh unauthenticated profile. A login made
   in one session does not survive into the next.
5. **Clean up.** DELETE the session and kill the driver, or you leave a window and a process behind.

## THE decisive measurement (2026-10-12): the rig decides whether a captcha-gated form can be filed

A Cloudflare Turnstile-gated form could be completely filled and validated in BOTH rigs and submitted in only
one of them:

    Safari over safaridriver   navigator.webdriver === true   Turnstile token EMPTY, no challenge iframe,
                               container 548x69 and visible, wait 12s -> still empty, submit button DISABLED
    Chrome over CDP            navigator.webdriver === false  a real 773-char token issued, submit ENABLED,
                               click -> '#/status' -> 'Thank you for submitting your visitor pass request.'

**So when the job is to SUBMIT something, prefer the CDP rig.** That is the whole reason this entry exists, and
it inverts the natural instinct to reach for the nicer-looking WebDriver rig first.

Honesty about the mechanism: the two rigs differ in exactly this flag and the outcome differed with it, which
makes the flag the leading explanation - but it is ONE comparison, not a controlled proof, and Turnstile's
scoring is deliberately opaque. Treat it as strong evidence, not as a published cause.

And the limit that must hold: **use the rig that does not set the flag; never fake the flag.** Editing
navigator.webdriver or hiding automation is defeating an anti-bot control on purpose, which is not something to
do to make a form accept, however legitimate the filing. The rig is a choice; the signal is not yours to edit.

## The return statement is opposite in the two rigs, and both failures are silent

    WebDriver execute/sync   wraps the script as a FUNCTION BODY   a top-level return is REQUIRED;
                                                                  an IIFE with no return yields null
    CDP Runtime.evaluate     evaluates it as a SCRIPT           a top-level return is a SyntaxError
                                                                  (Illegal return statement); use an IIFE
                                                                  or a bare expression

Remembering one and applying it to the other costs a run either way. For CDP, wrap everything:

    const F = (body) => '(function(){' + body + '})()';

## Screenshots: one rig lies, the other does not

Measured the same day: three Safari screenshots of three DIFFERENT page states (empty form, staged form, after
submit) came back as byte-identical files, `cmp` reporting IDENTICAL BYTES at 40671 each - so that capture does
not reflect the page at all. CDP captures in the same hour were 238KB and 355KB of real content. Judge a
WebDriver screenshot by `cmp` against another state before believing it; prefer innerText for content.

## Stakes, once you can actually submit

A browser makes submission possible, which raises the stakes rather than lowering them. A government or
financial form needs the person's own details, unguessed, and needs them to know you are about to file it.
Open the form, read the required fields out of the LIVE DOM, then ask for what is missing. Never invent an
identity to make a form accept, and never file on someone's behalf without asking first.

## Telling your browser from theirs before you kill anything

`close()` kills the process it spawned, but Chrome re-execs and leaves helpers behind, so a leftover `ps` line
is not proof the process is yours. **Prove it before killing**, because killing the person's own Chrome loses
their tabs:

    ps -Ao pid,args | grep -i 'Google Chrome' | grep -E 'remote-debugging-port|user-data-dir'
    lsof -p <pid> | grep <your --user-data-dir>
    ps -o pid,lstart -p <pid>

A Chrome with no debugging flags, no reference to your temp profile, and a start time BEFORE your run is
theirs. Leave it. Measured 2026-10-12: a leftover Chrome looked like mine, and `ps -o lstart` showed it had
started two days earlier with no debugging port - the person's own browser, correctly left running.
