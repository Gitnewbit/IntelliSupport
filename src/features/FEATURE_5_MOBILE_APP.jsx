import React, { useState } from "react";

function MobileTechnicianMonitorPage({ sessions = [], technicians = [] }) {
  const activeSessions = (sessions || []).filter(s => !s.sessionEndTime);

  return (
    <div style={{ padding: "20px" }}>
      <h2>📱 Mobile Technician Monitoring</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--acc)" }}>{activeSessions.length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Clocked In</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--grn)" }}>{activeSessions.filter(s => s.isOnline).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Online</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--amb)" }}>{activeSessions.filter(s => !s.isOnline).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Offline</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--blue)" }}>{(technicians || []).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Total Techs</div>
        </div>
      </div>

      {activeSessions.length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Technician</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Status</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Battery</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map(session => {
                const tech = (technicians || []).find(t => t.id === session.technicianId);
                return (
                  <tr key={session.id} style={{ borderBottom: "1px solid var(--rim)" }}>
                    <td style={{ padding: "12px", fontSize: "12px" }}><strong>{tech?.name || "Unknown"}</strong></td>
                    <td style={{ padding: "12px", fontSize: "12px" }}><span style={{background: session.isOnline ? "rgba(46,204,138,.2)" : "rgba(240,160,48,.2)", color: session.isOnline ? "var(--grn)" : "var(--amb)", padding: "4px 8px", borderRadius: "4px"}}>{session.isOnline ? "🟢 Online" : "🟡 Offline"}</span></td>
                    <td style={{ padding: "12px", fontSize: "12px" }}>{session.batteryLevel}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No technicians clocked in right now.
        </div>
      )}
    </div>
  );
}

export { MobileTechnicianMonitorPage };
