# Attribution, licences and source rights

## Software

The software code authored for Tafaqqah is released under the [MIT License](../LICENSE).

**The MIT license applies to the software code authored for this project. Third-party source materials remain subject to their respective rights and are not relicensed by this repository.**

## Source materials

Tafaqqah identifies its sources so that every passage can be traced. **Attribution is not, by itself, a claim of permission.** Except for the documented permission for Sheikh Muhammad bin Ahmad Bajaber's explanations below, this repository does not claim any publisher permission, redistribution licence, endorsement, partnership, scholarly certification or formal authorization from the author's heirs, the editors, the publisher, any platform, or other rights holders.

### The Matn (memorization journey)

| | |
|---|---|
| Work | «أخصر المختصرات» |
| Author | محمد بن بدر الدين بن بلبان الحنبلي |
| Edition used for transcription | تحقيق د. أنس بن عادل اليتامى و د. عبدالعزيز بن عدنان العيدان — دار ركائز للنشر والتوزيع — الطبعة الأولى 1441هـ / 2019م |
| What is included | The Matn words only, from the author's introduction to the end of «فصل الحيض والنفاس». No footnotes, apparatus, introduction or other editorial material of the edition. |
| Files | `content/sources/akhsar-al-mukhtasarat-matn.md` (canonical), `content/matn-akhsar.source.txt`, `content/matn-akhsar.structure.json`, and the approved units in `prisma/seed-data/release-content.json` |

Section headings marked as derived (`titleIsDerived`) are navigation labels written for the app, not Matn text.

### The explanation (understanding journey, Lesson 1)

| | |
|---|---|
| Explanation | شرح «أخصر المختصرات» — الشيخ محمد بن أحمد باجابر (recorded lesson) |
| Used for | Lesson 1 source passages and their human-approved review timestamps |
| Video | referenced by URL with start/end times — never re-hosted |
| Files | `prisma/seed-data/release-content.json` (approved passages, timestamps and baseline questions) |

Each passage stores its own provenance fields (source title, location, edition note, timed-transcript URL, PDF page range) and is visible to admins under **/admin/sources**.

### Permission for Sheikh Muhammad bin Ahmad Bajaber's explanations

Tafaqqah has received explicit permission from Sheikh Muhammad bin Ahmad Bajaber to use his recorded explanations/videos for the project.

Evidence of this permission is retained privately by the project team and can be provided to the judging committee if required.

The original recordings remain attributed to Sheikh Muhammad bin Ahmad Bajaber. Tafaqqah does not claim ownership of the Sheikh's original recordings.

This permission concerns the Sheikh's recorded explanations/videos only. It does not grant rights over the Matn edition, the publisher's edition, third-party PDFs, platform-owned materials, or any other third-party content; those rights remain documented separately according to their actual status.

### Not included in this repository

- **Source PDFs and scans**, including the transcript PDF of the explanation used during content preparation. Their redistribution rights have not been established, so they are kept off the repository and out of the Docker build context (`.gitignore`, `.dockerignore`). The app, build, Docker image and release seed do not need them.
- Text extracted from those PDFs, raw third-party timed transcripts, and the internal review material of the unpublished Lesson 2.

## Planned levels

The roadmap names book titles (أخصر المختصرات، الأصول من علم الأصول، دليل الطالب، زاد المستقنع، شرح المحلي على الورقات، عمدة الأحكام، الروض المربع) as **planned levels only**. No content from those works is included. The sequence is Tafaqqah's own plan and is not attributed to any scholar.

The sample lessons in `prisma/seed-data/curriculum.ts` (about Tafaqqah's own method) are original text written for this project.

## Adding more content

Record for every passage, in `/admin`: source title, author, location (book / bab / page), edition (publisher, تحقيق), licence, and a permission note. Modern edited editions and commentaries may be under copyright. If redistribution rights are unclear, keep the text out of the public repository and enter it only on a private deployment.

## Third-party software

| Component | Licence |
|---|---|
| Next.js, React | MIT |
| Prisma ORM | Apache-2.0 |
| Tailwind CSS | MIT |
| Zod | MIT |
| lucide-react (icons) | ISC |
| Google Gen AI SDK (`@google/genai`) | Apache-2.0 |
| Anthropic TypeScript SDK | MIT |
| node-postgres (`pg`) | MIT |
| Vitest, Playwright | MIT, Apache-2.0 |
| IBM Plex Sans Arabic (font) | SIL Open Font License 1.1 |
| Noto Naskh Arabic (font) | SIL Open Font License 1.1 |

Full licence texts ship with each package in `node_modules`. The fonts are self-hosted from `src/app/fonts/` with their OFL licence texts.
