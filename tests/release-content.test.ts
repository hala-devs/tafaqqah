import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";

/** The public release snapshot (prisma/seed-data/release-content.json) holds only human-approved content, verbatim. */
const raw = readFileSync("prisma/seed-data/release-content.json", "utf8");
const snap = JSON.parse(raw);
const source = readFileSync("content/matn-akhsar.source.txt", "utf8");

describe("release content snapshot", () => {
  it("has the expected format and contains no user, approver or learner data", () => {
    expect(snap.format).toBe("tafaqqah-release-content/v1");
    expect(raw).not.toMatch(/approvedById|userId|passwordHash|"email"|@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(Object.keys(snap).sort()).toEqual(["chapters", "format", "lessons", "matnSections", "note", "quotes"]);
  });

  it("exports only published lessons whose every passage is approved, with provenance", () => {
    expect(snap.lessons.length).toBeGreaterThan(0);
    for (const l of snap.lessons) {
      expect(l.status).toBe("PUBLISHED");
      for (const p of l.passages) {
        expect(p.approved).toBe(true);
        expect(p.approvedAt).toBeTruthy();
        expect(p.sourceTitle && p.sourceAuthor && p.sourceReference).toBeTruthy();
      }
      for (const q of l.fixedQuestions) expect(q.approved).toBe(true);
    }
  });

  it("exports only APPROVED Matn rows, and every unit is word for word in the canonical source", () => {
    const units = snap.matnSections.flatMap((s: { status: string; passages: { status: string; units: { status: string; canonicalText: string }[] }[] }) => {
      expect(s.status).toBe("APPROVED");
      return s.passages.flatMap((p) => {
        expect(p.status).toBe("APPROVED");
        return p.units;
      });
    });
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) {
      expect(u.status).toBe("APPROVED");
      expect(source).toContain(u.canonicalText);
      expect(tokenizeCanonicalMatn(u.canonicalText).length).toBeGreaterThan(0);
    }
  });
});
