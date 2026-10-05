import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clampSessionSize, normalizeSessionSize } from "@/components/memorize/recitation-flow";
import { MAX_MEMORIZATION_SESSION_UNITS, getMemorizationSessionAvailability, getMemorizationSessionUnits } from "@/server/memorization/content";
import { submitRecitation } from "@/server/memorization/recitation";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";

const approved = "APPROVED" as const;

async function addPassage(db: PrismaClient, sectionId: string, id: string, order: number, unitCount: number) {
  await db.matnPassage.create({ data: { id, sectionId, order, title: id, status: approved } });
  await db.matnUnit.createMany({
    data: Array.from({ length: unitCount }, (_, index) => ({ id: `${id}-u${index + 1}`, passageId: id, order: index + 1, canonicalText: `وَحْدَةُ ${id} ${index + 1}`, status: approved })),
  });
}

describe("custom session count normalization", () => {
  it("accepts only whole positive values inside the effective maximum", () => {
    expect(clampSessionSize(1, 20)).toBe(1);
    expect(clampSessionSize(20, 20)).toBe(20);
    expect(clampSessionSize(21, 20)).toBe(20);
    expect(normalizeSessionSize("7", 14, 1)).toBe(7);
    expect(normalizeSessionSize("0", 20, 7)).toBe(1);
    expect(normalizeSessionSize("21", 20, 7)).toBe(20);
    for (const value of ["-1", "2.5", "", "NaN"]) expect(normalizeSessionSize(value, 20, 7)).toBe(7);
  });
});

describe.skipIf(!hasTestDb)("book-bounded canonical session selection", () => {
  let db: PrismaClient;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
    await db.matnSection.create({ data: { id: "session-s1", courseId: "c1", order: 10, title: "أول", status: approved } });
    await db.matnSection.create({ data: { id: "session-s2", courseId: "c1", order: 11, title: "ثان", status: approved } });
    await addPassage(db, "session-s1", "session-p1", 1, 4);
    await addPassage(db, "session-s1", "session-p2", 2, 6);
    await addPassage(db, "session-s2", "session-p3", 1, 4);
  });

  it("returns exact, approved canonical sequences across passages and sections without crossing books", async () => {
    const ids = (await getMemorizationSessionUnits(db, "session-p1", "session-p1-u1", 10))!.map((unit) => unit.id);
    expect(ids).toEqual([...Array.from({ length: 4 }, (_, i) => `session-p1-u${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `session-p2-u${i + 1}`)]);
    expect(new Set(ids).size).toBe(ids.length);

    const acrossSection = await getMemorizationSessionUnits(db, "session-p2", "session-p2-u6", 5);
    expect(acrossSection?.map((unit) => unit.id)).toEqual(["session-p2-u6", "session-p3-u1", "session-p3-u2", "session-p3-u3", "session-p3-u4"]);
    expect(await getMemorizationSessionAvailability(db, "session-p2", "session-p2-u4")).toBe(7);
    expect((await getMemorizationSessionUnits(db, "session-p2", "session-p2-u4", 3))?.length).toBe(3);
    expect((await getMemorizationSessionUnits(db, "session-p2", "session-p2-u4", 5))?.length).toBe(5);
    expect(await getMemorizationSessionUnits(db, "session-p2", "session-p2-u4", 10)).toBeNull();
    for (const count of [0, -1, 21, 2.5]) expect(await getMemorizationSessionUnits(db, "session-p1", "session-p1-u1", count)).toBeNull();

    await db.course.create({ data: { id: "other-book", slug: "other-book", title: "آخر", description: "", madhhab: "", order: 2 } });
    await db.matnSection.create({ data: { id: "other-section", courseId: "other-book", order: 1, title: "آخر", status: approved } });
    await addPassage(db, "other-section", "other-passage", 1, 3);
    expect(await getMemorizationSessionUnits(db, "session-p3", "session-p3-u4", 2)).toBeNull();
  });

  it("revalidates the submitted sequence as canonical, consecutive, approved, and at most twenty units", async () => {
    const student = await createUser(db, "session-size@example.com");
    const units = await getMemorizationSessionUnits(db, "session-p1", "session-p1-u1", 10);
    await expect(submitRecitation(db, student.id, { passageId: "session-p1", clientAttemptId: "session-size-valid", results: units!.map((unit) => ({ unitId: unit.id, status: "CORRECT" })) }, { provider: null })).resolves.toMatchObject({ created: true });
    await expect(submitRecitation(db, student.id, { passageId: "session-p1", clientAttemptId: "session-size-bad", results: [
      { unitId: "session-p1-u1", status: "CORRECT" }, { unitId: "session-p1-u3", status: "CORRECT" },
    ] }, { provider: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("session maximum", () => {
  it("remains twenty units", () => expect(MAX_MEMORIZATION_SESSION_UNITS).toBe(20));
});
