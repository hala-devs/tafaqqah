import { expect, test } from "@playwright/test";

/** Pre/post measurement: a measured lesson starts with a pre-test before the material is shown. */
test("measured lesson: pre-test → study unlocked", async ({ page }, info) => {
  const email = `measure-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("الاسم").fill("متعلم");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("journey-pass-2026");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL("**/dashboard");

  // Studying lesson 1 unlocks the measured lesson 2.
  await page.goto("/lessons/lesson-method");
  await page.getByRole("button", { name: "أكملت دراسة الدرس" }).click();
  await expect(page.getByRole("heading", { name: "ابدأ اختبار فهمك" })).toBeVisible();

  await page.goto("/lessons/lesson-mastery");
  await expect(page.getByRole("heading", { name: "اختبار قبلي قصير" })).toBeVisible();
  await expect(page.getByLabel("نص الدرس المعتمد")).toHaveCount(0); // material hidden until the pre-test
  await page.screenshot({ path: `e2e-artifacts/screens/${info.project.name}-18-pretest.png`, fullPage: true });

  await page.getByRole("button", { name: /ابدأ الاختبار القبلي/ }).click();
  await page.waitForURL(/\/assessment\?session=/);
  await expect(page.getByText("الاختبار القبلي").first()).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.locator('[role="radiogroup"]').getByRole("radio").first().click();
    await page.getByRole("button", { name: "تأكيد الإجابة" }).click();
    const next = page.getByRole("button", { name: /السؤال التالي|عرض نتيجة الدرس/ });
    await expect(next).toBeVisible();
    // Measurement answers never show mastery changes.
    await expect(page.getByText("سُجّلت إجابتك لقياس أثر الدرس.")).toBeVisible();
    const done = (await next.textContent())?.includes("عرض نتيجة الدرس");
    await next.click();
    if (done) break;
  }
  await page.waitForURL(/\/result/);
  await expect(page.getByRole("heading", { name: "سُجّلت نتيجة الاختبار القبلي" })).toBeVisible();
  await page.screenshot({ path: `e2e-artifacts/screens/${info.project.name}-19-pretest-result.png`, fullPage: true });

  await page.getByRole("link", { name: /ابدأ دراسة الدرس/ }).click();
  await expect(page.getByLabel("نص الدرس المعتمد")).toBeVisible();
  await expect(page.getByRole("button", { name: "أكملت دراسة الدرس" })).toBeVisible();
});
