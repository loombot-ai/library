---
name: test-it-in-a-browser-you-can-see
description: Read before reporting that a web UI works, or that a fix 'had no effect' — a page is only tested when you have LOOKED at a real browser. Open one, log in, click the thing, refresh it, read the screen. Every rule about harnesses in this file exists because a page was believed for hours on the strength of a rig nobody checked.
as_of: 2026-10-18
---

# A page is tested when you have seen it, not when a script said ok

If the thing being built is a page, then the test is: **a real browser, a real person's path through it,
and your own eyes on the result.** That is the cheapest verification in web work and it is the one most
often skipped, because a harness produces a green line and a browser produces a minute of clicking.

## What a real window gives you that a harness does not

    you see the state the user sees   'loading…' forever, a spinner, an empty list, the wrong account name
    it cannot lie about the bytes      the page you look at is the page that was served
    you can act on it                 sign in, press the button, refresh — the actual flow, not a proxy
    it fails visibly                  a blank screen and a console error are older and better signals
                                      than an assertion that happens to pass

A harness can be pointed at the wrong build, hold a stale cache from the round before, or catch an
exception and report 'step 3 failed' for an hour while the actual cause is one wrong field name. It will
do all of that with the same confidence as when it is right. Your eyes do not.

## The loop that makes it cheap

Keep the pieces alive between changes: the servers running, the browser open, the session logged in.
Then a change is: save, wait for the dev server's own reload line, refresh the tab, read the screen.
Seconds. A harness that rebuilds the world each round is slower AND further from the truth.

Two conditions, both worth checking before believing anything you see:

    the server printed its own ready line      a service that never said 'listening' is not up
    the page is the build you just made        if the dev harness points at a DEPLOYED environment,
                                              you are looking at someone else's code and calling it yours

## When there is no browser in reach

Then say so, and say what you did instead. 'I could not open a browser, so this is checked at the HTTP
level only' is honest. 'The tests pass' about a page nobody looked at is not — and it is how a broken
page ships.

## The general shape, for anything with a user-facing surface

Verification has to resemble use. A page wants a browser; a CLI wants a typed command; a document wants
a reader. If your check does not look like the thing the user will do, it is a check on a model of the
product, not on the product.
