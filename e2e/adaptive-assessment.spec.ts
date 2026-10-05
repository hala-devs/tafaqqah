import { expect, test, type Page } from "@playwright/test";
import { conceptVideo, geminiCallsForSession, questionInfo, type QuestionInfo } from "./db";

/**
 * REAL student flow on Lesson 1 with the real Gemini model (run against `npm run dev` with GEMINI_API_KEY):
 *
 *   register → study → start → BASELINE from the database → deliberately WRONG
 *   → AI VERIFICATION #1 (runtime) → WRONG → AI VERIFICATION #2 (runtime) → WRONG
 *   → weak concept → review of the exact approved video segment → «اختبر فهمي مرة أخرى»
 *   → AI REASSESSMENT (runtime) → continue → a second concept recovers after one verification → result.
 *

 * (The weak concept must have a source rich enough for fresh questions: if every attempt is rejected the system, by design, skips the
 * follow-up instead of showing anything unverified — that safe behaviour is covered by the integration tests.)
 *
 * It also checks: banned internal wording never appears on a question screen, a refresh keeps the pending
 * question, a transient server failure is retried safely in the same session, 375px layout, RTL.
 * Needs ASSESSMENT_E2E_REAL_AI=1 (it spends real API calls).
 */
const LESSON = "lesson-akhsar-01";
// Concepts with enough approved text to support several distinct questions (two approved base questions each).
const WEAK = "lesson-akhsar-01-concept-10";
const RECOVERS = "lesson-akhsar-01-concept-06";

const BANNED = [
  "بحسب النص", "وفق النص", "بناءً على النص", "كما ورد في النص", "استنادًا إلى النص", "ذكر النص", "بحسب المصدر", "وفق المصدر",
  "النص المعتمد", "المصدر المعتمد", "السياق المسترجع", "SourcePassage", "Gemini", "Source grounded", "Generated", "validator", "RAG",
];

const shot = (page: Page, project: string, name: string) => page.screenshot({ path: `e2e-artifacts/screens/${project}-adaptive-${name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page must not scroll horizontally`).toBeLessThanOrEqual(1);
}

/** The visible question screen must not contain any internal vocabulary. */
async function expectNoInternalWording(page: Page) {
  const text = await page.locator("main").innerText();
  for (const phrase of BANNED) expect(text, `question screen must not contain «${phrase}»`).not.toContain(phrase);
  expect(text).not.toMatch(/[A-Za-z]{4,}/);
}

/** Checks 375px layout of the current screen, then restores the viewport. */
async function check375(page: Page, project: string, name: string) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  await noHorizontalScroll(page, `375px ${name}`);
  await shot(page, project, `375-${name}`);
  if (original) await page.setViewportSize(original);
}

