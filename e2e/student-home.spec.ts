import { expect, test, type Page } from "@playwright/test";
import { questionKey, withDb } from "./db";

/**
 * Student experience journey: new student → home → weekly goal → continue → lesson → (studied)
 * → continue goes to the assessment → completion experience → home reflects streak, goal and
 * mastery → refresh keeps everything. Needs a server on a DB with the sample curriculum.
 */
const LESSON = "lesson-method";

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(1);
}

test("student home → goal → continue → complete → streak/goal/mastery persist", async ({ page }, info) => {
  const project = info.project.name;
  const email = `home-${project}-${Date.now()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("الاسم").fill("هبة الحربي");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("home-pass-2026");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/dashboard/);

  // NEW student: greeting, start CTA, empty goal prompt, no fake numbers.
  await expect(page.getByText("السلام عليكم، هبة")).toBeVisible();
  await expect(page.getByRole("heading", { name: "واصل رحلتك في طلب العلم" })).toBeVisible();
  await expect(page.getByTestId("home-learning").getByRole("link")).toContainText("ابدأ الدرس");
  await expect(page.getByTestId("home-memorization").getByRole("link")).toContainText("ابدأ الحفظ");
  await expect(page.getByTestId("memo-goal-empty")).toBeVisible();
  await expect(page.getByTestId("home-learning")).toBeVisible();
  await expect(page.getByTestId("home-memorization")).toBeVisible();
  await expect(page.getByTestId("streak-count")).toHaveText("ابدأ سلسلتك اليوم");
  await expect(page.getByTestId("weekly-goal-empty")).toBeVisible();
  await expect(page.getByTestId("review-callout")).toHaveCount(0);
  await expect(page.getByTestId("quote-of-day")).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: `e2e-artifacts/screens/${project}-home-new.png`, fullPage: true });

  // Set the weekly goal (2 lessons); it persists across a reload.
  await page.getByRole("button", { name: "حدد عدد الدروس" }).click();
  await page.getByRole("button", { name: "درسان" }).click();
  await expect(page.getByTestId("weekly-goal")).toContainText("٠ من درسان");
  await page.reload();
  await expect(page.getByTestId("weekly-goal")).toContainText("درسان");

  // Continue → the lesson the learner has to study.
  await page.getByTestId("home-learning").getByRole("link").click();
  await page.waitForURL(new RegExp(`/lessons/${LESSON}$`));
  await expect(page.getByRole("list", { name: "مراحل الدرس" })).toBeVisible();
  await noOverflow(page);

  // Studying is recorded (test shortcut: the sample lesson has no student video to confirm from).
  const userId = await withDb(async (db) => (await db.query('SELECT id FROM "User" WHERE email = $1', [email])).rows[0].id as string);
  await withDb((db) =>
    db.query('INSERT INTO "LessonProgress" (id, "userId", "lessonId", studied, "studiedAt") VALUES ($1,$2,$3,true,now())', [`lp-${Date.now()}`, userId, LESSON]),
  );

  // Home → «متابعة التعلّم» goes to the assessment now.
  await page.goto("/dashboard");
  await expect(page.getByTestId("home-learning").getByRole("link")).toContainText("ابدأ الاختبار");
  await page.getByTestId("home-learning").getByRole("link").click();
  await page.waitForURL(new RegExp(`/lessons/${LESSON}/assessment`));
  await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

  // Answer everything correctly.
  for (let i = 0; i < 12; i++) {
    const card = page.locator("[data-question-id]");
    await expect(card).toBeVisible({ timeout: 60_000 });
    const key = await questionKey((await card.getAttribute("data-question-id"))!);
    await page.locator('[role="radiogroup"]').getByRole("radio").nth(key.correctIndex).click();
    await page.getByRole("button", { name: "تأكيد الإجابة" }).click();
    const next = page.getByRole("button", { name: /السؤال التالي|عرض نتيجة الدرس/ });
    await expect(next).toBeVisible({ timeout: 30_000 });
    const finishing = (await next.textContent())?.includes("عرض نتيجة الدرس");
    await next.click();
    if (finishing) break;
  }
  await page.waitForURL(/\/result/, { timeout: 60_000 });

  // Completion experience with real numbers.
  const completion = page.getByTestId("completion");
  await expect(completion.getByRole("heading", { name: /أحسنت/ })).toBeVisible();
  await expect(completion).toContainText("أتممت الدرس");
  await expect(completion).toContainText("أتقنتها");
  await expect(page.getByTestId("completion-streak")).toContainText("يوم واحد من التعلّم");
  await expect(page.getByTestId("completion-weekly")).toContainText("١ / ٢ دروس");
  await expect(page.getByTestId("completion-weekly")).toContainText("باقي لك درس واحد لتحقيق هدفك.");
  await expect(completion.getByRole("link", { name: "ابدأ الدرس التالي" })).toBeVisible();
  await expect(page.locator("[class*=confetti]")).toHaveCount(0);
  await noOverflow(page);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `e2e-artifacts/screens/${project}-completion.png`, fullPage: true });

  // Home reflects it, and a hard refresh keeps it.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    else await page.goto("/dashboard");
    await expect(page.getByTestId("streak-count")).toContainText("يوم واحد");
    await expect(page.getByTestId("weekly-goal")).toContainText("١ من درسان");
    await expect(page.getByTestId("mastery-counts")).toBeVisible();
    await noOverflow(page);
  }
  await page.screenshot({ path: `e2e-artifacts/screens/${project}-home-after.png`, fullPage: true });
});
