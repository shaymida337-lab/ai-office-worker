"use client";

export function VideoHelpBlock({ videoUrl }: { videoUrl?: string | null }) {
  return (
    <section className="page-help-section">
      <h3>צפה בסרטון הדרכה</h3>
      {videoUrl ? (
        <div className="page-help-video">
          <iframe
            src={videoUrl}
            title="סרטון הדרכה"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="page-help-video-placeholder">סרטון הדרכה יתווסף כאן</div>
      )}
    </section>
  );
}
