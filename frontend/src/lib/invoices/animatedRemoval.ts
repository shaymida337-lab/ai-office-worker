export type RemoveRowAfterActionDeps = {
  performAction: () => Promise<void>;
  beginExitAnimation: () => void;
  waitForExitAnimation: () => Promise<void>;
  finalize: () => Promise<void> | void;
  endExitAnimation: () => void;
  reportError: (error: unknown) => void;
};

// סדר הפעולות הוא החוזה: קריאת ה-API חייבת להצליח לפני שהשורה מתחילה
// להיעלם מהמסך. כשה-API נכשל השורה נשארת במקומה והשגיאה מדווחת —
// אחרת המשתמש רואה "המסמך אושר ונעלם" בעוד שהשרת דחה את הפעולה.
export async function removeRowAfterAction(deps: RemoveRowAfterActionDeps): Promise<boolean> {
  try {
    await deps.performAction();
  } catch (error) {
    deps.reportError(error);
    return false;
  }
  deps.beginExitAnimation();
  try {
    await deps.waitForExitAnimation();
    await deps.finalize();
  } finally {
    deps.endExitAnimation();
  }
  return true;
}
