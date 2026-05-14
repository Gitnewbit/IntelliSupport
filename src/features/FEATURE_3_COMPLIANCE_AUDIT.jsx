import React, { useState } from "react";

const fmt = (d) => d ? new Date(d).toLocaleString() : "—";

function ComplianceAuditTrailPage({ auditLog = [], users = [] }) {
  const [filters, setFilters] = useState({ action: "", entity: "", userId: "" });
  const [selectedLog, setSelectedLog] = useState(null);

  const filteredLogs = (auditLog || []).filter(log => {
    if (filters.action && log.action !== filters.action) return false;
    if (filters.entity && log.entity !== filters.entity) return false;
    if (filters.userId && log.userId !== filters.userId) return false;
    return true;
  });

  return (
    <div style={{ padding: "20px" }}>
      <h2>🔐 Compliance & Audit Trail</h2>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--acc)" }}>{(auditLog || []).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Total Actions</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--blue)" }}>{new Set((auditLog || []).map(l => l.userId)).size}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Active Users</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--red)" }}>{(auditLog || []).filter(l => l.action === "DELETE").length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Deletions</div>
        </div>
      </div>

      <div style={{ marginBottom: "15px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        <select value={filters.action} onChange={e => setFilters({...filters, action: e.target.value})} style={{ padding: "8px", borderRadius: "4px", border: "1px solid var(--rim)", background: "var(--s1)", color: "var(--tx)" }}>
          <option value="">All Actions</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
          <option value="READ">Read</option>
        </select>
        <select value={filters.entity} onChange={e => setFilters({...filters, entity: e.target.value})} style={{ padding: "8px", borderRadius: "4px", border: "1px solid var(--rim)", background: "var(--s1)", color: "var(--tx)" }}>
          <option value="">All Entities</option>
          <option value="tickets">Tickets</option>
          <option value="invoices">Invoices</option>
          <option value="users">Users</option>
          <option value="settings">Settings</option>
        </select>
      </div>

      {filteredLogs.length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Timestamp</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Action</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Entity</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Record ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.slice(0, 50).map(log => (
                <tr key={log.id} style={{ borderBottom: "1px solid var(--rim)" }}>
                  <td style={{ padding: "12px", fontSize: "11px" }}>{fmt(log.timestamp)}</td>
                  <td style={{ padding: "12px", fontSize: "12px" }}><span style={{background: log.action === "DELETE" ? "rgba(240,80,96,.2)" : "rgba(96,165,250,.2)", color: log.action === "DELETE" ? "var(--red)" : "var(--blue)", padding: "4px 8px", borderRadius: "4px"}}>{log.action}</span></td>
                  <td style={{ padding: "12px", fontSize: "12px" }}>{log.entity}</td>
                  <td style={{ padding: "12px", fontSize: "11px", fontFamily: "monospace" }}>{log.entityId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No audit logs found.
        </div>
      )}
    </div>
  );
}

export { ComplianceAuditTrailPage };
