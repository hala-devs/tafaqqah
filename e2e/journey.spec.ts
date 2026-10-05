import { expect, test, type Page } from "@playwright/test";
import { questionKey, setConceptVideo } from "./db";

/**
 * Judging-flow acceptance journey:
 * Register → Learning Path (7 levels, Level 1 active) → Lesson → Study → Adaptive assessment
 * → repeated weakness on one concept → «يحتاج إلى تثبيت» → Targeted review at the exact
 * approved video timestamp → «اختبر فهمي مرة أخرى» → new questions → updated mastery
 * → Logout/Login → progress persists → admin traceability denied to students.
 */
const WEAK_CONCEPT = "concept-approved-source";
const REVIEW_VIDEO = { url: "https://example.com/tafaqqah-e2e-review.mp4", start: 755, end: 980 };

const shots = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `e2e-artifacts/screens/${project}-${name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

/** Answers until the result page. `wantCorrect(conceptId)` decides right or wrong per question. */
async function answerUntilResult(page: Page, project: string, wantCorrect: (conceptId: string) => boolean, shotPrefix: string) {
  for (let i = 0; i < 12; i++) {
    const card = page.locator("[data-question-id]");
    await expect(card).toBeVisible({ timeout: 60_000 });
    const questionId = await card.getAttribute("data-question-id");
    const key = await questionKey(questionId!);
    const index = wantCorrect(key.conceptId) ? key.correctIndex : (key.correctIndex + 1) % key.optionCount;
    await page.locator('[role="radiogroup"]').getByRole("radio").nth(index).click();
    if (i === 0) await shots(page, project, `${shotPrefix}-question`);
    await page.getByRole("button", { name: "تأكيد الإجابة" }).click();
    const next = page.getByRole("button", { name: /السؤال التالي|عرض نتيجة الدرس/ });
    await expect(next).toBeVisible({ timeout: 30_000 });
    if (i === 0) {
      await shots(page, project, `${shotPrefix}-feedback`);
      await noHorizontalScroll(page);
    }
    const finishing = (await next.textContent())?.includes("عرض نتيجة الدرس");
    await next.click();
    if (finishing) break;
  }
  await page.waitForURL(/\/result/, { timeout: 60_000 });
}

test("judging flow: learning path → weakness → targeted review → reassessment → persistence", async ({ page }, info) => {
  const project = info.project.name;
  const email = `learner-${project}-${Date.now()}@example.com`;
  const password = "journey-pass-2026";

  // Landing
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("تعلّم الفقه بفهمٍ متدرّج");
  await noHorizontalScroll(page);
  await shots(page, project, "01-landing");

  // Register (logs in)
  await page.goto("/register");
  await page.getByLabel("الاسم").fill("عبدالله");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "أكمل رحلتك" })).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, project, "02-dashboard-new");

  // Learning path: 7 levels, only Level 1 active
  await page.goto("/curriculum");
  const levels = page.getByRole("list", { name: "مستويات المسار" }).locator(":scope > li");
  await expect(levels).toHaveCount(7);
  await expect(levels.first()).toContainText("أخصر المختصرات");
  await expect(levels.first()).toContainText("المستوى الحالي");
  await expect(levels.nth(6)).toContainText("الروض المربع");
  await expect(levels.nth(6)).toContainText("قريبًا");
  await expect(page.getByText("الدرس الحالي").first()).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, project, "03-curriculum");

  // Lesson → study
  await page.getByRole("link", { name: /منهج الدراسة والاختبار/ }).first().click();
  await page.waitForURL(/\/lessons\/lesson-method$/);
  await expect(page.getByLabel("المصدر العلمي")).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, project, "04-lesson");
  await page.goto("/lessons/lesson-method/assessment");
  await expect(page.getByText("أكمل دراسة الدرس أولًا لبدء اختبار الفهم.")).toBeVisible();
  await page.goto("/lessons/lesson-method");
  await page.getByRole("button", { name: "أكملت دراسة الدرس" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ اختبار فهمك" })).toBeVisible();
  await page.getByRole("button", { name: /ابدأ اختبار فهمك/ }).click();
  await page.waitForURL(/\/assessment\?session=/);

  // Adaptive assessment: one concept is always answered wrong → repeated weakness
  await answerUntilResult(page, project, (conceptId) => conceptId !== WEAK_CONCEPT, "05");
  await expect(page.getByRole("heading", { name: "أحسنت، أكملت اختبار الدرس" })).toBeVisible();
  const reinforce = page.getByRole("region", { name: "يحتاج إلى تثبيت" });
  await expect(reinforce.getByText("المادة العلمية المعتمدة")).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, project, "07-result");

  // Targeted review at the exact approved timestamp (human-approved metadata, set by the test)
  await setConceptVideo(WEAK_CONCEPT, REVIEW_VIDEO);
  try {
    await page.reload();
    await expect(page.getByText("الجزء المقترح للمراجعة:").first()).toBeVisible();
    await page.getByRole("link", { name: "راجع الشرح" }).first().click();
    await page.waitForURL(new RegExp(`/lessons/lesson-method/review/${WEAK_CONCEPT}$`));
    await expect(page.getByTestId("video-range")).toHaveText("١٢:٣٥ – ١٦:٢٠");
    await expect(page.getByTestId("video-player")).toHaveAttribute("src", /#t=755,980$/);
    await expect(page.getByTestId("review-passage")).toHaveAttribute("data-passage-id", "passage-approved-source");
    await noHorizontalScroll(page);
    await shots(page, project, "08-targeted-review");
  } finally {
    await setConceptVideo(WEAK_CONCEPT, null);
  }

  // Reassessment: new questions on the weak concept, answered correctly
  await page.reload();
  await expect(page.getByTestId("video-player")).toHaveCount(0); // no approved timestamp → text only
  await page.getByRole("button", { name: /اختبر فهمي مرة أخرى/ }).click();
  await page.waitForURL(/\/assessment\?session=/);
  await expect(page.getByText("اختبر فهمك مرة أخرى")).toBeVisible();
  await answerUntilResult(page, project, () => true, "09-reassess");
  await expect(page.getByRole("heading", { name: "نتيجة إعادة الاختبار" })).toBeVisible();
  await expect(page.getByTestId("reassessment-change").first()).toContainText("قبل: يحتاج إلى تثبيت");
  await shots(page, project, "10-reassessment-result");

  await page.goto("/review");
  await shots(page, project, "11-review");
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "سجلّ الاختبارات" })).toBeVisible();

  // Persistence across logout / login
  await page.goto("/account");
  await page.getByRole("button", { name: "تسجيل الخروج" }).last().click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "مستوى الإتقان" })).toBeVisible();
  await page.goto("/curriculum");
  await expect(page.getByText("مكتمل").first()).toBeVisible();
  await page.goto("/dashboard");
  await shots(page, project, "12-dashboard-after");

  // Students cannot reach admin traceability
  for (const path of ["/admin", "/admin/logs", "/admin/evaluation"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  expect((await page.request.get("/api/admin/evaluation")).status()).toBe(403);
});

test("admin can review content and trace generated questions", async ({ page }, info) => {
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "ADMIN_EMAIL/ADMIN_PASSWORD not set");
  const project = info.project.name;
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "إدارة المحتوى والمراجعة" })).toBeVisible();
  await expect(page.getByText("٧. الروض المربع", { exact: true })).toBeVisible();
  await shots(page, project, "13-admin");
  await page.goto("/admin/lessons/lesson-method");
  await expect(page.getByTestId("concept-video-admin").first()).toBeVisible();
  await shots(page, project, "14-admin-lesson");
  await page.goto("/admin/logs");
  await expect(page.getByTestId("trace-row").first()).toBeVisible();
  await shots(page, project, "15-admin-logs");
  await page.locator('a[href^="/admin/questions/"]').first().click();
  await expect(page.getByTestId("trace-summary")).toContainText("Displayed to learner");
  await shots(page, project, "16-admin-trace");
  await page.goto("/admin/evaluation");
  await expect(page.getByRole("heading", { name: "القياس القبلي والبعدي" })).toBeVisible();
  await shots(page, project, "17-admin-evaluation");
});
