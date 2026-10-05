import { expect, test } from "@playwright/test";

test("admin bulk approval approves every Lesson 1 passage and timestamp", async ({ page }) => {
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "ADMIN_EMAIL/ADMIN_PASSWORD not set");

  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/admin");

  await page.goto("/admin/lessons/lesson-akhsar-01");
  const submit = page.getByRole("button", { name: "اعتماد جميع المقاطع والتوقيتات" });
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(page.getByText("اعتمدت المقاطع والتوقيتات بعد المراجعة البشرية.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("حالة اعتماد الدرس")).toContainText("المقاطع المعتمدة ١٢/١٢");
  await expect(page.getByLabel("حالة اعتماد الدرس")).toContainText("التوقيتات المعتمدة ١٢/١٢");
  await expect(page.getByText("المقاطع معتمدة")).toHaveCount(12);
  await expect(page.getByText("توقيت المراجعة معتمد")).toHaveCount(12);
});
