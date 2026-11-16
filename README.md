# loom entries

What we learned the hard way, one folder per entry.

An entry is not an article. It is the thing someone should read **before acting**, so each one says when to
read it, what it cost to learn, and what to do instead. They are written for a person and for an agent, because
an agent reading an entry is a reader too.

```
loom/                          the folder name is the PUBLISHER: this library is `loom`'s own
  a-red-gate-is-a-question/
    README.md                  name, description (WHEN TO READ IT), as_of (when it was last checked)
```

An entry may carry scripts or data beside its `README.md`. Only the folder holding a `README.md` is an entry.

## Reading it

- On the web: <https://loombot.ai/library>
- In a checkout: read the folder. Nothing here needs to run.

## Using it

Text is **CC BY 4.0**: quote it, translate it, put it in your own docs, including commercially — keep the
attribution. Code beside an entry is **MIT**: take it and use it. `LICENSE.md` is the boundary in full.

## Contributing

Open a pull request with one folder. A pull request is accepted when it is the shape of an entry — a `README.md`
with `name`, `description` and `as_of` — and when the lesson would still be true on a machine that has never
seen ours: no internal ticket numbers, no absolute paths, no references to a repo a reader cannot open.

That last part is enforced here rather than promised: an entry that names our own filing system is an entry
that has not finished being written.

## What this is not

It is not a product manual. Documentation for loom itself lives with loom, and it is allowed to name paths,
because its subject is those paths. This repo is the part that holds when the software changes.
