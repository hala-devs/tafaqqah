import { expect, test, type Page } from "@playwright/test";
import { questionKey, withDb } from "./db";

/**
 * Admin console vs student app — acceptance run against a server whose database holds a copy of the
 * real curriculum (Lesson 1 approved + published, Lesson 2 draft with open review items).
 *
 *   E2E_BASE_URL=http://localhost:3211 E2E_DATABASE_URL=<that server's DB> npx playwright test admin-console --project=desktop
 *
 * It creates its own users and one throw-away lesson; it never edits Lesson 1 or Lesson 2.
 */
const PASSWORD = "console-pass-2026";
const L1 = "lesson-akhsar-01";
const L2 = "lesson-akhsar-02";
const stamp = Date.now();
const student = { name: `طالب الاختبار ${stamp}`, email: `student-${stamp}@example.com` };
const admin = { name: `مدير الاختبار ${stamp}`, email: `admin-${stamp}@example.com` };
const SCRATCH = `e2e-lesson-${stamp}`;

const ADMIN_PAGES = [
  "/admin",
  "/admin/curriculum",
  "/admin/lessons",
  `/admin/lessons/${L1}`,
  "/admin/sources",
  "/admin/review",
  "/admin/ai",
  "/admin/logs",
  "/admin/evaluation",
  "/admin/students",
  "/admin/analytics",
  "/admin/audit",
  "/admin/settings",
];

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-artifacts/console/${name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const offenders = overflow > 1 ? await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || e.getBoundingClientRect().left < -1).slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 60) + " | " + (e.textContent ?? "").slice(0, 40))) : [];
  expect(overflow, `horizontal scroll on ${where}: ${offenders.join(" ;; ")}`).toBeLessThanOrEqual(1);
}

async function register(page: Page, who: { name: string; email: string }) {
  await page.goto("/register");
  await page.getByLabel("الاسم").fill(who.name);
  await page.getByLabel("البريد الإلكتروني").fill(who.email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL("**/dashboard");
}

async function login(page: Page, who: { email: string }, expectUrl: string) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(who.email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(`**${expectUrl}`);
}

test.describe.configure({ mode: "serial" });

test("SECURITY + STUDENT: students cannot reach /admin and never receive source or admin material", async ({ page }) => {
  await register(page, student);

  for (const path of ["/admin", "/admin/lessons", `/admin/lessons/${L1}`, "/admin/review", "/admin/ai", "/admin/students", "/admin/audit", "/admin/settings"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByText("لوحة الإدارة")).toHaveCount(0);
  }
  expect((await page.request.get("/api/admin/evaluation")).status()).toBe(403);

  // Learner-facing pages: no admin entry points and no source text, even inside the raw HTML/RSC payload.
  const passages = await withDb(async (db) => (await db.query('SELECT text, "rawBahethText", "pdfSource", "bahethUrl" FROM "SourcePassage" WHERE "lessonId" = $1', [L1])).rows);
  expect(passages.length).toBeGreaterThan(5);
  for (const path of ["/dashboard", "/curriculum", `/lessons/${L1}`, "/progress", "/review"]) {
    const html = await (await page.request.get(path)).text();
    for (const row of passages) {
      expect(html.includes(String(row.text).slice(0, 40)), `${path} leaks passage text`).toBe(false);
      if (row.bahethUrl) expect(html.includes(String(row.bahethUrl).slice(0, 60)), `${path} leaks Baheth URL`).toBe(false);
      if (row.pdfSource) expect(html.includes(String(row.pdfSource).slice(0, 30)), `${path} leaks PDF source`).toBe(false);
    }
    for (const needle of ["SourcePassage", "reviewText", "rawPdfText", "alignmentDetails", "humanReviewRequired", "/admin", "GEMINI"]) {
      expect(html.includes(needle), `${path} contains "${needle}"`).toBe(false);
    }
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "إدارة المحتوى" })).toHaveCount(0);
  await shot(page, "student-dashboard");
});

