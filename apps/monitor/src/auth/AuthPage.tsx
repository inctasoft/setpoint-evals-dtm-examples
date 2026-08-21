export function AuthPage() {
  return (
    <div class="auth-page">
      <div class="auth-container">
        <div class="auth-header">
          <h1>DTM Monitor</h1>
          <p>Sign in to continue</p>
        </div>
        <div id="supertokens-root" />
      </div>
      <style>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0d1117;
        }
        .auth-container {
          width: 100%;
          max-width: 420px;
          padding: 24px;
        }
        .auth-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .auth-header h1 {
          font-size: 24px;
          margin: 0 0 8px;
          color: #c9d1d9;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .auth-header p {
          color: #8b949e;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
