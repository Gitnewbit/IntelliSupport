import React, { useState } from "react";

const fmt = (d) => d ? new Date(d).toLocaleString() : "—";

function EmailIntegrationPage({ emailHistory = [], emailSettings = {} }) {
  const [selectedEmail, setSelectedEmail] = useState(null);

  return (
    <div style={{ padding: "20px" }}>
      <h2>📧 Email Integration</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--acc)" }}>{(emailHistory || []).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Emails Received</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: emailSettings.autoResponseEnabled ? "var(--grn)" : "var(--mu)" }}>
            {emailSettings.autoResponseEnabled ? "ON" : "OFF"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Auto-Response</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--blue)" }}>
            {emailSettings.incomingEmailAddress ? "✓" : "✕"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Email Configured</div>
        </div>
      </div>

      {(emailHistory || []).length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>From</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Subject</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Status</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {(emailHistory || []).slice(0, 50).map(email => (
                <tr key={email.id} style={{ borderBottom: "1px solid var(--rim)", cursor: "pointer" }} onClick={() => setSelectedEmail(email)}>
                  <td style={{ padding: "12px", fontSize: "12px" }}><strong>{email.fromName}</strong></td>
                  <td style={{ padding: "12px", fontSize: "12px" }}>{email.subject}</td>
                  <td style={{ padding: "12px", fontSize: "12px" }}><span style={{background: email.status === "processed" ? "rgba(46,204,138,.2)" : "rgba(96,165,250,.2)", color: email.status === "processed" ? "var(--grn)" : "var(--blue)", padding: "4px 8px", borderRadius: "4px"}}>{email.status}</span></td>
                  <td style={{ padding: "12px", fontSize: "11px" }}>{fmt(email.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No emails received yet.
        </div>
      )}

      {selectedEmail && (
        <div style={{ position: "fixed", top: "0", left: "0", right: "0", bottom: "0", background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "1000" }} onClick={() => setSelectedEmail(null)}>
          <div style={{ background: "var(--s1)", borderRadius: "8px", maxWidth: "600px", width: "90%", maxHeight: "80vh", overflow: "auto", padding: "20px" }} onClick={e => e.stopPropagation()}>
            <h3>{selectedEmail.subject}</h3>
            <p style={{ fontSize: "12px", color: "var(--mu)", marginBottom: "12px" }}>From: {selectedEmail.fromName} &lt;{selectedEmail.fromAddress}&gt;</p>
            <div style={{ background: "var(--s2)", padding: "12px", borderRadius: "6px", fontSize: "12px", marginBottom: "12px", maxHeight: "300px", overflow: "auto" }}>
              {selectedEmail.bodyText}
            </div>
            <button onClick={() => setSelectedEmail(null)} style={{ background: "var(--blue)", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "4px", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { EmailIntegrationPage };
