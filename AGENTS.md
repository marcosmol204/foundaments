# Agent instructions: Foundaments teaching workspace

This is a teaching workspace (see the `teach` skill in `.agents/skills/teach/`), published as a GitHub Pages site. It holds one folder per topic. The current topic is MongoDB Internals (`mongodb/`).

## Layout: one folder per topic

```
index.html            site landing page: lists the topics
assets/               shared components (style.css, quiz.js, widgets) for all topics
.nojekyll             serve files as-is on GitHub Pages
mongodb/              one topic = one folder
  index.html          topic home: lists lessons, reference, self-test
  questions.html      renders QUESTIONS.md in the browser
  MISSION.md NOTES.md RESOURCES.md QUESTIONS.md
  lessons/  reference/  learning-records/
```

- The teach skill's workspace paths (`MISSION.md`, `./lessons/`, `./reference/`, `./learning-records/`, `NOTES.md`, `RESOURCES.md`) resolve **inside the topic folder**, e.g. `mongodb/lessons/`. `./assets/` stays at the repo root and is shared.
- Pages in `<topic>/lessons/` and `<topic>/reference/` link assets as `../../assets/…` and start with the breadcrumb:
  `<nav class="crumbs" aria-label="Breadcrumb"><a href="../../index.html">Home</a> / <a href="../index.html">MongoDB</a></nav>`
- Link to `index.html` explicitly (not `./` or `../`), so pages also work when opened from disk.
- **When you add a lesson or reference page, add a row for it in the topic's `index.html`** (and move the `next` tag on the upcoming list). When you start a new topic, create its folder with the same layout and add it to the root `index.html`.

## Every MongoDB example uses the `reviews` collection

Marcos wants examples that look like their real work, not random data. In **every** lesson, diagram, quiz, lab and chat answer, use this collection (database `store`):

```js
// store.reviews
{ _id: ObjectId, review: string, rating: number, tags: [string], verified: boolean }
// e.g. { _id: ObjectId('…'), review: "After two weeks battery lasts for days.", rating: 5, tags: ["battery", "quality"], verified: true }
```

- Don't invent other collections such as `orders` or `events`. If a concept needs something the schema lacks (a date, a product reference, a big text field), say that you're adding a field and why. Keep the five fields as they are.
- Typical examples: `find({rating: {$gte: 4}})`, `{verified: 1, rating: 1}` compound index, `{tags: 1}` multikey index, covered query `find({verified: true}, {_id: 0, rating: 1})`.
- For labs, load data with `mongodb/lessons/code/seed-reviews.js`. It's deterministic: `_id`s are ObjectIds for one review per second from 2026-01-01, so "reviews of a day" is an `_id` range (`ObjectId.createFromTime`). Ratings skew positive (≈45% are 5★), each review has 1–3 tags from a fixed list, ≈70% are verified, and documents average ≈165 B. Usage is in the file header. Re-measure any numbers you show on this data.
- Lessons 0002–0003 were converted to `reviews` on 2026-10-27, with numbers re-measured. 0001 (the diagnostic) has no example data.

## Log every side question in `QUESTIONS.md`

When Marcos asks a side question about the material (often starting with "btw", but any question about the topic counts), answer it in the chat as usual, **and** add it to the topic's `QUESTIONS.md` (e.g. `mongodb/QUESTIONS.md`; links in it are relative to the topic folder) so they can test themselves later.

- File it under the heading of the lesson it relates to (`## Lesson 0003 · The cache`). Use the lesson being worked on, or the one the question is clearly about. Add a new lesson heading when needed, keeping headings in lesson order. Put questions that don't fit any lesson under `## General`.
- Write the question so it can be answered from memory, without the chat context. Rephrase it if needed.
- Put the answer in a collapsed `<details>` block, so reading the file works as a quiz. Keep the answer short (2–5 sentences), use the course's terms, and include a citation link to the source.
- Add the date and, where useful, a link to the lesson section that covers it.
- Don't log requests for changes (e.g. "add a diagram"). Log questions only.

### Catch up on `/btw` questions at the start of every session

Questions asked with Claude Code's `/btw` command are answered on the side and **never reach the session transcript**, so the rule above can't catch them as they happen. At the start of every session in this workspace, before other work:

1. Read the prompt history `~/.claude/history.jsonl` (one JSON object per line). Keep entries whose `project` is this repo's path and whose `display` starts with `/btw`. `timestamp` is in milliseconds.
2. Skip any question already in the topic's `QUESTIONS.md`. Entries from `/btw` carry `· /btw` in their date line, so you can match on that and on the question text.
3. For each new one, write a fresh answer from the sources (the original `/btw` answer isn't saved) and file it as usual. Use the history timestamp as the date, add `· /btw` to the date line, and put it under the lesson it's about.
4. Tell Marcos in one line how many you added. Say nothing if there were none.

Entry format:

```md
### Q: What does the eviction_trigger threshold do?
_2026-10-27 · [lesson 3 §3](lessons/0003-the-cache.html)_

<details><summary>Answer</summary>

At 95% cache fill (the default), application threads must evict pages before they can read or write. Your queries pay for it as latency. ([WT eviction](https://source.wiredtiger.com/develop/arch-eviction.html))

</details>
```
