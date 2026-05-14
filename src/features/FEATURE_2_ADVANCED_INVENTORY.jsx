import React, { useState, useEffect } from "react";

const daysBetween = (dateStr) => {
  if (!dateStr) return 0;
  return Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
};

const fmtD = (d) => d ? new Date(d).toLocaleDateString() : "—";

const InventoryHelpers = {
  calculateFIFOCost: (warehouse, qty) => {
    let remaining = qty;
    let totalCost = 0;
    const queue = [...(warehouse.fifoQueue || [])];
    for (const item of queue) {
      if (remaining <= 0) break;
      const itemQty = Math.min(1, remaining);
      totalCost += itemQty * item.cost;
      remaining -= itemQty;
    }
    return totalCost;
  },

  calculateAging: (warehouse) => {
    return (warehouse.fifoQueue || []).map(item => ({
      serial: item.serial,
      ageInDays: daysBetween(item.receivedAt),
      cost: item.cost,
      receivedAt: item.receivedAt,
      supplier: item.supplier
    }));
  },

  isReorderNeeded: (part, warehouse) => {
    return warehouse.qty <= (part.reorderPoint || part.minQty * 2);
  },

  calculateInventoryValue: (part) => {
    return (part.warehouses || []).reduce((total, w) => {
      const value = w.qty * (part.costPerUnit || 0);
      return total + value;
    }, 0);
  },

  isSlowMoving: (part, tickets, days = 90) => {
    const recentUsage = (tickets || []).filter(
      t => t.parts?.some(p => p.partId === part.id) && daysBetween(t.createdAt) < days
    ).length;
    return recentUsage === 0;
  }
};

function AdvancedInventoryPage({ parts = [], tickets = [], warehouses = [] }) {
  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState(warehouses?.[0]?.id || "WH001");
  const [agingDetails, setAgingDetails] = useState(null);
  const [reorderList, setReorderList] = useState([]);

  useEffect(() => {
    const needsReorder = (parts || [])
      .map(part => {
        const warehouse = (part.warehouses || []).find(w => w.warehouseId === selectedWarehouse);
        if (!warehouse) return null;
        if (!InventoryHelpers.isReorderNeeded(part, warehouse)) return null;
        return { part, warehouse, supplier: part.suppliers?.[0] };
      })
      .filter(Boolean);
    setReorderList(needsReorder);
  }, [parts, selectedWarehouse]);

  const totalInventoryValue = (parts || []).reduce((s, p) => s + InventoryHelpers.calculateInventoryValue(p), 0);
  const slowMovingCount = (parts || []).filter(p => InventoryHelpers.isSlowMoving(p, tickets)).length;

  return (
    <div style={{ padding: "20px" }}>
      <h2>📦 Advanced Inventory Management</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--grn)" }}>{(parts || []).length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Total SKUs</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: "var(--acc)" }}>R{(totalInventoryValue / 1000).toFixed(0)}k</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Inventory Value</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: reorderList.length > 0 ? "var(--amb)" : "var(--grn)" }}>{reorderList.length}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Need Reorder</div>
        </div>
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "20px", fontWeight: "700", color: slowMovingCount > 0 ? "var(--amb)" : "var(--grn)" }}>{slowMovingCount}</div>
          <div style={{ fontSize: "12px", color: "var(--mu)", marginTop: "4px" }}>Slow Moving</div>
        </div>
      </div>

      <div style={{ marginBottom: "15px" }}>
        <label style={{ fontSize: "12px", color: "var(--mu)", display: "block", marginBottom: "6px" }}>Warehouse</label>
        <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid var(--rim)", background: "var(--s1)", color: "var(--tx)" }}>
          {warehouses.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {reorderList.length > 0 && (
        <div style={{ background: "rgba(240,160,48,.1)", border: "1px solid var(--amb)", borderRadius: "8px", padding: "12px", marginBottom: "15px" }}>
          <strong>⚠️ {reorderList.length} parts need reordering</strong>
        </div>
      )}

      {(parts || []).length > 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Part #</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Stock</th>
                <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid var(--rim)" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {(parts || []).map(part => {
                const warehouse = (part.warehouses || []).find(w => w.warehouseId === selectedWarehouse);
                if (!warehouse) return null;
                const value = warehouse.qty * (part.costPerUnit || 0);
                return (
                  <tr key={part.id} style={{ borderBottom: "1px solid var(--rim)" }}>
                    <td style={{ padding: "12px", fontSize: "12px" }}><strong>{part.partNo}</strong></td>
                    <td style={{ padding: "12px", fontSize: "12px" }}>{warehouse.qty}</td>
                    <td style={{ padding: "12px", fontSize: "12px", fontWeight: "600" }}>R{value.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: "8px", padding: "20px", textAlign: "center", color: "var(--mu)" }}>
          No inventory data available.
        </div>
      )}
    </div>
  );
}

export { InventoryHelpers, AdvancedInventoryPage };
