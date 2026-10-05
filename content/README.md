# content/

Source text used to build Tafaqqah's content. **The running app does not read this folder.** Learners only see what is in the database, and only after a person approves it in `/admin`. A fresh database gets the approved release content from `prisma/seed-data/release-content.json`.

| File | Role |
|---|---|
| `sources/akhsar-al-mukhtasarat-matn.md` | Canonical Matn source of «أخصر المختصرات» (metadata header + Matn text; `##` lines are app navigation headings, not Matn text) |
| `matn-akhsar.source.txt` | Generated from the canonical source by `npm run content:build-matn`: one memorization unit per line |
| `matn-akhsar.structure.json` | Generated section/passage/unit structure; imports as DRAFT and must be approved in `/admin/matn` |

The integrity tests (`tests/matn-source-integrity.test.ts`, `tests/memorization-rules.test.ts`, `tests/release-content.test.ts`) check that these files and the release snapshot agree word for word.

Not in the public repository: source PDFs/scans, text extracted from them, raw timed transcripts, and the internal Lesson 2 draft review material. See [docs/ATTRIBUTION.md](../docs/ATTRIBUTION.md).

## Content model

```
LearningPath → Level → Course (book) → Chapter → Lesson → Concept → SourcePassage (+ optional review video)
```

- A **concept** is one assessable idea. Questions, mastery and targeted review all work per concept.
- A **source passage** is the exact verified text for a concept, with its provenance (title, author, location, edition, licence, permission note, and for a timed transcript its URL and segment bounds). These are human-entered; the AI never fetches or generates them.
- Only approved passages are shown to learners or sent to the question generator. Editing the text bumps the version and revokes approval. A lesson is published separately, only after all its passages and timestamps are approved.

## Adding content in `/admin`

1. Sign in as an admin.
2. Open a lesson and make each concept a single assessable idea.
3. Add a passage per concept: paste the verified text exactly, fill in its provenance, then approve it.
4. Optionally add the review video segment (URL + start/end after watching), then approve it.
5. Add human-written fixed questions and approve them (baseline bank, AI-failure fallback, pre/post tests).
6. Publish the lesson.
7. After approving new content, run `npx tsx scripts/export-release-content.ts` to refresh the release snapshot.

Only publish text and link videos you have the right to use. Never scrape modern commentary.
