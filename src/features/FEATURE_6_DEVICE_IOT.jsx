import React, { useState } from "react";

function DeviceIoTIntegrationPage({ devices = [], deviceConnections = [], deviceMetrics = [] }) {
  const [selectedDevice, setSelectedDevice] = useState(null);

  const connectedDevices = (devices || []).filter(d => {
    const conn = (deviceConnections || []).find(c => c.deviceId === d.id);
    return conn?.connectionStatus === "connected";
  });

  const disconnectedDevices = (devices || []).filter(d => {
    const conn = (deviceConnections || []).find(c => c.deviceId === d.id);
    return !conn || conn.connectionStatus !== "connected";
  });

  return (
    <div style={{ padding: "20px" }}>
      <h2>🔌 Device IoT Integration</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--grn)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--grn)" }}>{connectedDevices.length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Connected</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--amb)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--amb)" }}>{disconnectedDevices.length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Disconnected</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--blue)" }}>{(devices || []).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Total Devices</div>
        </div>
      </div>

      {connectedDevices.length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Device</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Brand/Model</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Status</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {connectedDevices.map(device => {
                const conn = (deviceConnections || []).find(c => c.deviceId === device.id);
                return (
                  <tr key={device.id} style={{ borderBottom: "1px solid var(--rim)", cursor: "pointer" }} onClick={() => setSelectedDevice(device)}>
                    <td style={{ padding: "12px", fontSize: "12px" }}><strong>{device.name || device.id}</strong></td>
                    <td style={{ padding: "12px", fontSize: "12px" }}>{device.brand} {device.model}</td>
                    <td style={{ padding: "12px", fontSize: "12px" }}><span style={{background: "rgba(46,204,138,.2)", color: "var(--grn)", padding: "4px 8px", borderRadius: "4px"}}>🟢 Online</span></td>
                    <td style={{ padding: "12px", fontSize: "12px" }}>{device.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No connected devices found.
        </div>
      )}

      {selectedDevice && (
        <div style={{ position: "fixed", top: "0", left: "0", right: "0", bottom: "0", background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "1000" }} onClick={() => setSelectedDevice(null)}>
          <div style={{ background: "var(--s1)", borderRadius: "8px", maxWidth: "500px", width: "90%", padding: "20px" }} onClick={e => e.stopPropagation()}>
            <h3>{selectedDevice.brand} {selectedDevice.model}</h3>
            <p style={{ fontSize: "12px", color: "var(--mu)", marginBottom: "12px" }}>Type: {selectedDevice.type}</p>
            <div style={{ background: "var(--s2)", padding: "12px", borderRadius: "6px", marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span>Device ID:</span>
                <span style={{ fontFamily: "monospace" }}>{selectedDevice.id}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span>Status:</span>
                <span style={{ color: "var(--grn)" }}>Connected</span>
              </div>
            </div>
            <button onClick={() => setSelectedDevice(null)} style={{ background: "var(--blue)", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "4px", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { DeviceIoTIntegrationPage };
