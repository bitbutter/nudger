type WelcomeProps = {
  onNewDocument: () => void;
  onOpenSettings: () => void;
  hasKey: boolean;
};

export function Welcome({ onNewDocument, onOpenSettings, hasKey }: WelcomeProps) {
  return (
    <main className="welcome">
      <div className="welcome-hero">
        <p className="eyebrow">Local-first writer’s board</p>
        <h1>nudger</h1>
        <p className="welcome-lede">
          Write in one big field. A row of virtual repliers reads as much of it as you choose and
          answers with the question, critique or next step you need. Nothing is written for you.
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={onNewDocument}>
            Start a document
          </button>
          <button type="button" className="btn" onClick={onOpenSettings}>
            {hasKey ? 'Provider settings' : 'Add your API key'}
          </button>
        </div>
      </div>

      <div className="welcome-steps">
        <article>
          <span className="step-number">1</span>
          <h2>Write</h2>
          <p>
            The editor autosaves to this browser. Place the cursor where a nudger should read:
            {' '}{'{{before_cursor}}'} sends only the text above it, while {'{{full_text}}'} sends
            everything.
          </p>
        </article>
        <article>
          <span className="step-number">2</span>
          <h2>Add nudgers</h2>
          <p>
            A completeness coach, a skeptical reviewer, a hiring manager, a devil’s advocate. Each
            card has its own prompt, model and reply history.
          </p>
        </article>
        <article>
          <span className="step-number">3</span>
          <h2>Attach files</h2>
          <p>
            Keep notes, a job posting or an outline with the document. Attach them to one nudger;
            other nudgers never see them unless you attach them too, and other documents never see
            them at all.
          </p>
        </article>
        <article>
          <span className="step-number">4</span>
          <h2>Preview, then run</h2>
          <p>
            The resolved prompt shows the exact text and files that will be sent. Only that request
            leaves this browser, and only to your provider.
          </p>
        </article>
      </div>

      <div className="welcome-footer">
        <p>
          <strong>Private by construction.</strong> No accounts, no backend, no analytics, no
          third-party scripts. Documents, versions, files, nudgers and settings live in IndexedDB.
          Your API key lives in sessionStorage unless you explicitly choose to remember it.
        </p>
        <p>
          nudger is a static page. It works from GitHub Pages, a local server or a file path. Export
          your data as JSON whenever you want a copy.
        </p>
      </div>
    </main>
  );
}
