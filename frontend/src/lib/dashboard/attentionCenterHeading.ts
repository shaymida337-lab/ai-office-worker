export type AttentionCenterHeading = {
  title: string;
  subtitle: string | null;
};

export function buildAttentionCenterHeading(urgentCount: number): AttentionCenterHeading {
  if (urgentCount <= 0) {
    return {
      title: "הכל מסודר",
      subtitle: "אין דברים דחופים שמחכים לך כרגע",
    };
  }

  if (urgentCount === 1) {
    return {
      title: "יש משימה אחת חשובה",
      subtitle: "זה הדבר שכדאי לסגור קודם",
    };
  }

  return {
    title: `יש ${urgentCount} דברים שמחכים לטיפול`,
    subtitle: "אלה הדברים שכדאי לסגור קודם",
  };
}