test("STUDENT: learning path → Lesson 1 video → assessment → weak concept → review at approved timestamp → reassessment", async ({ page }) => {
  test.setTimeout(420_000);
  await login(page, student, "/dashboard");
  await page.goto("/curriculum");
  await expect(page.getByRole("list", { name: "مستويات المسار" })).toBeVisible();
  await shot(page, "student-curriculum");

  await page.goto(`/lessons/${L1}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الدرس الأول");
  await expect(page.getByTestId("lesson-video-player")).toBeVisible();
  expect(await page.getByTestId("lesson-video-player").getAttribute("src")).toContain("youtube-nocookie.com/embed/");
  await shot(page, "student-lesson-1");

  // "ابدأ اختبار فهمك" (confirms viewing) → assessment stage → start
  await page.getByRole("button", { name: "ابدأ اختبار فهمك" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ اختبار فهمك" })).toBeVisible();
  await page.getByRole("button", { name: /ابدأ اختبار فهمك/ }).click();
  await page.waitForURL(/\/assessment\?session=/);

  // Answer every question; one concept is always answered wrong so it needs reinforcement.
  let weakConcept: string | null = null;
  for (let i = 0; i < 40; i++) {
    const card = page.locator("[data-question-id]");
    await expect(card).toBeVisible({ timeout: 90_000 });
    const questionId = (await card.getAttribute("data-question-id"))!;
    const key = await questionKey(questionId);
    weakConcept ??= key.conceptId;
    const wrong = key.conceptId === weakConcept;
    const index = wrong ? (key.correctIndex + 1) % key.optionCount : key.correctIndex;
    await page.locator('[role="radiogroup"]').getByRole("radio").nth(index).click();
    await page.getByRole("button", { name: "تأكيد الإجابة" }).click();
    const next = page.getByRole("button", { name: /السؤال التالي|عرض نتيجة الدرس/ });
    await expect(next).toBeVisible({ timeout: 60_000 });
    // The feedback must carry an explanation but never the source passage.
    await expect(page.getByText("من النص المعتمد")).toHaveCount(0);
    const finishing = (await next.textContent())?.includes("عرض نتيجة الدرس");
    await next.click();
    if (finishing) break;
  }
  await page.waitForURL(/\/result/, { timeout: 60_000 });
  await shot(page, "student-result");

  const reviewLink = page.getByRole("link", { name: "راجع الشرح" }).first();
  await expect(reviewLink).toBeVisible();
  const concept = await withDb(async (db) => (await db.query('SELECT id, "videoStartSecond", "videoEndSecond", "videoApproved" FROM "Concept" WHERE id = $1', [weakConcept])).rows[0]);
  expect(concept.videoApproved).toBe(true);

  await reviewLink.click();
  await page.waitForURL(new RegExp(`/lessons/${L1}/review/${weakConcept}$`));
  const player = page.getByTestId("video-player");
  await expect(player).toBeVisible();
  const src = (await player.getAttribute("src"))!;
  expect(src).toContain(`start=${concept.videoStartSecond}`);
  if (concept.videoEndSecond != null) expect(src).toContain(`end=${concept.videoEndSecond}`);
  await shot(page, "student-review-timestamp");
  // Review page: no transcript, no source passage.
  const html = await (await page.request.get(page.url())).text();
  const passage = await withDb(async (db) => (await db.query('SELECT text FROM "SourcePassage" WHERE "conceptId" = $1', [weakConcept])).rows[0]);
  expect(html.includes(String(passage.text).slice(0, 40))).toBe(false);

  // "اختبر فهمي مرة أخرى" → focused reassessment on that concept only
  await page.getByRole("button", { name: /اختبر فهمي مرة أخرى/ }).click();
  await page.waitForURL(/\/assessment\?session=/, { timeout: 60_000 });
  await expect(page.locator("[data-question-id]")).toBeVisible({ timeout: 150_000 });
  const reassessKey = await questionKey((await page.locator("[data-question-id]").getAttribute("data-question-id"))!);
  expect(reassessKey.conceptId).toBe(weakConcept);
  await shot(page, "student-reassessment");
});

test("ADMIN: login lands on the dashboard; sidebar is admin-only; every section renders", async ({ page }) => {
  await register(page, admin);
  await withDb((db) => db.query(`UPDATE "User" SET role = 'ADMIN' WHERE email = $1`, [admin.email]));
  await page.goto("/account");
  await page.getByRole("button", { name: "تسجيل الخروج" }).last().click();
  await page.waitForURL((url) => url.pathname === "/");

  await login(page, admin, "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "لوحة الإدارة" })).toBeVisible();
  await expect(page.getByTestId("admin-account")).toHaveText(admin.name);
  const sidebar = page.getByRole("navigation", { name: "أقسام لوحة الإدارة" }).first();
  for (const label of ["الرئيسية", "المسار العلمي", "الدروس", "المحتوى والمصادر", "مراجعة المحتوى", "الاختبارات والذكاء الاصطناعي", "الطلاب", "التحليلات", "سجل العمليات", "الإعدادات"]) {
    await expect(sidebar.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // Nothing from the student shell.
  for (const label of ["تقدمي", "المراجعة"]) await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toHaveCount(0);
  await expect(page.getByTestId("needs-action")).toBeVisible();
  await shot(page, "admin-dashboard");

  const key = process.env.GEMINI_API_KEY;
  for (const path of ADMIN_PAGES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toHaveCount(0);
    await noHorizontalScroll(page, path);
    if (key) expect((await page.content()).includes(key), `${path} exposes the API key`).toBe(false);
  }
  // Student-only secrets/flows are still absent from the admin payload for the key in particular.
  if (key) expect((await (await page.request.get("/admin/ai")).text()).includes(key)).toBe(false);
});

test("ADMIN: Lesson 1 control centre — info, source, video timestamps, concept status", async ({ page }) => {
  await login(page, admin, "/admin");
  await page.goto(`/admin/lessons/${L1}`);
  await expect(page.getByTestId("lesson-admin-title")).toBeVisible();
  await expect(page.getByTestId("lesson-status-chips")).toContainText("PUBLISHED");
  await expect(page.getByTestId("lesson-source-info")).toContainText("PDF");
  await expect(page.locator('[data-testid="concept-status-row"]')).toHaveCount(12);
  await expect(page.getByTestId("passage-review-text").first()).toBeVisible();
  await shot(page, "admin-lesson-1");

  const verifier = page.getByTestId("admin-video-verifier");
  await verifier.scrollIntoViewIfNeeded();
  const second = await withDb(async (db) => (await db.query('SELECT id, title, "videoStartSecond" FROM "Concept" WHERE "lessonId" = $1 ORDER BY "order" LIMIT 1 OFFSET 1', [L1])).rows[0]);
  await page.locator("#verifier-concept").selectOption(second.id);
  const player = page.getByTestId("admin-video-player");
  await expect(player).toHaveAttribute("data-src", new RegExp(`start=${second.videoStartSecond}(&|$)`));
  await page.getByRole("button", { name: "تشغيل من بداية المقطع" }).click();
  await expect(player).toHaveAttribute("data-src", /autoplay=1/);
  await expect(page.getByTestId("verifier-range")).toBeVisible();

  // Deep link from the review queue lands on the concept and preselects it in the player.
  await page.goto(`/admin/lessons/${L1}?concept=${second.id}#concept-${second.id}`);
  await expect(page.locator("#verifier-concept")).toHaveValue(second.id);
});

test("ADMIN: review queue, bulk approval ≠ publication, publish, revocation on edit, audit trail", async ({ page }) => {
  await withDb(async (db) => {
    const chapter = (await db.query('SELECT "chapterId" FROM "Lesson" WHERE id = $1', [L1])).rows[0].chapterId;
    await db.query(`INSERT INTO "Lesson"(id,"chapterId",title,description,objectives,"order",status,"updatedAt") VALUES ($1,$2,'درس اختبار لوحة الإدارة','وصف',ARRAY[]::text[],90,'DRAFT',now())`, [SCRATCH, chapter]);
    await db.query(`INSERT INTO "Concept"(id,"lessonId",title,description,"order","videoUrl","videoStartSecond","videoEndSecond","updatedAt") VALUES ($1,$2,'مفهوم الاختبار','وصف المفهوم',1,'https://youtu.be/FdxZylJyi-w',10,20,now())`, [`${SCRATCH}-c`, SCRATCH]);
    await db.query(`INSERT INTO "SourcePassage"(id,"lessonId","conceptId",text,"sourceTitle","sourceAuthor","sourceReference","startSecond","endSecond","updatedAt") VALUES ($1,$2,$3,'نص تجريبي كامل يستخدم لاختبار الاعتماد والنشر في لوحة الإدارة فقط.','مصدر','مؤلف','موضع',10,20,now())`, [`${SCRATCH}-p`, SCRATCH, `${SCRATCH}-c`]);
  });

  await login(page, admin, "/admin");

  // Review queue: Lesson 2's flagged concepts are there and link straight to the concept.
  await page.goto("/admin/review?filter=HUMAN_REVIEW");
  const queue = page.getByTestId("review-queue");
  await expect(queue).toBeVisible();
  const firstHref = await queue.getByRole("link").first().getAttribute("href");
  expect(firstHref).toMatch(new RegExp(`^/admin/lessons/${L2}\\?concept=.+#concept-`));
  await shot(page, "admin-review-queue");
  await page.goto("/admin/review?filter=READY_TO_APPROVE");
  await expect(page.getByTestId("review-queue")).toContainText("درس اختبار لوحة الإدارة");

  // Lesson page: ready for review, not approved, publishing blocked.
  await page.goto(`/admin/lessons/${SCRATCH}`);
  await expect(page.getByTestId("lesson-status-chips")).toContainText("جاهز للمراجعة");
  await expect(page.getByTestId("publish-blocked")).toBeVisible();

  // Bulk approval → approved internally, still NOT published.
  await page.getByRole("button", { name: "اعتماد جميع المقاطع والتوقيتات" }).click();
  await expect(page.getByText("اعتمدت المقاطع والتوقيتات بعد المراجعة البشرية.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("lesson-status-chips")).toContainText("معتمد داخليًا");
  await expect(page.getByTestId("lesson-status-chips")).toContainText("غير منشور");
  await expect(page.getByTestId("publish-blocked")).toHaveCount(0);
  expect((await withDb((db) => db.query('SELECT status FROM "Lesson" WHERE id = $1', [SCRATCH]))).rows[0].status).toBe("DRAFT");

  // Explicit publication.
  await page.getByRole("button", { name: "نشر الدرس للطلاب" }).click();
  await expect(page.getByText("حُدّثت حالة نشر الدرس.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("lesson-status-chips")).toContainText("منشور للطلاب");
  expect((await withDb((db) => db.query('SELECT status FROM "Lesson" WHERE id = $1', [SCRATCH]))).rows[0].status).toBe("PUBLISHED");

  // A material edit revokes approval and flags the published lesson.
  await page.locator(`#concept-${SCRATCH}-c`).getByText("تعديل النص أو بيانات المصدر").click();
  await page.locator(`#p-text-${SCRATCH}-p`).fill("نص تجريبي معدّل جوهريًا بعد الاعتماد لاختبار إبطال الاعتماد في لوحة الإدارة.");
  await page.locator(`#concept-${SCRATCH}-c`).getByRole("button", { name: "حفظ المقطع" }).click();
  await expect(page.getByText("حُفظ المقطع.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("lesson-status-chips")).toContainText("منشور وبعض الاعتماد ملغى");
  const row = (await withDb((db) => db.query('SELECT approved, version FROM "SourcePassage" WHERE id = $1', [`${SCRATCH}-p`]))).rows[0];
  expect(row).toMatchObject({ approved: false, version: 2 });
  await page.goto("/admin/review?filter=TEXT_UNAPPROVED");
  await expect(page.getByTestId("review-queue")).toContainText("درس اختبار لوحة الإدارة");

  // Audit trail names the admin and the actions.
  await page.goto("/admin/audit");
  const log = page.getByTestId("audit-log");
  await expect(log).toContainText("اعتماد الدرس كاملًا");
  await expect(log).toContainText("نشر الدرس للطلاب");
  await expect(log).toContainText("تعديل مقطع مصدري");
  await expect(log).toContainText(`بواسطة ${admin.name}`);
  await shot(page, "admin-audit");
  await page.goto("/admin/audit?category=publication");
  await expect(page.getByTestId("audit-log")).toContainText("نشر الدرس");
  await expect(page.getByTestId("audit-log")).not.toContainText("اعتماد الدرس كاملًا");
});

test("ADMIN: AI trial generation uses an approved concept, shows source and validator, touches no student state", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, admin, "/admin");
  await page.goto("/admin/ai");
  await expect(page.getByTestId("ai-provider-status")).toContainText(/mock|gemini|anthropic/);

  const before = await withDb(async (db) => ({
    questions: Number((await db.query('SELECT count(*) FROM "GeneratedQuestion"')).rows[0].count),
    mastery: (await db.query('SELECT coalesce(sum("attempts"),0) AS a, count(*) AS n FROM "ConceptMastery"')).rows[0],
    sessions: Number((await db.query('SELECT count(*) FROM "AssessmentSession"')).rows[0].count),
    answers: Number((await db.query('SELECT count(*) FROM "StudentAnswer"')).rows[0].count),
    audit: Number((await db.query(`SELECT count(*) FROM "AuditEvent" WHERE action = 'ai.trial_generation'`)).rows[0].count),
  }));

  await page.getByRole("button", { name: "توليد سؤال تجريبي" }).click();
  const result = page.getByTestId("trial-result");
  await expect(result).toBeVisible({ timeout: 200_000 });
  await expect(page.getByTestId("trial-source")).toContainText("المصدر المعتمد");
  await shot(page, "admin-ai-trial");

  const after = await withDb(async (db) => ({
    questions: Number((await db.query('SELECT count(*) FROM "GeneratedQuestion"')).rows[0].count),
    mastery: (await db.query('SELECT coalesce(sum("attempts"),0) AS a, count(*) AS n FROM "ConceptMastery"')).rows[0],
    sessions: Number((await db.query('SELECT count(*) FROM "AssessmentSession"')).rows[0].count),
    answers: Number((await db.query('SELECT count(*) FROM "StudentAnswer"')).rows[0].count),
    trialLogs: Number((await db.query(`SELECT count(*) FROM "AIInteractionLog" WHERE (metadata->>'trial') = 'true'`)).rows[0].count),
    audit: Number((await db.query(`SELECT count(*) FROM "AuditEvent" WHERE action = 'ai.trial_generation'`)).rows[0].count),
  }));
  expect(after.questions).toBe(before.questions);
  expect(after.mastery).toEqual(before.mastery);
  expect(after.sessions).toBe(before.sessions);
  expect(after.answers).toBe(before.answers);
  expect(after.trialLogs).toBeGreaterThan(0);
  expect(after.audit).toBe(before.audit + 1);
  console.log("trial outcome:", (await result.textContent())?.slice(0, 160));
});

test("ADMIN: students and analytics show real data without sensitive fields", async ({ page }) => {
  await login(page, admin, "/admin");
  await page.goto("/admin/students");
  const table = page.getByTestId("admin-students-table");
  await expect(table).toContainText(student.name);
  const text = await table.textContent();
  expect(text).not.toContain(student.email);
  await shot(page, "admin-students");
  await table.getByRole("link", { name: student.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: student.name })).toBeVisible();
  await expect(page.getByText("الإتقان لكل مفهوم")).toBeVisible();
  expect(await page.content()).not.toContain(student.email);
  await shot(page, "admin-student-detail");

  await page.goto("/admin/analytics");
  await expect(page.getByRole("heading", { name: "الدروس الأكثر دراسة ونسبة الإكمال" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المفاهيم الأكثر خطأً" })).toBeVisible();
  await shot(page, "admin-analytics");
});

test("RESPONSIVE: admin works on a phone-width viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, admin, "/admin");
  await page.getByRole("button", { name: "فتح قائمة الإدارة" }).click();
  await expect(page.getByRole("dialog", { name: "قائمة لوحة الإدارة" })).toBeVisible();
  await shot(page, "admin-mobile-menu");
  await page.getByRole("dialog").getByRole("link", { name: "الدروس", exact: true }).click();
  await page.waitForURL("**/admin/lessons");
  for (const path of ["/admin", "/admin/lessons", `/admin/lessons/${L1}`, "/admin/review", "/admin/ai", "/admin/students", "/admin/analytics", "/admin/audit"]) {
    await page.goto(path);
    await noHorizontalScroll(page, `${path} (mobile)`);
  }
});
