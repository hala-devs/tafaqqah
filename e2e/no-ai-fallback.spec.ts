import { expect, test } from "@playwright/test";

/**
 * Run against a server WITHOUT a configured AI provider (e.g. a production build with
 * AI_PROVIDER=mock, which is refused in production):
 *   E2E_EXPECT_NO_AI=1 E2E_BASE_URL=http://localhost:3211 npx playwright test e2e/no-ai-fallback.spec.ts
 *
 * The base assessment is the human-approved bank and never needs a model, so it still works.
 * A wrong answer must NOT produce a fabricated or fixed "verification" question: the assessment simply continues.
 */
test("the base assessment works without an AI provider and never fabricates a follow-up", async ({ page }, info) => {
  test.skip(!process.env.E2E_EXPECT_NO_AI, "requires a server without AI configuration");
  const email = `noai-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("الاسم").fill("متعلم");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("journey-pass-2026");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/lessons/lesson-method");
  await page.getByRole("button", { name: "أكملت دراسة الدرس" }).click();
  await page.getByRole("button", { name: /ابدأ اختبار فهمك/ }).click();
  await page.waitForURL(/\/assessment\?session=/);

  for (let i = 0; i < 12; i++) {
    const group = page.locator('[role="radiogroup"]');
    await expect(group).toBeVisible();
    await expect(page.getByText("سؤال تحقق", { exact: true })).toHaveCount(0);
    // Always pick the first option: some answers are wrong, none may trigger a generated question.
    await group.getByRole("radio").first().click();
    await page.getByRole("button", { name: "تأكيد الإجابة" }).click();
    const next = page.getByRole("button", { name: /السؤال التالي|عرض نتيجة الدرس|تابع|راجع هذا الجزء/ });
    await expect(next).toBeVisible();
    const done = (await next.textContent())?.includes("عرض نتيجة الدرس");
    await next.click();
    if (done) break;
  }
  await page.waitForURL(/\/result/);
});
