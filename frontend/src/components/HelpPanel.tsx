"use client";

import type { PageHelpContent } from "@/config/helpContent";
import { VideoHelpBlock } from "@/components/VideoHelpBlock";
import { VoiceGuideButton } from "@/components/VoiceGuideButton";

export function HelpPanel({
  content,
  open,
  onClose,
  onStartWalkthrough,
}: {
  content: PageHelpContent;
  open: boolean;
  onClose: () => void;
  onStartWalkthrough: () => void;
}) {
  if (!open) return null;

  return (
    <div className="page-help-overlay" role="dialog" aria-modal="true" aria-labelledby="page-help-title" onClick={onClose}>
      <aside className="page-help-panel" onClick={(event) => event.stopPropagation()}>
        <header className="page-help-header">
          <div>
            <div className="page-kicker">עזרה והדרכה</div>
            <h2 id="page-help-title">איך משתמשים בדף הזה?</h2>
            <p>{content.title}</p>
          </div>
          <button type="button" className="help-close" onClick={onClose} aria-label="סגור עזרה">×</button>
        </header>

        <div className="page-help-body">
          <section className="page-help-section">
            <h3>הסבר קצר</h3>
            <p>{content.description}</p>
            <h3>מה עושים כאן?</h3>
            <p>{content.usedFor}</p>
          </section>

          <section className="page-help-section">
            <h3>מה לעשות קודם?</h3>
            <ol>
              {content.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>

          <section className="page-help-section">
            <h3>כפתורים בדף</h3>
            <div className="page-help-button-list">
              {content.buttons.map((button) => (
                <div key={button.label} className="page-help-button-row">
                  <strong>{button.label}</strong>
                  <span>{button.explanation}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="page-help-section">
            <h3>טעויות נפוצות</h3>
            <ul>{content.commonMistakes.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          <section className="page-help-section">
            <h3>אם משהו לא עובד</h3>
            <ul>{content.troubleshooting.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          <VideoHelpBlock videoUrl={content.videoUrl} />

          <section className="page-help-section">
            <h3>הסבר קולי</h3>
            <VoiceGuideButton text={content.voiceText} />
          </section>

          <section className="page-help-section">
            <h3>הדרכה מודרכת</h3>
            <p>המערכת תסמן לך על המסך איפה ללחוץ ומה לבדוק.</p>
            <button type="button" className="btn" onClick={onStartWalkthrough}>התחל הדרכה</button>
          </section>

          <section className="page-help-section">
            <h3>תמיכה</h3>
            <p>{content.supportNote}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