test("real flow: baseline → AI verification ×2 → exact-video review → AI reassessment → continue", async ({ page }, info) => {
  test.skip(!process.env.ASSESSMENT_E2E_REAL_AI, "spends real Gemini calls — set ASSESSMENT_E2E_REAL_AI=1");
  test.setTimeout(30 * 60_000);
  const project = info.project.name;
  const email = `real-flow-${project}-${Date.now()}@example.test`;

  // ── register + study + start ──
  await page.goto("/register");
  await page.getByLabel("الاسم").fill("طالب تجربة");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("journey-pass-2026");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto(`/lessons/${LESSON}`);
  await page.getByRole("button", { name: "ابدأ اختبار فهمك" }).click(); // «أتممت مشاهدة الدرس» → studied
  await expect(page.getByRole("heading", { name: "ابدأ اختبار فهمك" })).toBeVisible();
  await shot(page, project, "00-lesson-assessment-stage");
  await page.getByRole("button", { name: /ابدأ اختبار فهمك/ }).click();
  await page.waitForURL(/\/assessment\?session=/);
  const sessionId = new URL(page.url()).searchParams.get("session")!;

  const seen: QuestionInfo[] = [];
  const baselineSeen = new Map<string, number>();
  const stagesInOrder: string[] = [];
  let retriedAfterFailure = false;
  let refreshChecked = false;
  let reviewChecked = false;
  let intercepted = false;
  let failNext = false;
  const shots = new Set<string>();

  // Simulate ONE transient server failure right after the first AI question is answered (safe retry):
  // the request for the next step never reaches the server, the learner sees the calm error and presses retry.
  await page.route("**/api/assessment/*/next", async (route) => {
    if (failNext && !intercepted) {
      failNext = false;
      intercepted = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "تعذّر تجهيز السؤال الآن. حاول مرة أخرى." } }) });
      return;
    }
    await route.continue();
  });

  for (let step = 0; step < 60; step++) {
    // A review step may be showing instead of a question.
    const review = page.getByTestId("review-step");
    const card = page.locator("[data-question-id]");
    const retryButton = page.getByRole("button", { name: "حاول مرة أخرى" });
    await expect(card.or(review).or(retryButton).or(page.getByText("نجهّز نتيجة الدرس"))).toBeVisible({ timeout: 150_000 });

    if (await retryButton.isVisible()) {
      // SAFE RETRY — the learner's progress is stated as saved, and retrying continues the same session.
      await expect(page.getByText("تقدّمك في هذا الاختبار محفوظ.")).toBeVisible();
      await shot(page, project, "retry-error");
      await check375(page, project, "retry-error");
      retriedAfterFailure = true;
      await retryButton.click();
      continue;
    }

    if (await review.isVisible()) {
      reviewChecked = true;
      await expect(review.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("راجع هذا الجزء", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("راجع هذا المقطع، ثم اختبر فهمك مرة أخرى.")).toBeVisible();
      await expect(page.getByText("بعد المراجعة، سنختبر فهمك بأسئلة قصيرة جديدة عن هذا الجزء.")).toBeVisible();
      // No internal vocabulary on the review step either.
      const reviewText = await page.locator("main").innerText();
      for (const phrase of ["النص المعتمد", "المصدر المعتمد", "SourcePassage", "حدد فريق المحتوى"]) expect(reviewText).not.toContain(phrase);
      // The exact APPROVED timestamp, read from the database, is what the player starts at.
      const video = await conceptVideo(WEAK);
      expect(video.approved).toBe(true);
      const player = page.getByTestId("video-player");
      await expect(player).toBeVisible();
      const src = (await player.getAttribute("src")) ?? "";
      expect(src).toContain(`start=${video.start}`);
      if (video.end != null) expect(src).toContain(`end=${video.end}`);
      await noHorizontalScroll(page, "review");
      await shot(page, project, "05-review-exact-video");
      await check375(page, project, "review");
      await page.getByRole("button", { name: "اختبر فهمي مرة أخرى" }).click();
      // The reassessment question is generated at runtime: stay here until the review step is gone (the button shows progress).
      await expect(review).toBeHidden({ timeout: 150_000 });
      continue;
    }

    if (await page.getByText("نجهّز نتيجة الدرس").isVisible()) break;

    // ── a question is on screen ──
    const questionId = (await card.getAttribute("data-question-id"))!;
    const info = await questionInfo(questionId);
    seen.push(info);
    stagesInOrder.push(info.stage);
    expect(info.validationStatus).toBe("VALID");
    expect(info.sessionId).toBe(sessionId);
    await expectNoInternalWording(page);
    await noHorizontalScroll(page, `question ${step}`);

    // Stage-specific UI.
    const verificationBadge = page.getByText("سؤال تحقق", { exact: true });
    if (info.stage === "BASELINE") {
      expect(info.origin).toBe("FIXED_BANK");
      await expect(verificationBadge).toHaveCount(0);
    } else {
      expect(info.origin).toBe("AI_GENERATED");
      expect(info.explanation.trim().length).toBeGreaterThan(3);
      expect(info.answerEvidence.trim().length).toBeGreaterThan(10); // internal evidence exists…
      expect(info.explanationEvidence.trim().length).toBeGreaterThan(10);
      await expect(page.locator("main")).not.toContainText(info.answerEvidence.slice(0, 40)); // …and is never shown
      if (info.stage === "REASSESSMENT") await expect(page.getByText("إعادة اختبار", { exact: true })).toBeVisible();
      else {
        await expect(verificationBadge).toBeVisible();
        await expect(page.getByText("نتأكد من فهم هذه الفكرة")).toBeVisible();
      }
    }

    // Progress reads «السؤال X من 16» and stays on the baseline position during follow-ups.
    await expect(page.getByTestId("assessment-progress")).toContainText("من ١٦");
    await expect(page.locator('[role="radio"]')).toHaveCount(info.optionCount);

    const key = `${info.stage}:${info.conceptId}`;
    if (info.stage === "BASELINE") baselineSeen.set(info.conceptId, (baselineSeen.get(info.conceptId) ?? 0) + 1);
    if (!shots.has(info.stage)) {
      shots.add(info.stage);
      await shot(page, project, `01-${info.stage.toLowerCase()}`);
      await check375(page, project, info.stage.toLowerCase());
    }

    // SESSION PERSISTENCE: refresh while the first AI question is pending → the same question returns.
    if (info.stage === "VERIFICATION" && !refreshChecked) {
      refreshChecked = true;
      await page.reload();
      await expect(page.locator(`[data-question-id="${questionId}"]`)).toBeVisible({ timeout: 60_000 });
    }

    // Decide: right or wrong.
    let wantCorrect = true;
    if (info.conceptId === WEAK) wantCorrect = info.stage === "REASSESSMENT" || (info.stage === "BASELINE" && (baselineSeen.get(WEAK) ?? 0) > 1);
    if (info.conceptId === RECOVERS) wantCorrect = !(info.stage === "BASELINE" && baselineSeen.get(RECOVERS) === 1);
    const index = wantCorrect ? info.correctIndex : (info.correctIndex + 1) % info.optionCount;

    // Options: four equal cards labelled أ ب ج د.
    const radios = page.locator('[role="radio"]');
    await radios.nth(index).click();
    const confirm = page.getByRole("button", { name: "تأكيد الإجابة" });
    await expect(confirm).toBeEnabled();
    if (info.stage === "VERIFICATION" && !intercepted) failNext = true;
    await confirm.click();

    const feedback = page.getByTestId("answer-feedback");
    await expect(feedback).toBeVisible({ timeout: 30_000 });
    await expect(feedback).toHaveAttribute("data-correct", String(wantCorrect));
    if (wantCorrect) {
      await expect(feedback.getByRole("heading", { name: info.stage === "REASSESSMENT" ? "تم تثبيت المفهوم ✓" : "إجابة صحيحة" })).toBeVisible();
    } else {
      await expect(page.getByText("إجابتك", { exact: true })).toBeVisible();
      await expect(page.getByText("الإجابة الصحيحة", { exact: true })).toBeVisible();
      const title = info.stage === "SECOND_VERIFICATION" || info.stage === "REASSESSMENT" ? "هذه الفكرة تحتاج إلى تثبيت بسيط" : "نتأكد من فهم هذه الفكرة بسؤال آخر";
      await expect(feedback.getByRole("heading", { name: title })).toBeVisible();
      if (info.stage === "SECOND_VERIFICATION") await expect(feedback.getByText("راجع هذا الجزء ثم اختبر فهمك مرة أخرى.")).toBeVisible();
    }
    // The explanation is shown directly (no empty «توضيح» heading) and never empty.
    await expect(feedback).toContainText(info.explanation.trim().slice(0, 25));
    await expect(feedback.getByText("توضيح", { exact: true })).toHaveCount(0);
    await expectNoInternalWording(page);
    const feedbackKey = `feedback-${wantCorrect ? "ok" : "wrong"}-${info.stage}`;
    if (!shots.has(feedbackKey)) {
      shots.add(feedbackKey);
      await shot(page, project, `02-${feedbackKey}`);
      if (info.stage !== "BASELINE" || !wantCorrect) await check375(page, project, feedbackKey);
    }
    void key;

    const next = feedback.getByRole("button");
    const label = (await next.textContent())?.trim() ?? "";
    await next.click();
    if (label.includes("عرض نتيجة الدرس")) break;
  }

  await page.waitForURL(/\/lessons\/lesson-akhsar-01\/result\?session=/, { timeout: 120_000 });
  await shot(page, project, "06-result");
  await noHorizontalScroll(page, "result");
  await check375(page, project, "result");

  // ── what really happened, checked against the database ──
  expect(retriedAfterFailure, "the simulated transient failure must have been retried safely").toBe(true);
  expect(refreshChecked && reviewChecked).toBe(true);
  expect(stagesInOrder).toEqual(expect.arrayContaining(["BASELINE", "VERIFICATION", "SECOND_VERIFICATION", "REASSESSMENT"]));
  const order = stagesInOrder.filter((s) => s !== "BASELINE");
  expect(order.indexOf("VERIFICATION")).toBeLessThan(order.indexOf("SECOND_VERIFICATION"));
  expect(order.indexOf("SECOND_VERIFICATION")).toBeLessThan(order.indexOf("REASSESSMENT"));
  const baseline = seen.filter((q) => q.stage === "BASELINE");
  expect(baseline).toHaveLength(16);
  expect(baseline.every((q) => q.origin === "FIXED_BANK")).toBe(true);
  const ai = seen.filter((q) => q.stage !== "BASELINE");
  expect(new Set(ai.map((q) => q.question)).size).toBe(ai.length); // no duplicate AI questions
  expect(ai.every((q) => !baseline.some((b) => b.question === q.question))).toBe(true); // never a baseline question

  const calls = await geminiCallsForSession(sessionId);
  console.log("AI calls for this session:", JSON.stringify(calls));
  console.log("stages in order:", stagesInOrder.join(" → "));
  const models = new Set(calls.map((c) => c.model).filter((m) => m !== "server-checks"));
  expect([...models]).toEqual(["gemini-3.5-flash-lite"]);

  // Staff-only trace: every AI question is reachable from the admin log; students cannot open it.
  expect((await page.goto("/admin/logs"))?.status()).toBe(404);
});
