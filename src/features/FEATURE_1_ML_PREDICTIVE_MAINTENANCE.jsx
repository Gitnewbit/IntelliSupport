import React, { useState, useEffect } from "react";

// Helper function (from App.jsx)
const daysBetween = (dateStr) => {
  if (!dateStr) return 0;
  return Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
};

const fmtD = (d) => d ? new Date(d).toLocaleDateString() : "—";

// ML Helper Functions
const MLPredictor = {
  calculateFailureRisk: (device, deviceFailureHistory) => {
    if (!deviceFailureHistory || deviceFailureHistory.length === 0) return 0;
    const similarDeviceFailures = deviceFailureHistory.filter(
      f => f.deviceType === device.type && f.brand === device.brand
    );
    if (similarDeviceFailures.length === 0) return 0.1;
    let riskScore = 0;
    const ageInMonths = daysBetween(device.createdAt) / 30;
    if (ageInMonths > 60) riskScore += 0.3;
    else if (ageInMonths > 36) riskScore += 0.2;
    else if (ageInMonths > 24) riskScore += 0.1;
    const avgUsage = similarDeviceFailures.reduce((s, f) => s + (f.usagePerMonth || 0), 0) / similarDeviceFailures.length;
    const currentUsage = device.pagesOrCalls || 0;
    if (currentUsage > avgUsage * 1.2) riskScore += 0.25;
    else if (currentUsage > avgUsage) riskScore += 0.1;
    const daysSinceMaint = daysBetween(device.lastMaintenance || device.createdAt);
    if (daysSinceMaint > 180) riskScore += 0.3;
    else if (daysSinceMaint > 90) riskScore += 0.15;
    const failuresInLastYear = similarDeviceFailures.filter(
      f => daysBetween(f.failureDate) < 365
    ).length;
    if (failuresInLastYear > 3) riskScore += 0.2;
    else if (failuresInLastYear > 1) riskScore += 0.1;
    return Math.min(riskScore, 1);
  },

  predictNextFailure: (device, deviceFailureHistory) => {
    const similarFailures = deviceFailureHistory
      .filter(f => f.deviceType === device.type && f.brand === device.brand)
      .sort((a, b) => new Date(b.failureDate) - new Date(a.failureDate));
    if (similarFailures.length === 0) return null;
    const failureFreq = {};
    similarFailures.forEach(f => {
      failureFreq[f.failureType] = (failureFreq[f.failureType] || 0) + 1;
    });
    const mostLikelyFailure = Object.entries(failureFreq)
      .sort((a, b) => b[1] - a[1])[0];
    return {
      partName: mostLikelyFailure ? mostLikelyFailure[0] : "Unknown",
      confidence: mostLikelyFailure ? Math.min(mostLikelyFailure[1] / similarFailures.length, 1) : 0.3,
      historicalAverageDaysToFailure: similarFailures.length > 0
        ? similarFailures.reduce((s, f) => s + daysBetween(f.failureDate), 0) / similarFailures.length
        : 365
    };
  },

  predictFailureDate: (device, deviceFailureHistory) => {
    const prediction = MLPredictor.predictNextFailure(device, deviceFailureHistory);
    if (!prediction) return null;
    const riskScore = MLPredictor.calculateFailureRisk(device, deviceFailureHistory);
    const daysUntilFailure = Math.max(7, Math.round(prediction.historicalAverageDaysToFailure * (1 - riskScore)));
    const failureDate = new Date();
    failureDate.setDate(failureDate.getDate() + daysUntilFailure);
    return {
      predictedFailureDate: failureDate.toISOString(),
      daysUntilFailure: daysUntilFailure,
      confidence: riskScore,
      recommendedMaintenanceDate: new Date(new Date().getTime() + (daysUntilFailure - 14) * 24 * 60 * 60 * 1000).toISOString()
    };
  }
};

function PredictiveMaintenancePage({ devices = [], tickets = [], deviceFailures = [] }) {
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const newAlerts = (devices || [])
      .map(d => {
        const riskScore = MLPredictor.calculateFailureRisk(d, deviceFailures || []);
        const prediction = MLPredictor.predictFailureDate(d, deviceFailures || []);
        return {
          deviceId: d.id,
          deviceName: `${d.brand || "?"} ${d.model || "?"}`,
          clientName: d.clientId,
          riskLevel: riskScore > 0.7 ? "Critical" : riskScore > 0.4 ? "High" : "Medium",
          riskScore: riskScore,
          prediction: prediction,
          device: d
        };
      })
      .filter(a => a.riskScore > 0.3)
      .sort((a, b) => b.riskScore - a.riskScore);
    setAlerts(newAlerts);
  }, [devices, deviceFailures]);

  return (
    <div style={{ padding: "20px" }}>
      <h2>🔮 ML Predictive Maintenance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--red)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--red)" }}>{alerts.filter(a => a.riskLevel === "Critical").length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Critical Risk</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--amb)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--amb)" }}>{alerts.filter(a => a.riskLevel === "High").length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>High Risk</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--blue)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--blue)" }}>{alerts.filter(a => a.riskLevel === "Medium").length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Medium Risk</div>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Device</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Risk</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Pred. Failure</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Days</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(alert => (
                <tr key={alert.deviceId} style={{ borderBottom: "1px solid var(--rim)" }}>
                  <td style={{ padding: "12px", fontSize: "12px" }}><strong>{alert.deviceName}</strong></td>
                  <td style={{ padding: "12px", fontSize: "12px" }}><span style={{background: alert.riskLevel === "Critical" ? "rgba(240,80,96,.2)" : "rgba(240,160,48,.2)", color: alert.riskLevel === "Critical" ? "var(--red)" : "var(--amb)", padding: "4px 8px", borderRadius: "4px"}}>{alert.riskLevel}</span></td>
                  <td style={{ padding: "12px", fontSize: "12px" }}>{fmtD(alert.prediction?.predictedFailureDate)}</td>
                  <td style={{ padding: "12px", fontSize: "12px", fontWeight: "600" }}>{alert.prediction?.daysUntilFailure}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No devices with risk detected. All devices are healthy!
        </div>
      )}
    </div>
  );
}

export { MLPredictor, PredictiveMaintenancePage };
