import React, { useState, useMemo, useRef, useEffect } from "react";

import { fbAuth } from "./firebase";
import { FS } from "./firestoreService";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";

// ─── CONSTANTS ────────────────────────────────────────────────
const ROLES = { MANAGER:"manager", CONTROLLER:"controller", TECHNICIAN:"technician" };
const TICKET_TYPES = ["IT","Copier","CCTV","PABX"];
const STATUSES = ["Open","Assigned","Accepted","In Progress","Parts Pending","Parts Arrived","Workshop","Escalated","Resolved","Closed"];
const SLA_TIERS = ["Bronze","Silver","Gold","Platinum"];
const INIT_SLA = {
  Bronze:  {color:"#cd7f32",bg:"rgba(205,127,50,.15)",  respH:48,  resH:120},
  Silver:  {color:"#aaaaaa",bg:"rgba(170,170,170,.12)", respH:24,  resH:72 },
  Gold:    {color:"#f5c518",bg:"rgba(245,197,24,.15)",  respH:8,   resH:24 },
  Platinum:{color:"#a78bfa",bg:"rgba(167,139,250,.15)", respH:4,   resH:8  },
};
const CATS = {
  IT:["Hardware","Software","Network","Access","Security","Other"],
  Copier:["Paper Jam","Print Quality","Toner/Ink","Error Code","Drum","Fuser","Maintenance","Other"],
  CCTV:["Camera Offline","Recording Issue","Cable Fault","NVR/DVR","Power","Other"],
  PABX:["No Dial Tone","Call Dropping","Extension Issue","Voicemail","Line Fault","Other"],
};
const PRIS = {
  IT:["Critical","High","Medium","Low"],
  Copier:["Urgent","High","Normal","Low"],
  CCTV:["Critical","High","Normal","Low"],
  PABX:["Critical","High","Normal","Low"],
};
const CONSUMABLES = ["Drum Unit","Toner (Black)","Toner (Cyan)","Toner (Magenta)","Toner (Yellow)","Fuser Unit","Transfer Belt","Waste Toner Box","Feed Roller"];
const CON_CAP = {"Drum Unit":30000,"Toner (Black)":6000,"Toner (Cyan)":5000,"Toner (Magenta)":5000,"Toner (Yellow)":5000,"Fuser Unit":150000,"Transfer Belt":100000,"Waste Toner Box":50000,"Feed Roller":50000};
const CON_MIN_PCT = {"Drum Unit":0.70,"Toner (Black)":0.60,"Toner (Cyan)":0.60,"Toner (Magenta)":0.60,"Toner (Yellow)":0.60,"Fuser Unit":0.80,"Transfer Belt":0.80,"Waste Toner Box":0.85,"Feed Roller":0.70};
const TYPE_C = {IT:"#60a5fa",Copier:"#fb923c",CCTV:"#34d399",PABX:"#e879f9"};
const TYPE_I = {IT:"💻",Copier:"🖨️",CCTV:"📷",PABX:"☎️"};
const STA_C  = {"Open":"#60a5fa","Assigned":"#a78bfa","Accepted":"#2ecc8a","In Progress":"#c084fc","Parts Pending":"#fb923c","Parts Arrived":"#fbbf24","Workshop":"#e879f9","Escalated":"#f05060","Resolved":"#34d399","Closed":"#6b7280"};
const PRI_C  = {Critical:"#f05060",Urgent:"#f05060",High:"#fb923c",Normal:"#f5c518",Medium:"#f5c518",Low:"#34d399"};
const AV_COLS= ["#6c63ff","#60a5fa","#fb923c","#34d399","#e879f9","#f5c518","#f05060","#2dd4a0","#a78bfa","#4ecdc4"];
const TECH_SPECS = ["IT Support","Copier/Printers","CCTV","PABX","Networking","All-round"];

// ─── HELPERS ──────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,8);

// ════ ANALYTICS & PHOTO HELPERS ════
const getPaymentAnalytics = (invoices) => {const total = invoices.reduce((s, i) => s + i.total, 0); const paid = invoices.filter(i => i.status === "Paid").reduce((s, i) => s + i.total, 0); const unpaid = total - paid; const avg = invoices.length > 0 ? total / invoices.length : 0; return {total, paid, unpaid, avg, count: invoices.length};};

const getRevenueTrends = (invoices) => {const trends = {weekly: {}, monthly: {}, yearly: {}}; invoices.forEach(inv => {const d = new Date(inv.createdAt); const week = `W${Math.ceil(d.getDate()/7)}-${d.getMonth()+1}`; const month = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const year = d.getFullYear(); trends.weekly[week] = (trends.weekly[week] || 0) + inv.total; trends.monthly[month] = (trends.monthly[month] || 0) + inv.total; trends.yearly[year] = (trends.yearly[year] || 0) + inv.total;}); return trends;};

const getCostAnalysis = (tickets, clients, devices, parts) => {const analysis = {}; tickets.forEach(t => {const clientName = clients.find(c => c.id === t.clientId)?.name || 'Unknown'; const deviceId = t.deviceId; const key = `${clientName}`; if (!analysis[key]) analysis[key] = {client: clientName, cost: 0, tickets: 0, labour: 0}; analysis[key].labour += (t.labourHours || 0) * 950; analysis[key].cost += (t.labourHours || 0) * 950; t.parts?.forEach(p => {const part = parts.find(x => x.id === p.partId); if (part) analysis[key].cost += (p.qty || 1) * (part.cost || 50);}); analysis[key].tickets++;}); return Object.values(analysis);};

const getTechnicianMetrics = (tickets, users) => {const metrics = {}; tickets.forEach(t => {if (!t.techId) return; if (!metrics[t.techId]) metrics[t.techId] = {name: users.find(u => u.id === t.techId)?.name || 'Unknown', completed: 0, inProgress: 0, avgTime: 0, totalHours: 0}; if (['Resolved', 'Closed'].includes(t.status)) metrics[t.techId].completed++; else if (t.status !== 'Open') metrics[t.techId].inProgress++; metrics[t.techId].totalHours += t.labourHours || 0;}); Object.keys(metrics).forEach(k => {if (metrics[k].completed > 0) metrics[k].avgTime = (metrics[k].totalHours / metrics[k].completed).toFixed(1);}); return Object.values(metrics);};

const getPartsInventoryCost = (parts) => {return parts.reduce((s, p) => s + ((p.cost || 50) * (p.stock || 0)), 0);};

const getProfitabilityPerService = (tickets, invoices) => {const profitability = {}; tickets.forEach(t => {const serviceType = t.serviceType || 'General Service'; if (!profitability[serviceType]) profitability[serviceType] = {type: serviceType, revenue: 0, cost: 0, tickets: 0}; const inv = invoices.find(i => i.ticketId === t.id); if (inv) profitability[serviceType].revenue += inv.total; profitability[serviceType].cost += (t.labourHours || 0) * 950; profitability[serviceType].tickets++;}); Object.keys(profitability).forEach(k => {profitability[k].profit = profitability[k].revenue - profitability[k].cost; profitability[k].margin = profitability[k].revenue > 0 ? (profitability[k].profit / profitability[k].revenue * 100).toFixed(2) : 0;}); return Object.values(profitability);};

const generateTicketId = () => {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const dy = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yr}${mo}${dy}`;
  // Use millisecond timestamp + random to guarantee uniqueness
  const ms = Date.now().toString(36).toUpperCase().slice(-3);
  const r1 = Math.random().toString(36).slice(2, 5).toUpperCase();
  const r2 = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `TK${dateStr}${ms}${r1}${r2}`.replace(/[^A-Z0-9]/g, "").slice(0, 16);
};

const nowISO = () => new Date().toISOString();
const fmt = iso => { if(!iso) return "—"; const d=new Date(iso); return d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"}); };
const fmtD = iso => { if(!iso) return "—"; return new Date(iso).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"}); };
const daysBetween = (a,b=nowISO()) => Math.max(0,Math.round((new Date(b)-new Date(a))/86400000));
const hoursSince = a => ((Date.now()-new Date(a))/3600000).toFixed(1);
const fmtR = n => "R "+Number(n||0).toLocaleString("en-ZA",{minimumFractionDigits:2});
const checkEarly = (name,cur,cap) => { const m=CON_MIN_PCT[name]; if(!m) return null; const p=cur/cap; return p<m?{pct:Math.round(p*100),minPct:Math.round(m*100)}:null; };

// ─── CSS ──────────────────────────────────────────────────────
const injectCSS = () => {
  if(document.getElementById("is-css")) return;
  const style = document.createElement("style");
  style.id = "is-css";
  style.textContent = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%;background:#0b0c11}
    :root{--bg:#0b0c11;--s1:#111218;--s2:#181920;--s3:#1f2028;--s4:#262730;--rim:rgba(255,255,255,.06);--rim2:rgba(255,255,255,.11);--tx:#e0e2f0;--mu:#484a68;--mu2:#7879a0;--acc:#00c2ff;--accg:rgba(0,194,255,.18);--grn:#2ecc8a;--red:#f05060;--amb:#f0a030;--pur:#c084fc;--blue:#60a5fa}
    body{color:var(--tx);font-family:'Inter',sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
    button,input,select,textarea{font-family:'Inter',sans-serif}
    ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:var(--s4);border-radius:4px}
    .shell{display:flex;height:100vh;overflow:hidden}
    .sb{width:218px;min-width:218px;background:var(--s1);border-right:1px solid var(--rim);display:flex;flex-direction:column;transition:transform .25s;z-index:50}
    .sb-brand{padding:15px 13px 11px;border-bottom:1px solid var(--rim);display:flex;align-items:center;gap:10px}
    .logo-box{width:36px;height:36px;min-width:36px;border-radius:10px;background:linear-gradient(135deg,#00c2ff,#0044ff);display:flex;align-items:center;justify-content:center;box-shadow:0 0 18px var(--accg);flex-shrink:0}
    .sb-wm-name{font-size:14px;font-weight:800;letter-spacing:-.3px}
    .sb-wm-name em{color:var(--acc);font-style:normal}
    .sb-wm-tag{font-size:9px;color:var(--mu);letter-spacing:.4px;text-transform:uppercase}
    .sb-user{margin:8px 9px;background:var(--s2);border:1px solid var(--rim);border-radius:8px;padding:9px 10px;display:flex;align-items:center;gap:8px}
    .sb-uname{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sb-nav{padding:5px 7px;flex:1;overflow-y:auto}
    .sg-lbl{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--mu);padding:9px 8px 4px}
    .ni{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:none;background:transparent;color:var(--mu2);font-size:13px;font-weight:500;width:100%;text-align:left;cursor:pointer;transition:all .12s;-webkit-tap-highlight-color:transparent}
    .ni:hover{background:var(--s2);color:var(--tx)}
    .ni.on{background:rgba(0,194,255,.1);color:var(--acc);font-weight:600;border-left:2px solid var(--acc)}
    .ni-ic{width:18px;text-align:center;flex-shrink:0}
    .nbdg{margin-left:auto;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;font-family:'JetBrains Mono',monospace;min-width:18px;text-align:center}
    .sb-foot{padding:10px 12px;border-top:1px solid var(--rim);display:flex;justify-content:space-between;align-items:center}
    .logout-btn{font-size:11px;color:var(--mu);background:transparent;border:none;cursor:pointer;padding:4px 8px;border-radius:5px}
    .logout-btn:hover{color:var(--red)}
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
    .topbar{padding:12px 18px;border-bottom:1px solid var(--rim);display:flex;align-items:center;justify-content:space-between;background:rgba(11,12,17,.94);backdrop-filter:blur(12px);flex-shrink:0;z-index:20}
    .topbar-l{display:flex;align-items:center;gap:10px}
    .topbar h1{font-size:16px;font-weight:700}
    .topbar-r{display:flex;gap:8px;align-items:center}
    .hamburger{display:none;width:34px;height:34px;border-radius:8px;border:1px solid var(--rim);background:transparent;color:var(--mu2);font-size:18px;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
    .content{flex:1;overflow-y:auto;padding:16px 18px}
    .sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:49}
    .bell-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--rim);background:transparent;color:var(--mu2);font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;transition:all .12s}
    .bell-dot{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--red);border:2px solid var(--bg);animation:pulse 1.5s ease infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .notif-panel{position:absolute;top:42px;right:0;width:300px;background:var(--s2);border:1px solid var(--rim2);border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.6);z-index:600;overflow:hidden;max-height:70vh;overflow-y:auto}
    .np-hd{padding:11px 14px;border-bottom:1px solid var(--rim);font-size:12px;font-weight:700;display:flex;justify-content:space-between;position:sticky;top:0;background:var(--s2)}
    .np-item{padding:10px 14px;border-bottom:1px solid var(--rim);display:flex;gap:9px}
    .np-item.unr{background:rgba(0,194,255,.06)}
    .np-item:last-child{border-bottom:none}
    .np-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:5px}
    .np-msg{font-size:12px;line-height:1.4}
    .np-ts{font-size:10px;color:var(--mu);margin-top:2px;font-family:'JetBrains Mono',monospace}
    .sg{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:14px}
    .sc{background:var(--s1);border:1px solid var(--rim);border-radius:10px;padding:12px 13px;cursor:pointer;transition:all .2s}
    .sc:hover{border-color:var(--acc);background:var(--s2)}
    .sc-n{font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1}
    .sc-l{font-size:10px;color:var(--mu);text-transform:uppercase;letter-spacing:.4px;margin-top:3px}
    .sc-s{font-size:11px;color:var(--mu2);margin-top:2px}
    .tw{overflow-x:auto;border:1px solid var(--rim);border-radius:10px;background:var(--s1);-webkit-overflow-scrolling:touch}
    table{width:100%;border-collapse:collapse;min-width:500px}
    thead th{text-align:left;padding:8px 11px;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--mu);border-bottom:1px solid var(--rim);white-space:nowrap;background:var(--s2)}
    tbody tr{border-bottom:1px solid var(--rim);transition:background .1s;cursor:pointer}
    tbody tr:last-child{border-bottom:none}
    tbody tr:hover{background:var(--s2)}
    td{padding:10px 11px;font-size:13px;vertical-align:middle}
    .mono{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mu)}
    .tt{font-weight:600}.tsub{font-size:11px;color:var(--mu);margin-top:1px}
    .mcard{background:var(--s1);border:1px solid var(--rim);border-radius:10px;padding:13px 14px;margin-bottom:8px;cursor:pointer;transition:all .12s}
    .mcard:active{background:var(--s2)}
    .mcard-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}
    .mcard-title{font-weight:700;font-size:14px;flex:1;margin-right:8px}
    .mcard-sub{font-size:11px;color:var(--mu);margin-top:2px}
    .mcard-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px solid var(--rim);font-size:12px}
    .bdg{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;line-height:1.4}
    .bdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
    .slabdg{display:inline-flex;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700}
    .typbdg{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:600}
    .rolbdg{display:inline-flex;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;text-transform:capitalize}
    .cb-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(240,80,96,.15);color:#ff6b6b;white-space:nowrap}
    .frow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
    .sw{position:relative;min-width:130px;flex:1;max-width:220px}
    .sic{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--mu);pointer-events:none;font-size:12px}
    .sinp{width:100%;padding:8px 9px 8px 26px;background:var(--s1);border:1px solid var(--rim);border-radius:8px;color:var(--tx);font-size:13px;outline:none;transition:border .12s}
    .sinp:focus{border-color:var(--acc)}.sinp::placeholder{color:var(--mu)}
    .fsl{padding:8px 10px;background:var(--s1);border:1px solid var(--rim);border-radius:8px;color:var(--tx);font-size:13px;outline:none;cursor:pointer}
    .fsl:focus{border-color:var(--acc)}.fsl option{background:#181920}
    .btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;transition:all .12s;display:inline-flex;align-items:center;gap:5px;line-height:1;white-space:nowrap;-webkit-tap-highlight-color:transparent}
    .btn:disabled{opacity:.4;cursor:not-allowed}.btn:active:not(:disabled){transform:scale(.97)}
    .bp{background:linear-gradient(135deg,#00c2ff,#0044ff);color:#fff;box-shadow:0 0 16px var(--accg)}.bp:hover:not(:disabled){filter:brightness(1.1)}
    .bg2{background:transparent;color:var(--mu2);border:1px solid var(--rim)}.bg2:hover:not(:disabled){background:var(--s2);color:var(--tx)}
    .bd{background:rgba(240,80,96,.1);color:var(--red);border:1px solid rgba(240,80,96,.2)}.bd:hover:not(:disabled){background:rgba(240,80,96,.18)}
    .bgrn{background:rgba(46,204,138,.1);color:var(--grn);border:1px solid rgba(46,204,138,.2)}.bgrn:hover:not(:disabled){background:rgba(46,204,138,.18)}
    .bamb{background:rgba(240,160,48,.1);color:var(--amb);border:1px solid rgba(240,160,48,.2)}.bamb:hover:not(:disabled){background:rgba(240,160,48,.18)}
    .bpur{background:rgba(192,132,252,.1);color:var(--pur);border:1px solid rgba(192,132,252,.2)}.bpur:hover:not(:disabled){background:rgba(192,132,252,.18)}
    .bsm{padding:5px 11px;font-size:12px}.bxs{padding:3px 8px;font-size:11px}
    .btn-full{width:100%;justify-content:center;padding:12px}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(4px);z-index:400;display:flex;align-items:center;justify-content:center;padding:12px;overflow-y:auto}
    .modal{background:var(--s1);border:1px solid var(--rim2);border-radius:14px;width:100%;max-width:680px;max-height:90vh;overflow-y:auto;box-shadow:0 28px 80px rgba(0,0,0,.8);animation:su .16s ease}
    .modal.sm{max-width:440px}
    @keyframes su{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    .mhdr{padding:15px 18px 11px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--rim)}
    .mhdr-t{font-size:15px;font-weight:700}.mhdr-s{font-size:11px;color:var(--mu);font-family:'JetBrains Mono',monospace;margin-top:2px}
    .xcls{width:28px;height:28px;border-radius:7px;border:1px solid var(--rim);background:transparent;color:var(--mu);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
    .xcls:hover{background:var(--s2);color:var(--tx)}
    .mbody{padding:15px 18px;display:flex;flex-direction:column;gap:12px}
    .mfoot{padding:12px 18px;border-top:1px solid var(--rim);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    .fi{display:flex;flex-direction:column;gap:5px}
    .fr2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .fr3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
    label{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--mu)}
    .inp,.ta,.sel{padding:9px 11px;background:var(--s2);border:1px solid var(--rim);border-radius:8px;color:var(--tx);font-size:14px;outline:none;transition:border .12s;width:100%;-webkit-appearance:none}
    .inp:focus,.ta:focus,.sel:focus{border-color:var(--acc)}
    .ta{resize:vertical;min-height:70px}.sel{cursor:pointer}.sel option{background:#181920}
    .fhint{font-size:11px;color:var(--mu);margin-top:2px}
    .dg2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .dg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .di{background:var(--s2);border:1px solid var(--rim);border-radius:8px;padding:10px 12px}
    .dil{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mu);margin-bottom:4px}
    .div2{font-size:13px;font-weight:600}
    .ddesc{background:var(--s2);border:1px solid var(--rim);border-radius:8px;padding:12px}
    .ddesc p{font-size:13px;color:#9898b8;line-height:1.6}
    .dacts{display:flex;gap:7px;flex-wrap:wrap;margin-top:4px}
    .tabs{display:flex;gap:3px;background:var(--s1);border:1px solid var(--rim);border-radius:8px;padding:3px;width:fit-content;margin-bottom:12px;overflow-x:auto}
    .tab{padding:6px 14px;border-radius:6px;border:none;background:transparent;color:var(--mu2);font-family:'Inter',sans-serif;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap}
    .tab.on{background:var(--s3);color:var(--tx)}
    .tl{display:flex;flex-direction:column}
    .tl-row{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--rim)}
    .tl-row:last-child{border-bottom:none}
    .tl-ic{width:28px;height:28px;border-radius:7px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
    .tl-act{font-size:12px;font-weight:600}.tl-note{font-size:12px;color:var(--mu2);margin-top:2px;line-height:1.4;word-break:break-word}
    .tl-ts{font-size:10px;color:var(--mu);margin-top:2px;font-family:'JetBrains Mono',monospace}
    .ybar{height:7px;background:var(--s3);border-radius:4px;overflow:hidden;margin:4px 0}
    .yfill{height:100%;border-radius:4px;transition:width .3s}
    .cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
    .card{background:var(--s1);border:1px solid var(--rim);border-radius:10px;padding:13px;transition:all .12s}
    .card:hover{border-color:var(--rim2);background:var(--s2)}.card.sel{border-color:var(--acc)}
    .crow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid var(--rim);font-size:12px}
    .crl{color:var(--mu)}.crv{font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cacts{margin-top:9px;display:flex;gap:6px;flex-wrap:wrap}
    .av{display:flex;align-items:center;justify-content:center;border-radius:8px;font-weight:700;color:#fff;flex-shrink:0}
    .tgl{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
    .tgl-tr{width:34px;height:18px;border-radius:9px;background:var(--s3);border:1px solid var(--rim);position:relative;transition:background .14s;flex-shrink:0}
    .tgl-tr.on{background:var(--acc)}.tgl-th{width:12px;height:12px;border-radius:6px;background:#fff;position:absolute;top:2px;left:2px;transition:left .14s}.tgl-tr.on .tgl-th{left:18px}
    .empty{text-align:center;padding:48px 20px;color:var(--mu)}.ei{font-size:30px;margin-bottom:8px;opacity:.3}
    .sect{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--mu);margin-bottom:8px;display:flex;align-items:center;gap:8px}.sect span{flex:1;height:1px;background:var(--rim)}
    .part-row{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--rim)}.part-row:last-child{border-bottom:none}
    .flag-box{background:rgba(240,80,96,.08);border:1px solid rgba(240,80,96,.25);border-radius:9px;padding:11px 14px;font-size:12px;color:var(--red)}
    .info-box{background:rgba(0,194,255,.07);border:1px solid rgba(0,194,255,.2);border-radius:9px;padding:11px 14px;font-size:12px;color:var(--acc)}
    .ok-box{background:rgba(46,204,138,.07);border:1px solid rgba(46,204,138,.25);border-radius:10px;padding:12px 15px}
    .ws-box{background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.25);border-radius:9px;padding:11px 14px;font-size:12px;color:var(--pur)}
    .kpi-bar{height:6px;background:var(--s3);border-radius:3px;overflow:hidden;margin-top:4px}
    .kpi-fill{height:100%;border-radius:3px}
    .act-dd{position:relative;display:inline-block}
    .act-menu{position:absolute;bottom:calc(100% + 6px);left:0;min-width:210px;background:var(--s2);border:1px solid var(--rim2);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:200;overflow:hidden}
    .act-item{display:flex;align-items:center;gap:9px;padding:11px 14px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;width:100%;text-align:left;color:var(--tx)}
    .act-item:hover{background:var(--s3)}.act-sep{height:1px;background:var(--rim);margin:3px 0}
    .dec-box{background:rgba(240,80,96,.07);border:1px solid rgba(240,80,96,.25);border-radius:10px;padding:14px 16px}
    .login-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:16px}
    .login-box{background:var(--s1);border:1px solid var(--rim);border-radius:20px;padding:36px 28px;width:100%;max-width:400px;box-shadow:0 28px 70px rgba(0,0,0,.6)}
    .err-box{background:rgba(240,80,96,.1);border:1px solid rgba(240,80,96,.25);border-radius:8px;padding:10px 13px;font-size:12px;color:var(--red);text-align:center}
    .link-btn{background:none;border:none;color:var(--acc);font-size:12px;cursor:pointer;text-decoration:underline;padding:0}
    .mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--s1);border-top:1px solid var(--rim);z-index:50;padding:6px 0 max(6px,env(safe-area-inset-bottom))}
    .mn-items{display:flex;justify-content:space-around}
    .mn-item{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 20px;border:none;background:transparent;color:var(--mu2);cursor:pointer;font-size:11px;font-weight:500;position:relative}
    .mn-item.on{color:var(--acc)}.mn-ic{font-size:20px}
    .mn-bdg{position:absolute;top:2px;right:8px;background:var(--red);color:#fff;font-size:9px;font-weight:800;border-radius:10px;padding:1px 5px;min-width:16px;text-align:center}
    @media(max-width:768px){
      .sb{position:fixed;top:0;left:0;height:100vh;transform:translateX(-100%)}
      .sb.open{transform:translateX(0)}
      .sb-overlay{display:block}
      .hamburger{display:flex}
      .content{padding:12px 14px;padding-bottom:80px}
      .fr2{grid-template-columns:1fr}
      .fr3{grid-template-columns:1fr 1fr}
      .modal{border-radius:14px 14px 0 0;max-height:95vh;position:fixed;bottom:0;left:0;right:0;width:100%;max-width:100%}
      .ov{align-items:flex-end;padding:0}
      .dg2{grid-template-columns:1fr}
      .dg3{grid-template-columns:1fr 1fr}
      .sg{grid-template-columns:repeat(2,1fr)}
      .notif-panel{right:-60px;width:calc(100vw - 20px)}
      .act-menu{left:auto;right:0}
      .mobile-nav{display:block}
    }
    @media(max-width:400px){.fr3,.dg3{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
};

// ─── LOGO ─────────────────────────────────────────────────────
function Logo({size=22}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="13" r="6" stroke="white" strokeWidth="2.5" fill="none"/>
      <path d="M7 30c0-7.18 5.82-13 13-13s13 5.82 13 13" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <rect x="5" y="28" width="5" height="9" rx="2.5" fill="white"/>
      <rect x="30" y="28" width="5" height="9" rx="2.5" fill="white"/>
      <path d="M35 32.5c0 3.5-2.5 5.5-6 5.5h-4" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <circle cx="28.5" cy="38" r="2" fill="#00c2ff"/>
    </svg>
  );
}

// ─── ATOMS ────────────────────────────────────────────────────
const Av = ({u,sz=32}) => <div className="av" style={{width:sz,height:sz,minWidth:sz,background:u?.color||"#6c63ff",borderRadius:sz>36?10:8,fontSize:sz>36?14:sz>28?12:10}}>{u?.avatar||"?"}</div>;
const XBtn = ({onClick}) => <button className="xcls" onClick={onClick}>✕</button>;
const Fld = ({label,children,hint}) => <div className="fi"><label>{label}</label>{children}{hint&&<div className="fhint">{hint}</div>}</div>;
const Tgl = ({on,onChange,label}) => <div className="tgl" onClick={()=>onChange(!on)}><div className={`tgl-tr ${on?"on":""}`}><div className="tgl-th"/></div>{label&&<span style={{fontSize:13,fontWeight:500}}>{label}</span>}</div>;
const SlaBdg = ({t,sm}) => { if(!t) return <span className="bdg" style={{background:"var(--s3)",color:"var(--mu)"}}>No SLA</span>; const m=(sm||INIT_SLA)[t]||{}; return <span className="slabdg" style={{background:m.bg,color:m.color}}>⬡ {t}</span>; };
const TypeBdg = ({t}) => { const c=TYPE_C[t]||"#888"; return <span className="typbdg" style={{background:c+"22",color:c}}>{TYPE_I[t]} {t}</span>; };
const StaBdg = ({v}) => { const c=STA_C[v]||"#888"; return <span className="bdg" style={{background:c+"22",color:c}}><span className="bdot" style={{background:c}}/>{v}</span>; };
const PriBdg = ({v}) => { const c=PRI_C[v]||"#888"; return <span className="bdg" style={{background:c+"20",color:c}}>{v}</span>; };
const RolBdg = ({r}) => { const c={manager:"var(--pur)",controller:"var(--blue)",technician:"var(--grn)"}[r]||"#888"; return <span className="rolbdg" style={{background:c+"22",color:c}}>{r}</span>; };

function SlaChip({ticket,clients,sm}) {
  const cl=clients.find(c=>c.id===ticket.clientId);
  if(!cl||!cl.hasSLA||!cl.sla) return null;
  const m=(sm||INIT_SLA)[cl.sla]; if(!m) return null;
  if(ticket.resolvedAt||ticket.closedAt) return <span className="bdg" style={{background:"rgba(46,204,138,.12)",color:"var(--grn)"}}>✓ Met</span>;
  const h=parseFloat(hoursSince(ticket.createdAt));
  if(h>m.respH) return <span className="bdg" style={{background:"rgba(240,80,96,.13)",color:"var(--red)"}}>⚠ Breach</span>;
  const left=(m.respH-h).toFixed(0); const pct=h/m.respH;
  const col=pct>.8?"var(--red)":pct>.5?"var(--amb)":"var(--grn)";
  return <span className="bdg" style={{background:col+"22",color:col}}>⏱ {left}h</span>;
}

// ══════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════
function App() {
  useEffect(()=>injectCSS(),[]);

  const [authUser,setAuthUser] = useState(undefined);
  const [profile,setProfile]   = useState(null);
  const [users,setUsers]       = useState([]);
  const [clients,setClients]   = useState([]);
  const [devices,setDevices]   = useState([]);
  const [tickets,setTickets]   = useState([]);
  const [parts,setParts]       = useState([]);
  const [settings,setSettings] = useState({sla:{...INIT_SLA},comebackDays:30});
  const [page,setPage]         = useState("dashboard");
  const [modal,setModal]       = useState(null);
  const [detail,setDetail]     = useState(null);
  const [notifOpen,setNotif]   = useState(false);
  const [sbOpen,setSb]         = useState(false);
  const [dashboardFilter,setDashboardFilter] = useState(null);
  const [partsDetailModal,setPartsDetailModal] = useState(null);
  const [invoices,setInvoices] = useState([]);
  const [showNewInvoice,setShowNewInvoice] = useState(false);
  const [selectedInvoice,setSelectedInvoice] = useState(null);
  const [contracts,setContracts] = useState([]);
  const [purchaseOrders,setPurchaseOrders] = useState([]);

  // Firebase Auth
useEffect(() => {
  console.log("AUTH LISTENER STARTED");
  const unsubscribe = onAuthStateChanged(fbAuth, async (au) => {
    console.log("AUTH STATE CHANGED:", au);
    setAuthUser(au);
    if (au) {
      try {
        const p = await FS.get("users", au.uid);
        console.log("PROFILE FROM FIRESTORE:", p);
        if (p) {
          setProfile(p);
        } else {
          console.log("CREATING NEW PROFILE");
          const mgr = {
            id: au.uid,
            name: "Manager",
            role: "manager",
            email: au.email,
            createdAt: new Date().toISOString()
          };
          await FS.set("users", au.uid, mgr);
          setProfile(mgr);
        }
      } catch (err) {
        console.error("FIRESTORE ERROR:", err);
      }
    } else {
      setProfile(null);
    }
  });
  return () => unsubscribe();
}, []);

  // Firestore realtime listeners
  useEffect(()=>{
    if(!authUser) return;
    const subs = [
      FS.sub("users",    d => setUsers(d)),
      FS.sub("clients",  d => setClients(d)),
      FS.sub("devices",  d => setDevices(d)),
      FS.sub("tickets",  d => setTickets(d.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")))),
      FS.sub("parts",    d => setParts(d)),
      FS.sub("invoices", d => setInvoices(d.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")))),
      FS.sub("contracts",d => setContracts(d)),
      FS.sub("purchase_orders", d => setPurchaseOrders(d.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")))),
    ];
    FS.get("settings","main").then(s=>{ if(s) setSettings(s); });
    return ()=>subs.forEach(u=>u());
  },[authUser]);

  // Deep link handler
  useEffect(()=>{
    const p = new URLSearchParams(window.location.search).get("ticket");
    if(p && tickets.length){ const t=tickets.find(x=>x.id===p); if(t){setDetail(t);window.history.replaceState({},"","/");} }
  },[tickets]);

  const isTech = profile?.role===ROLES.TECHNICIAN;
  const isMgr  = profile?.role===ROLES.MANAGER;
  const isCtrl = profile?.role===ROLES.CONTROLLER||isMgr;
  const slaMeta = settings.sla||INIT_SLA;

  const myNotifs = useMemo(()=>{
    if(!profile) return [];
    return tickets.flatMap(t=>(t.notifs||[]).filter(n=>n.toId===profile.id||n.toRole===profile.role)).sort((a,b)=>(b.ts||"").localeCompare(a.ts||""));
  },[tickets,profile]);
  const unread = myNotifs.filter(n=>!n.read).length;

  async function markRead(){
    const mine=tickets.filter(t=>(t.notifs||[]).some(n=>(n.toId===profile.id||n.toRole===profile.role)&&!n.read));
    for(const t of mine){ const upd=(t.notifs||[]).map(n=>n.toId===profile.id||n.toRole===profile.role?{...n,read:true}:n); await FS.set("tickets",t.id,{notifs:upd}); }
  }

  async function patchTicket(id,patch,hist,notif){
    const t=tickets.find(x=>x.id===id); if(!t) return;
    const history=[...(t.history||[])];
    if(hist) history.push({id:uid(),actorId:profile.id,...hist,ts:nowISO()});
    const notifs=[...(t.notifs||[])];
    if(notif) notifs.push({id:uid(),...notif,ts:nowISO(),read:false});
    await FS.set("tickets",id,{...patch,updatedAt:nowISO(),history,notifs});
  }

  async function createTicket(data){
    const id=generateTicketId();
    const days=settings.comebackDays||30;
    const deviceSerial=data.serial||(devices.find(d=>d.id===data.deviceId)?.serial)||"";
    const isComeback=!!(deviceSerial&&tickets.some(t=>{
      const ts=t.serial||(devices.find(d=>d.id===t.deviceId)?.serial)||"";
      return ts&&ts===deviceSerial&&["Resolved","Closed"].includes(t.status)&&t.resolvedAt&&daysBetween(t.resolvedAt)<=days;
    }));
    const notifs=[];
    if(data.techId){
      const tech=users.find(u=>u.id===data.techId);
      const cl=clients.find(c=>c.id===data.clientId);
      notifs.push({id:uid(),toId:data.techId,toRole:null,msg:`📋 New call: ${id} — "${data.title}" · ${cl?.name||"Walk-in"} · ${data.priority}`,read:false,ts:nowISO()});
    }
    if(isComeback) notifs.push({id:uid(),toRole:ROLES.MANAGER,toId:null,msg:`🔁 Comeback: ${id} — "${data.title}" (same serial ${deviceSerial} within ${days}d)`,read:false,ts:nowISO()});
    const t={...data,id,isComeback,createdAt:nowISO(),updatedAt:nowISO(),resolvedAt:null,closedAt:null,meterReading:null,distanceTravelled:null,
      status:data.techId&&data.status==="Open"?"Assigned":data.status,
      history:[{id:uid(),actorId:profile.id,action:"created",note:"Call logged"+(data.techId?` — assigned to ${users.find(u=>u.id===data.techId)?.name}`:""),ts:nowISO()}],
      notifs,parts:[]};
    await FS.set("tickets",id,t);
    if(data.deviceId) await addDevEv(data.deviceId,{type:"ticket",ticketId:id,desc:`Ticket: ${data.title}`,ts:nowISO()});
  }

  async function addDevEv(devId,ev){
    const d=devices.find(x=>x.id===devId); if(!d) return;
    await FS.set("devices",devId,{history:[ev,...(d.history||[])]});
  }

  async function saveSettings(s){ setSettings(s); await FS.set("settings","main",s); }

  async function addUser(data){
    try{
      const cred=await createUserWithEmailAndPassword(fbAuth,data.email,data.tempPassword);
      const av=data.name.trim().split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
      const u={...data,id:cred.user.uid,avatar:av,active:true,createdAt:nowISO()};
      delete u.tempPassword;
      await FS.set("users",cred.user.uid,u);
      await sendPasswordResetEmail(fbAuth,data.email);
      return {ok:true};
    }catch(e){return{ok:false,error:e.message};}
  }

if (authUser === undefined) {
  console.log("Auth still loading...");
  return <div style={{color:"white"}}>Loading auth...</div>;
}

if (!authUser) {
  return <LoginPage />;
}

if (!profile) {
  return <div style={{color:"white"}}>Loading profile...</div>;
}

  const active=isTech?tickets.filter(t=>t.techId===profile.id&&!["Closed"].includes(t.status)).length:tickets.filter(t=>!["Closed"].includes(t.status)).length;
  const partsHold=tickets.filter(t=>t.status==="Parts Pending").length;
  const partsArr=tickets.filter(t=>t.status==="Parts Arrived").length;

  const navGroups = isTech ? [
    {grp:"My Work",items:[{id:"dashboard",ic:"🏠",label:"Dashboard"},{id:"tickets",ic:"🎫",label:"My Calls",badge:active||null,bc:"rgba(0,194,255,.18)",btc:"var(--acc)"}]}
  ] : [
    {grp:"Overview",items:[{id:"dashboard",ic:"📊",label:"Dashboard"}]},
    {grp:"Tickets",items:[{id:"tickets",ic:"🎫",label:"All Tickets",badge:tickets.length,bc:"rgba(0,194,255,.18)",btc:"var(--acc)"},{id:"parts",ic:"🔧",label:"Parts & Orders",badge:(partsHold+partsArr)||null,bc:"rgba(240,80,96,.18)",btc:"var(--red)"}]},
    {grp:"Assets",items:[{id:"yield",ic:"📊",label:"Consumable Yield"},{id:"clients",ic:"🏢",label:"Clients"},{id:"devices",ic:"🖥️",label:"Devices"}]},
    {grp:"Finance",items:[{id:"billing",ic:"💰",label:"Billing & Invoices"},{id:"analytics",ic:"📈",label:"Analytics"}]},
    {grp:"Operations",items:[{id:"portal",ic:"🌐",label:"Client Portal"},{id:"contracts",ic:"📋",label:"SLA Contracts"},{id:"purchase_orders",ic:"📦",label:"Purchase Orders"},{id:"device_health",ic:"❤️",label:"Device Health"}]},
    ...(isMgr?[{grp:"Admin",items:[{id:"team",ic:"👷",label:"Team"},{id:"performance",ic:"🏆",label:"Performance"},{id:"stats",ic:"📈",label:"Stats & KPIs"},{id:"settings",ic:"⚙️",label:"Settings"}]}]:[]),
  ];

  const goto = id => { setPage(id); setSb(false); };
  const pageLabels = {dashboard:"Dashboard",tickets:isTech?"My Calls":"All Tickets",parts:"Parts & Orders",yield:"Consumable Yield",clients:"Clients",devices:"Devices",team:"Team",performance:"Performance",stats:"Stats & KPIs",billing:"Billing & Invoices",analytics:"Analytics",portal:"Client Portal",contracts:"SLA Contracts",purchase_orders:"Purchase Orders",device_health:"Device Health",settings:"Settings"};

  return (
    <div className="shell">
      {sbOpen && <div className="sb-overlay" onClick={()=>setSb(false)}/>}
      <aside className={`sb ${sbOpen?"open":""}`}>
        <div className="sb-brand">
          <div className="logo-box"><Logo size={22}/></div>
          <div><div className="sb-wm-name">Intelli<em>Support</em></div><div className="sb-wm-tag">Field Service Cloud</div></div>
        </div>
        <div className="sb-user"><Av u={profile} sz={28}/><div style={{minWidth:0}}><div className="sb-uname">{profile.name}</div><RolBdg r={profile.role}/></div></div>
        <nav className="sb-nav">
          {navGroups.map(g=>(
            <div key={g.grp}>
              <div className="sg-lbl">{g.grp}</div>
              {g.items.map(n=>(
                <button key={n.id} className={`ni ${page===n.id?"on":""}`} onClick={()=>goto(n.id)}>
                  <span className="ni-ic">{n.ic}</span>{n.label}
                  {n.badge!=null&&<span className="nbdg" style={{background:n.bc||"rgba(255,255,255,.06)",color:n.btc||"var(--mu2)"}}>{n.badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot"><span style={{fontSize:10,color:"var(--mu)"}}>v4.3</span><button className="logout-btn" onClick={()=>signOut(fbAuth)}>Sign out</button></div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-l">
            <button className="hamburger" onClick={()=>setSb(p=>!p)}>☰</button>
            <h1>{pageLabels[page]||page}</h1>
          </div>
          <div className="topbar-r">
            {isCtrl&&page==="tickets"&&<button className="btn bp bsm" onClick={()=>setModal("new-ticket")}>+ Log Call</button>}
            <BellMenu notifs={myNotifs} unread={unread} open={notifOpen} setOpen={setNotif} markRead={markRead}/>
            <Av u={profile} sz={32}/>
          </div>
        </div>

        <div className="content">
          {isTech&&page==="dashboard"&&<TechDash tickets={tickets} user={profile} settings={settings} onView={setDetail}/>}
          {isTech&&page==="tickets"&&<TicketList tickets={tickets} clients={clients} users={users} user={profile} isTech slaMeta={slaMeta} onView={setDetail}/>}
          {!isTech&&page==="dashboard"&&<Dashboard tickets={tickets} clients={clients} devices={devices} users={users} slaMeta={slaMeta} settings={settings} onView={setDetail} dashboardFilter={dashboardFilter} setDashboardFilter={setDashboardFilter}/>}
          {!isTech&&page==="tickets"&&<TicketList tickets={tickets} clients={clients} users={users} user={profile} isCtrl={isCtrl} slaMeta={slaMeta} onView={setDetail} onNew={()=>setModal("new-ticket")}/>}
          {!isTech&&page==="parts"&&<PartsPage parts={parts} setParts={setParts} tickets={tickets} patchTicket={patchTicket} user={profile} isCtrl={isCtrl} onPartDetails={setPartsDetailModal}/>}
          {!isTech&&page==="yield"&&<YieldPage devices={devices} clients={clients} isCtrl={isCtrl} addDevEv={addDevEv} user={profile}/>}
          {!isTech&&page==="clients"&&<ClientsPage clients={clients} devices={devices} tickets={tickets} isCtrl={isCtrl} slaMeta={slaMeta}/>}
          {!isTech&&page==="devices"&&<DevicesPage devices={devices} clients={clients} tickets={tickets} isCtrl={isCtrl} addDevEv={addDevEv}/>}
          {(isCtrl||isMgr)&&page==="billing"&&<BillingPage invoices={invoices} setInvoices={setInvoices} tickets={tickets} clients={clients} users={users} profile={profile} isCtrl={isCtrl} isMgr={isMgr}/>}
          {(isCtrl||isMgr)&&page==="analytics"&&<AnalyticsPage invoices={invoices} tickets={tickets} clients={clients} devices={devices} parts={parts} users={users}/>}
          {(isCtrl||isMgr)&&page==="portal"&&<ClientPortalPage clients={clients} tickets={tickets} devices={devices} invoices={invoices} users={users}/>}
          {(isCtrl||isMgr)&&page==="contracts"&&<SLAContractsPage clients={clients} slaMeta={slaMeta} profile={profile} isCtrl={isCtrl} contracts={contracts}/>}
          {(isCtrl||isMgr)&&page==="purchase_orders"&&<PurchaseOrdersPage parts={parts} profile={profile} isCtrl={isCtrl} purchaseOrders={purchaseOrders}/>}
          {(isCtrl||isMgr)&&page==="device_health"&&<DeviceHealthPage devices={devices} tickets={tickets} clients={clients} parts={parts}/>}
          {isMgr&&page==="team"&&<TeamPage users={users} addUser={addUser} tickets={tickets}/>}
          {isMgr&&page==="performance"&&<PerformancePage tickets={tickets} users={users} settings={settings}/>}
          {isMgr&&page==="stats"&&<StatsPage tickets={tickets} clients={clients} users={users} slaMeta={slaMeta}/>}
          {isMgr&&page==="settings"&&<SettingsPage settings={settings} saveSettings={saveSettings}/>}
        </div>

        {isTech&&<nav className="mobile-nav"><div className="mn-items">
          {[{id:"dashboard",ic:"🏠",lbl:"Home"},{id:"tickets",ic:"🎫",lbl:"Calls",badge:active}].map(n=>(
            <button key={n.id} className={`mn-item ${page===n.id?"on":""}`} onClick={()=>goto(n.id)}>
              <span className="mn-ic">{n.ic}</span>{n.badge>0&&<span className="mn-bdg">{n.badge}</span>}{n.lbl}
            </button>
          ))}
        </div></nav>}
      </main>

      {detail&&<TicketDetail ticket={tickets.find(t=>t.id===detail.id)||detail} tickets={tickets} clients={clients} devices={devices} users={users} user={profile} isTech={isTech} isCtrl={isCtrl} isMgr={isMgr} slaMeta={slaMeta} settings={settings} onClose={()=>setDetail(null)} patchTicket={patchTicket} addDevEv={addDevEv}/>}
      {modal==="new-ticket"&&<NewTicketModal clients={clients} devices={devices} users={users} user={profile} slaMeta={slaMeta} onClose={()=>setModal(null)} onSave={async d=>{await createTicket(d);setModal(null);}}/>}
      {partsDetailModal&&<PartsDetailModal part={partsDetailModal} tickets={tickets} patchTicket={patchTicket} isCtrl={isCtrl} onClose={()=>setPartsDetailModal(null)} onMarkArrived={async(ticketId,partId)=>{const t=tickets.find(x=>x.id===ticketId);if(!t)return;const updated=(t.parts||[]).map(p=>p.id===partId?{...p,status:"Arrived",arrived:nowISO()}:p);await patchTicket(ticketId,{parts:updated},{action:"part_arrived",note:`Part arrived: ${partsDetailModal.name}`},{toRole:ROLES.CONTROLLER,toId:null,msg:`📬 Part arrived for ${ticketId}: ${partsDetailModal.name}`});setPartsDetailModal(null);}}/>}
    </div>
  );
}

// ── PARTS DETAIL MODAL ────────────────────────────────────────
function PartsDetailModal({part,tickets,patchTicket,isCtrl,onClose,onMarkArrived}){
  const relatedTickets = tickets.filter(t=>(t.parts||[]).some(p=>p.id===part.id));
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal sm">
        <div className="mhdr"><div><div className="mhdr-t">📦 {part.name}</div><div className="mhdr-s">Part Details</div></div><XBtn onClick={onClose}/></div>
        <div className="mbody">
          <div className="dg2">
            <div className="di"><div className="dil">Part Name</div><div className="div2">{part.name}</div></div>
            <div className="di"><div className="dil">P/N</div><div className="div2 mono">{part.partNo||"—"}</div></div>
            <div className="di"><div className="dil">Qty</div><div className="div2">{part.qty}</div></div>
            <div className="di"><div className="dil">Cost</div><div className="div2">{fmtR(part.unitCost)}</div></div>
          </div>
          <div className="di" style={{marginBottom:12}}><div className="dil">Status</div><span className="bdg" style={{background:part.status==="Fitted"?"rgba(46,204,138,.12)":"rgba(251,146,60,.12)",color:part.status==="Fitted"?"var(--grn)":"var(--amb)"}}>{part.status}</span></div>
          <div style={{fontSize:12,color:"var(--mu2)"}}>
            {part.ordered&&<div>Ordered: {fmtD(part.ordered)}</div>}
            {part.fitted&&<div>Fitted: {fmtD(part.fitted)}</div>}
            {part.pagesBefore&&<div>Pages Before: {Number(part.pagesBefore).toLocaleString()}</div>}
          </div>
          <div className="sect" style={{marginTop:12}}>On Tickets<span/></div>
          {relatedTickets.length===0?<div style={{fontSize:12,color:"var(--mu)",textAlign:"center",padding:"20px"}}>Not used on any ticket</div>
            :relatedTickets.map(t=>(
              <div key={t.id} style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:8,padding:10,marginBottom:8}}>
                <div style={{fontWeight:600,fontSize:12,marginBottom:4}}>{t.id}</div>
                <div style={{fontSize:11,color:"var(--mu2)",marginBottom:6}}>{t.title}</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span className="bdg" style={{background:t.status==="Fitted"?"rgba(46,204,138,.12)":"rgba(251,146,60,.12)",color:t.status==="Fitted"?"var(--grn)":"var(--amb)"}}>{t.status}</span>
                  {isCtrl&&t.status!=="Fitted"&&<button className="btn bgrn bxs" onClick={()=>onMarkArrived(t.id,part.id)}>Mark Arrived</button>}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── LOADING ───────────────────────────────────────────────────
function Loading(){return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0b0c11",flexDirection:"column",gap:14}}><div style={{width:48,height:48,borderRadius:12,background:"linear-gradient(135deg,#00c2ff,#0044ff)",display:"flex",alignItems:"center",justifyContent:"center"}}><Logo size={28}/></div><div style={{color:"#484a68",fontSize:13,fontFamily:"Inter,sans-serif"}}>Loading IntelliSupport…</div></div>;}

// ── LOGIN ─────────────────────────────────────────────────────
function LoginPage(){
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");const [err,setErr]=useState("");const [busy,setBusy]=useState(false);const [reset,setReset]=useState(false);const [sent,setSent]=useState(false);
async function login(e){
  e.preventDefault();
  console.log("LOGIN CLICKED");
  setBusy(true);
  setErr("");
  try{
    const userCred = await signInWithEmailAndPassword(fbAuth,email,pw);
    console.log("LOGIN SUCCESS:", userCred);
  }catch(ex){
    console.error("LOGIN ERROR:", ex);
    setErr(ex.message);
  }
  setBusy(false);
}
  async function doReset(){if(!email.trim()){setErr("Enter your email first.");return;}try{await sendPasswordResetEmail(fbAuth,email);setSent(true);setErr("");}catch(ex){setErr(ex.message);}}
  return(
    <div className="login-bg">
      <div className="login-box">
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:8}}>
          <div style={{width:48,height:48,borderRadius:13,background:"linear-gradient(135deg,#00c2ff,#0044ff)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 28px rgba(0,194,255,.3)"}}><Logo size={28}/></div>
          <div><div style={{fontSize:22,fontWeight:800,letterSpacing:"-.4px"}}>Intelli<span style={{color:"#00c2ff"}}>Support</span></div><div style={{fontSize:11,color:"#484a68",marginTop:2}}>Field Service Cloud · South Africa</div></div>
        </div>
        <div style={{fontSize:13,color:"#7879a0",textAlign:"center",marginBottom:22,marginTop:6}}>{reset?"Reset your password":"Sign in to your account"}</div>
        {err&&<div className="err-box" style={{marginBottom:12}}>{err}</div>}
        {sent&&<div style={{background:"rgba(46,204,138,.1)",border:"1px solid rgba(46,204,138,.25)",borderRadius:8,padding:"12px",fontSize:13,color:"#2ecc8a",textAlign:"center",marginBottom:12}}>✅ Reset email sent! Check your inbox.</div>}
        <form onSubmit={login} style={{display:"flex",flexDirection:"column",gap:12}}>
          <div className="fi"><label>Email Address</label><input className="inp" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.co.za" autoComplete="email" required/></div>
          {!reset&&<div className="fi"><label>Password</label><input className="inp" type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" required/></div>}
          {!reset&&<button className="btn bp btn-full" type="submit" disabled={busy}>{busy?"Signing in…":"Sign In →"}</button>}
        </form>
        <div style={{textAlign:"center",marginTop:12,display:"flex",gap:8,justifyContent:"center"}}>
          {reset?<><button className="link-btn" onClick={doReset}>Send Reset Email</button><span style={{color:"#484a68"}}>·</span><button className="link-btn" onClick={()=>{setReset(false);setSent(false);}}>Back</button></>:<button className="link-btn" onClick={()=>setReset(true)}>Forgot password?</button>}
        </div>
        <div style={{marginTop:18,padding:"11px 13px",background:"var(--s2)",borderRadius:9,fontSize:11,color:"#484a68",textAlign:"center"}}>🔒 Secured by Firebase Authentication<br/>New users are added by the Manager from the Team page.</div>
      </div>
    </div>
  );
}

// ── BELL MENU ─────────────────────────────────────────────────
function BellMenu({notifs,unread,open,setOpen,markRead}){
  const ref=useRef();
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[setOpen]);
  return(
    <div style={{position:"relative"}} ref={ref}>
      <button className="bell-btn" onClick={()=>{setOpen(p=>!p);if(!open)markRead();}}>🔔{unread>0&&<span className="bell-dot"/>}</button>
      {open&&<div className="notif-panel">
        <div className="np-hd"><span>Notifications</span><span style={{color:"var(--mu)",fontWeight:400}}>{unread} unread</span></div>
        {notifs.length===0&&<div style={{padding:"18px",textAlign:"center",fontSize:12,color:"var(--mu)"}}>No notifications</div>}
        {notifs.slice(0,15).map(n=>(
          <div key={n.id} className={`np-item ${n.read?"":"unr"}`}>
            <div className="np-dot" style={{background:n.read?"var(--mu)":"var(--acc)"}}/>
            <div><div className="np-msg">{n.msg}</div><div className="np-ts">{fmtD(n.ts)}</div></div>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── TECH DASHBOARD ────────────────────────────────────────────
function TechDash({tickets,user,settings,onView}){
  const mine=tickets.filter(t=>t.techId===user.id);
  const active=mine.filter(t=>!["Closed"].includes(t.status));
  const newAssigned=mine.filter(t=>t.status==="Assigned");
  const res=mine.filter(t=>["Resolved","Closed"].includes(t.status));
  const ftf=res.length?Math.round(res.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/res.length*100):0;
  return(
    <>
      <div style={{background:"linear-gradient(135deg,var(--s1),var(--s3))",border:"1px solid var(--rim)",borderRadius:12,padding:"15px",marginBottom:13,display:"flex",alignItems:"center",gap:14}}>
        <Av u={user} sz={44}/><div><div style={{fontSize:17,fontWeight:800}}>Welcome, {user.name.split(" ")[0]} 👋</div><div style={{fontSize:12,color:"var(--mu2)",marginTop:3}}>{user.spec||"Technician"} · {active.length} active call{active.length!==1?"s":""}</div></div>
      </div>
      {newAssigned.length>0&&<div className="ok-box" style={{marginBottom:12,display:"flex",gap:12,alignItems:"center"}}><span style={{fontSize:22}}>📋</span><div><div style={{fontWeight:700}}>You have {newAssigned.length} new call{newAssigned.length>1?"s":""} to accept!</div><div style={{fontSize:12,color:"var(--mu2)",marginTop:2}}>Tap a call below to accept or decline.</div></div></div>}
      <div className="sg" style={{gridTemplateColumns:"repeat(2,1fr)"}}>
        {[{n:newAssigned.length,l:"New",c:"var(--acc)"},{n:active.filter(t=>["Accepted","In Progress"].includes(t.status)).length,l:"In Progress",c:"var(--pur)"},{n:active.filter(t=>["Parts Pending","Workshop"].includes(t.status)).length,l:"On Hold",c:"var(--amb)"},{n:ftf+"%",l:"My FTF",c:"var(--grn)"}].map(s=>(
          <div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>
        ))}
      </div>
      <div className="sect">Active Calls<span/></div>
      {active.length===0?<div className="empty"><div className="ei">✅</div><div>All clear!</div></div>
        :active.map(t=>(
          <div key={t.id} className="mcard" onClick={()=>onView(t)}>
            <div className="mcard-head"><div><div className="mcard-title">{t.title}</div><div className="mcard-sub">{t.category} · {t.type}</div></div><StaBdg v={t.status}/></div>
            <div className="mcard-row"><span style={{color:"var(--mu)"}}>Priority</span><PriBdg v={t.priority}/></div>
            <div className="mcard-row"><span style={{color:"var(--mu)"}}>Logged</span><span style={{fontFamily:"JetBrains Mono,monospace",fontSize:11}}>{fmtD(t.createdAt)}</span></div>
            {t.isComeback&&<div className="mcard-row"><span style={{color:"var(--mu)"}}>Flag</span><span className="cb-badge">🔁 Comeback</span></div>}
          </div>
        ))}
    </>
  );
}

// Continuing in next part...

// ── DASHBOARD ─────────────────────────────────────────────────
function Dashboard({tickets,clients,devices,users,slaMeta,settings,onView,dashboardFilter,setDashboardFilter}){
  const open=tickets.filter(t=>["Open","Assigned","Accepted","In Progress"].includes(t.status)).length;
  const ph=tickets.filter(t=>t.status==="Parts Pending").length;
  const pa=tickets.filter(t=>t.status==="Parts Arrived").length;
  const ws=tickets.filter(t=>t.status==="Workshop").length;
  const cb=tickets.filter(t=>t.isComeback&&!["Closed"].includes(t.status)).length;
  const res=tickets.filter(t=>["Resolved","Closed"].includes(t.status));
  const ftf=res.length?Math.round(res.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/res.length*100):0;
  const mttr=res.length?(res.reduce((s,t)=>s+daysBetween(t.createdAt,t.resolvedAt||nowISO()),0)/res.length).toFixed(1):"—";
  const breached=tickets.filter(t=>{const cl=clients.find(c=>c.id===t.clientId);if(!cl?.hasSLA||t.resolvedAt)return false;return parseFloat(hoursSince(t.createdAt))>(slaMeta[cl.sla]?.respH||24);}).length;

  const filteredTickets = dashboardFilter ? (() => {
    switch(dashboardFilter) {
      case 'open': return tickets.filter(t=>["Open","Assigned","Accepted","In Progress"].includes(t.status));
      case 'parts-hold': return tickets.filter(t=>t.status==="Parts Pending");
      case 'parts-arrived': return tickets.filter(t=>t.status==="Parts Arrived");
      case 'workshop': return tickets.filter(t=>t.status==="Workshop");
      case 'comebacks': return tickets.filter(t=>t.isComeback&&!["Closed"].includes(t.status));
      case 'breached': return tickets.filter(t=>{const cl=clients.find(c=>c.id===t.clientId);if(!cl?.hasSLA||t.resolvedAt)return false;return parseFloat(hoursSince(t.createdAt))>(slaMeta[cl.sla]?.respH||24);});
      default: return [];
    }
  })() : null;

  if(dashboardFilter&&filteredTickets){
    return(
      <>
        <button className="btn bg2 bsm" onClick={()=>setDashboardFilter(null)} style={{marginBottom:12}}>← Back to Dashboard</button>
        <div className="sect" style={{marginBottom:12}}>
          {{open:'Active Tickets',ph:'Parts Hold',pa:'Parts Arrived',ws:'Workshop',cb:'Comebacks',breached:'SLA Breached'}[dashboardFilter]||'Tickets'}
          <span/>
        </div>
        <div className="tw">
          {filteredTickets.length===0?<div className="empty"><div className="ei">📋</div><div>No tickets</div></div>
            :<table>
              <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Client</th><th>Tech</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>{filteredTickets.map(t=>{const cl=clients.find(c=>c.id===t.clientId);const tech=users.find(u=>u.id===t.techId);return(
                <tr key={t.id} onClick={()=>onView(t)}>
                  <td className="mono">{t.id}</td>
                  <td><div className="tt">{t.title}</div><div className="tsub">{t.category}</div></td>
                  <td><TypeBdg t={t.type}/></td>
                  <td style={{fontSize:12}}>{cl?.name||"—"}</td>
                  <td>{tech?<div style={{display:"flex",alignItems:"center",gap:6}}><Av u={tech} sz={20}/><span style={{fontSize:12}}>{tech.name}</span></div>:<span style={{fontSize:11,color:"var(--mu)"}}>Unassigned</span>}</td>
                  <td><PriBdg v={t.priority}/></td>
                  <td><StaBdg v={t.status}/></td>
                  <td className="mono">{fmtD(t.createdAt)}</td>
                </tr>
              );})}
              </tbody>
            </table>}
        </div>
      </>
    );
  }

  return(
    <>
      <div className="sg">
        {[{n:open,l:"Active",c:"var(--blue)",s:"Open & in progress",f:"open"},{n:ph,l:"Parts Hold",c:"var(--amb)",s:"Waiting parts",f:"parts-hold"},{n:pa,l:"Parts Arrived",c:"var(--grn)",s:"Ready to fit",f:"parts-arrived"},{n:ws,l:"Workshop",c:"var(--pur)",s:"For repair",f:"workshop"},{n:cb,l:"Comebacks",c:"var(--red)",s:"Repeat visits",f:"comebacks"},{n:breached,l:"SLA Breach",c:"var(--red)",s:"Needs attention",f:"breached"},{n:ftf+"%",l:"FTF Rate",c:"var(--acc)"},{n:mttr+"d",l:"Avg MTTR",c:"var(--grn)"}].map(s=>(
          <div className="sc" key={s.l} onClick={s.f?()=>setDashboardFilter(s.f):null} style={{cursor:s.f?"pointer":"default"}}>
            <div className="sc-n" style={{color:s.c}}>{s.n}</div>
            <div className="sc-l">{s.l}</div>
            {s.s&&<div className="sc-s">{s.s}</div>}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:14}}>
        {["IT","Copier","CCTV","PABX"].map(t=>{const c=TYPE_C[t];const total=tickets.filter(x=>x.type===t).length;const act=tickets.filter(x=>x.type===t&&["Open","Assigned","Accepted","In Progress"].includes(x.status)).length;return(
          <div key={t} style={{background:"var(--s1)",border:`1px solid ${c}33`,borderRadius:10,padding:"12px 13px",borderLeft:`3px solid ${c}`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:16}}>{TYPE_I[t]}</span><span style={{fontFamily:"JetBrains Mono,monospace",fontSize:18,fontWeight:800,color:c}}>{total}</span></div>
            <div style={{fontWeight:700,fontSize:12}}>{t}</div><div style={{fontSize:11,color:"var(--mu)",marginTop:1}}>{act} active</div>
          </div>
        );})}
      </div>
      {(pa>0||ws>0)&&<div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:12}}>
        {pa>0&&<div className="ok-box" style={{fontSize:13,color:"var(--grn)"}}>✅ <strong>{pa}</strong> ticket(s) have parts arrived — ready to re-assign.</div>}
        {ws>0&&<div className="ws-box">🔧 <strong>{ws}</strong> unit(s) at workshop — awaiting return.</div>}
      </div>}
      <div className="sect">Recent Tickets<span/></div>
      <div className="tw"><table>
        <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Client</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{tickets.slice(0,8).map(t=>{const cl=clients.find(c=>c.id===t.clientId);return(
          <tr key={t.id} onClick={()=>onView(t)}>
            <td className="mono">{t.id}</td>
            <td><div className="tt">{t.title}</div><div className="tsub">{t.category}</div></td>
            <td><TypeBdg t={t.type}/></td>
            <td style={{fontSize:12}}>{cl?.name||"—"}</td>
            <td><PriBdg v={t.priority}/></td>
            <td><StaBdg v={t.status}/>{t.isComeback&&<span className="cb-badge" style={{marginLeft:4,fontSize:9}}>CB</span>}</td>
            <td className="mono">{fmtD(t.createdAt)}</td>
          </tr>
        );})}
        </tbody>
      </table></div>
    </>
  );
}

// ── TICKET LIST ───────────────────────────────────────────────
function TicketList({tickets,clients,users,user,isTech,isCtrl,slaMeta,onView,onNew}){
  const [q,setQ]=useState("");const [fT,setFT]=useState("All");const [fS,setFS]=useState("All");const [fP,setFP]=useState("All");
  const base=isTech?tickets.filter(t=>t.techId===user.id):tickets;
  const filtered=base.filter(t=>{const lq=q.toLowerCase();return(!lq||t.title.toLowerCase().includes(lq)||t.id.toLowerCase().includes(lq))&&(fT==="All"||t.type===fT)&&(fS==="All"||t.status===fS)&&(fP==="All"||t.priority===fP);});
  return(
    <>
      <div className="frow">
        <div className="sw"><span className="sic">🔍</span><input className="sinp" placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <select className="fsl" value={fT} onChange={e=>setFT(e.target.value)}><option value="All">All Types</option>{TICKET_TYPES.map(t=><option key={t}>{t}</option>)}</select>
        <select className="fsl" value={fS} onChange={e=>setFS(e.target.value)}><option value="All">All Status</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
        <select className="fsl" value={fP} onChange={e=>setFP(e.target.value)}><option value="All">All Priority</option>{["Critical","Urgent","High","Normal","Medium","Low"].map(p=><option key={p}>{p}</option>)}</select>
        <span style={{fontSize:11,color:"var(--mu)",fontFamily:"JetBrains Mono,monospace",marginLeft:"auto"}}>{filtered.length}/{base.length}</span>
        {isCtrl&&<button className="btn bp bsm" onClick={onNew}>+ Log Call</button>}
      </div>
      {/* Mobile cards */}
      <div className="mobile-card-list">
        {filtered.map(t=>{const tech=users.find(u=>u.id===t.techId);return(
          <div key={t.id} className="mcard" onClick={()=>onView(t)}>
            <div className="mcard-head"><div><div className="mcard-title">{t.title}</div><div className="mcard-sub">{t.category} · <span className="mono">{t.id}</span></div></div><StaBdg v={t.status}/></div>
            <div className="mcard-row"><span style={{color:"var(--mu)"}}>Priority</span><PriBdg v={t.priority}/></div>
            {!isTech&&<div className="mcard-row"><span style={{color:"var(--mu)"}}>Tech</span><span style={{fontWeight:600}}>{tech?.name||"Unassigned"}</span></div>}
            <div className="mcard-row"><span style={{color:"var(--mu)"}}>Date</span><span className="mono">{fmtD(t.createdAt)}</span></div>
          </div>
        );})}
      </div>
      {/* Desktop table */}
      <div className="desktop-table tw">
        {filtered.length===0?<div className="empty"><div className="ei">🎫</div><div>No tickets</div></div>
          :<table>
            <thead><tr><th>ID</th><th>Title</th><th>Type</th>{!isTech&&<th>Client</th>}<th>Tech</th><th>Priority</th><th>Status</th>{!isTech&&<th>SLA</th>}<th>CB</th><th>Date</th></tr></thead>
            <tbody>{filtered.map(t=>{const cl=clients.find(c=>c.id===t.clientId);const tech=users.find(u=>u.id===t.techId);return(
              <tr key={t.id} onClick={()=>onView(t)}>
                <td className="mono">{t.id}</td>
                <td><div className="tt">{t.title}</div><div className="tsub">{t.category}</div></td>
                <td><TypeBdg t={t.type}/></td>
                {!isTech&&<td style={{fontSize:12}}>{cl?.name||"—"}{cl?.hasSLA&&<span style={{marginLeft:5}}><SlaBdg t={cl.sla} sm={slaMeta}/></span>}</td>}
                <td>{tech?<div style={{display:"flex",alignItems:"center",gap:6}}><Av u={tech} sz={20}/><span style={{fontSize:12}}>{tech.name}</span></div>:<span style={{fontSize:11,color:"var(--mu)"}}>Unassigned</span>}</td>
                <td><PriBdg v={t.priority}/></td>
                <td><StaBdg v={t.status}/></td>
                {!isTech&&<td><SlaChip ticket={t} clients={clients} sm={slaMeta}/></td>}
                <td>{t.isComeback&&<span className="cb-badge" style={{fontSize:9}}>🔁</span>}</td>
                <td className="mono">{fmtD(t.createdAt)}</td>
              </tr>
            );})}
            </tbody>
          </table>}
      </div>
      <style>{`@media(max-width:768px){.desktop-table{display:none}}.mobile-card-list{display:none}@media(max-width:768px){.mobile-card-list{display:block}.desktop-table{display:none!important}}`}</style>
    </>
  );
}

// ── TICKET DETAIL ─────────────────────────────────────────────
function TicketDetail({ticket,tickets,clients,devices,users,user,isTech,isCtrl,isMgr,slaMeta,settings,onClose,patchTicket,addDevEv}){
  const [tab,setTab]=useState("details");
  const [note,setNote]=useState("");
  const [showPF,setShowPF]=useState(false);
  const [pf,setPf]=useState({name:"",partNo:"",qty:1,unitCost:"",pagesBefore:""});
  const [earlyWarn,setEarlyWarn]=useState(null);
  const [reassignId,setReassignId]=useState(ticket.techId||"");
  const [ddOpen,setDdOpen]=useState(false);
  const [ddMode,setDdMode]=useState(null);
  const [decReason,setDecReason]=useState("");
  const [meterReading,setMeterReading]=useState(ticket.meterReading||"");
  const [distanceTravelled,setDistanceTravelled]=useState(ticket.distanceTravelled||"");
  const [colourReading,setColourReading]=useState(ticket.colourReading||"");
  const [monoReading,setMonoReading]=useState(ticket.monoReading||"");
  const [colourLargeReading,setColourLargeReading]=useState(ticket.colourLargeReading||"");
  const [monoLargeReading,setMonoLargeReading]=useState(ticket.monoLargeReading||"");
  const [photos,setPhotos]=useState(ticket.photos||[]);
  const photoInputRef=useRef();
  const ddRef=useRef();
  useEffect(()=>{const h=e=>{if(ddRef.current&&!ddRef.current.contains(e.target))setDdOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  
  const handlePhotoUpload=async(e)=>{const files=e.target.files; if(!files)return; for(let file of files){const reader=new FileReader(); reader.onload=async(evt)=>{const base64=evt.target.result; const newPhotos=[...photos,{id:uid(),data:base64,timestamp:nowISO()}]; setPhotos(newPhotos); await patchTicket(ticket.id,{photos:newPhotos},{action:"note",note:`Photo added`});}; reader.readAsDataURL(file);};};

  const cl=clients.find(c=>c.id===ticket.clientId);
  const dev=devices.find(d=>d.id===ticket.deviceId);
  const tech=users.find(u=>u.id===ticket.techId);
  const techs=users.filter(u=>u.role===ROLES.TECHNICIAN&&u.active);
  const canAct=isTech&&ticket.techId===user.id;
  const st=ticket.status;
  const isClosed=st==="Closed"; const isRes=st==="Resolved"; const isPH=st==="Parts Pending"; const isPA=st==="Parts Arrived"; const isWS=st==="Workshop"; const isEsc=st==="Escalated"; const isAssigned=st==="Assigned"; const isAccepted=st==="Accepted";
  const HICONS={created:"📝",accepted:"✅",declined:"❌",note:"💬",parts_hold:"⏸",workshop:"🔧",escalated:"🚨",parts_arrived:"📬",reassigned:"🔄",resolved:"✅",closed:"🔒",part_added:"🔧",part_fitted:"⚙️"};
  const ddPlaceholders={hold:"Describe what parts are needed…",workshop:"Describe the fault requiring workshop repair…",escalate:"Describe why this needs expert escalation…",resolve:"Describe how the issue was resolved…",note:"Add a note…"};

  async function accept(){await patchTicket(ticket.id,{status:"Accepted"},{action:"accepted",note:"Technician accepted the call"},{toRole:ROLES.CONTROLLER,toId:null,msg:`✅ ${ticket.id} accepted by ${user.name}`});}
  async function decline(){
    if(!decReason.trim()){alert("Please provide a reason.");return;}
    await patchTicket(ticket.id,{status:"Open",techId:null},{action:"declined",note:`Declined by ${user.name}: ${decReason}`},{toRole:ROLES.CONTROLLER,toId:null,msg:`❌ ${ticket.id} DECLINED by ${user.name}: "${decReason}" — please re-assign`});
    setDecReason("");setDdMode(null);onClose();
  }
  async function submitAction(){
    if(!note.trim()){alert("Please add a note.");return;}
    if(ddMode==="hold") await patchTicket(ticket.id,{status:"Parts Pending"},{action:"parts_hold",note:`On hold — parts: ${note}`},{toRole:ROLES.MANAGER,toId:null,msg:`⏸ ${ticket.id} on hold — parts needed: ${note} · Tech: ${user.name}`});
    else if(ddMode==="workshop"){await patchTicket(ticket.id,{status:"Workshop"},{action:"workshop",note:`Sent to workshop: ${note}`},{toRole:ROLES.MANAGER,toId:null,msg:`🔧 ${ticket.id} sent to WORKSHOP — ${note}`});await patchTicket(ticket.id,{},{},{toRole:ROLES.CONTROLLER,toId:null,msg:`🔧 Workshop: ${ticket.id} — ${note}`});}
    else if(ddMode==="escalate"){await patchTicket(ticket.id,{status:"Escalated"},{action:"escalated",note:`Escalated: ${note}`},{toRole:ROLES.MANAGER,toId:null,msg:`🚨 ${ticket.id} ESCALATED — ${note} · Tech: ${user.name}`});}
    else if(ddMode==="resolve"){
      const updateData={status:"Resolved",resolvedAt:nowISO()};
      if(meterReading) updateData.meterReading=+meterReading;
      if(distanceTravelled) updateData.distanceTravelled=+distanceTravelled;
      if(colourReading) updateData.colourReading=+colourReading;
      if(monoReading) updateData.monoReading=+monoReading;
      if(colourLargeReading) updateData.colourLargeReading=+colourLargeReading;
      if(monoLargeReading) updateData.monoLargeReading=+monoLargeReading;
      await patchTicket(ticket.id,updateData,{action:"resolved",note},null);
      if(dev){
        const meterDesc=`Resolved: ${note}${meterReading?` · Total Meter: ${Number(meterReading).toLocaleString()} pages`:""}`+
          `${colourReading?` · Colour: ${Number(colourReading).toLocaleString()}`:""}`+
          `${monoReading?` · Mono: ${Number(monoReading).toLocaleString()}`:""}`+
          `${colourLargeReading?` · Colour Large: ${Number(colourLargeReading).toLocaleString()}`:""}`+
          `${monoLargeReading?` · Mono Large: ${Number(monoLargeReading).toLocaleString()}`:""}`+
          `${distanceTravelled?` · Distance: ${Number(distanceTravelled).toFixed(1)}km`:""}`;
        await addDevEv(dev.id,{type:"resolved",ticketId:ticket.id,desc:meterDesc,colourReading:+colourReading||null,monoReading:+monoReading||null,colourLargeReading:+colourLargeReading||null,monoLargeReading:+monoLargeReading||null,distanceTravelled:+distanceTravelled||null,ts:nowISO()});
      }
    }
    else if(ddMode==="note") await patchTicket(ticket.id,{},{action:"note",note},null);
    setNote("");setDdMode(null);
  }
  async function markPartsArrived(){await patchTicket(ticket.id,{status:"Parts Arrived"},{action:"parts_arrived",note:"Parts/unit arrived — ready to reassign"},{toRole:ROLES.CONTROLLER,toId:null,msg:`✅ Parts arrived for ${ticket.id}`});}
  async function reassign(){
    if(!reassignId){alert("Select a technician.");return;}
    const nt=users.find(u=>u.id===reassignId);
    await patchTicket(ticket.id,{status:"Assigned",techId:reassignId},{action:"reassigned",note:`Reassigned to ${nt?.name}`},{toId:reassignId,toRole:null,msg:`📋 ${ticket.id} re-assigned to you: "${ticket.title}"`});
  }
  async function closeTicket(){await patchTicket(ticket.id,{status:"Closed",closedAt:nowISO()},{action:"closed",note:"Closed by controller."},null);}

  function onPartName(name){
    setPf(p=>({...p,name}));setEarlyWarn(null);
    if(dev&&name){const con=(dev.consumables||[]).find(c=>c.name===name);if(con)setEarlyWarn(checkEarly(name,con.currentPages,con.capacity));}
  }
  async function addPart(){
    if(!pf.name.trim())return;
    if(earlyWarn){const ok=window.confirm(`⚠️ Early replacement: ${pf.name} at ${earlyWarn.pct}% yield (min ${earlyWarn.minPct}% per service manual). Proceed?`);if(!ok)return;await patchTicket(ticket.id,{},{action:"note",note:`⚠️ Early replacement: ${pf.name} at ${earlyWarn.pct}% yield`},{toRole:ROLES.MANAGER,toId:null,msg:`⚠️ Early replacement on ${ticket.id}: ${pf.name} at ${earlyWarn.pct}% — min is ${earlyWarn.minPct}%`});}
    const np={id:uid(),...pf,status:"Ordered",ordered:nowISO(),arrived:null,fitted:null};
    await patchTicket(ticket.id,{parts:[...(ticket.parts||[]),np]},{action:"part_added",note:`Part logged: ${pf.name}`},null);
    if(dev)await addDevEv(dev.id,{type:"part_ordered",ticketId:ticket.id,desc:`Part ordered: ${pf.name}${pf.partNo?" ("+pf.partNo+")":""}`,ts:nowISO()});
    setPf({name:"",partNo:"",qty:1,unitCost:"",pagesBefore:""});setShowPF(false);setEarlyWarn(null);
  }
  async function fitPart(partId){
    const p=(ticket.parts||[]).find(x=>x.id===partId);if(!p)return;
    const updated=(ticket.parts||[]).map(x=>x.id===partId?{...x,status:"Fitted",fitted:nowISO(),fittedBy:user.id,arrived:x.arrived||nowISO()}:x);
    await patchTicket(ticket.id,{parts:updated},{action:"part_fitted",note:`Part fitted: ${p.name}${p.pagesBefore?` — yield: ${Number(p.pagesBefore).toLocaleString()} pages`:""}` },null);
    if(dev){
      await addDevEv(dev.id,{type:"part_fitted",ticketId:ticket.id,desc:`Part fitted: ${p.name}${p.pagesBefore?` — yield: ${Number(p.pagesBefore).toLocaleString()} pages`:""}`,cost:p.unitCost,ts:nowISO()});
      if(CONSUMABLES.includes(p.name)){
        const existing=(dev.consumables||[]).find(c=>c.name===p.name);
        const newCons=existing
          ?(dev.consumables||[]).map(c=>c.name===p.name?{...c,currentPages:0,installedDate:nowISO(),history:[...(c.history||[]),{fitted:nowISO(),pagesBefore:p.pagesBefore,ticketId:ticket.id}]}:c)
          :[...(dev.consumables||[]),{id:uid(),name:p.name,currentPages:0,capacity:CON_CAP[p.name]||10000,installedDate:nowISO(),history:[{fitted:nowISO(),ticketId:ticket.id}]}];
        await FS.set("devices",dev.id,{consumables:newCons});
      }
    }
  }

  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:720}}>
        <div className="mhdr" style={{borderLeft:`3px solid ${TYPE_C[ticket.type]||"#888"}`}}>
          <div style={{flex:1,minWidth:0}}>
            <div className="mhdr-s">{ticket.id} · <TypeBdg t={ticket.type}/> · {ticket.category}{ticket.errorCode?` · ${ticket.errorCode}`:""}</div>
            <div className="mhdr-t" style={{marginTop:4}}>{ticket.title}</div>
            <div style={{display:"flex",gap:7,marginTop:7,flexWrap:"wrap"}}>
              <StaBdg v={ticket.status}/><PriBdg v={ticket.priority}/>
              {ticket.isComeback&&<span className="cb-badge">🔁 Comeback</span>}
              {!isTech&&<SlaChip ticket={ticket} clients={clients} sm={slaMeta}/>}
              {!isTech&&cl?.hasSLA&&<SlaBdg t={cl.sla} sm={slaMeta}/>}
            </div>
          </div>
          <XBtn onClick={onClose}/>
        </div>
        <div className="tabs" style={{margin:"12px 16px 0"}}>
          {["details","history","parts","photos"].map(t=><button key={t} className={`tab ${tab===t?"on":""}`} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}{t==="parts"&&(ticket.parts||[]).length>0?` (${ticket.parts.length})`:""}{t==="photos"&&photos.length>0?` (${photos.length})`:""}</button>)}
        </div>
        <div className="mbody" style={{paddingTop:10}}>

          {tab==="details"&&<>
            <div className="dg2">
              {!isTech&&<div className="di"><div className="dil">Client</div><div className="div2">{cl?.name||"—"}{cl?.walkIn&&<span style={{marginLeft:6,fontSize:10,color:"var(--amb)"}}>Walk-in</span>}</div></div>}
              <div className="di"><div className="dil">Reporter</div><div className="div2">{ticket.reporter||"—"}</div></div>
              <div className="di"><div className="dil">Technician</div><div className="div2">{tech?<div style={{display:"flex",alignItems:"center",gap:7}}><Av u={tech} sz={22}/>{tech.name}</div>:"Unassigned"}</div></div>
              <div className="di"><div className="dil">Logged</div><div className="div2 mono" style={{color:"var(--tx)",fontSize:12}}>{fmt(ticket.createdAt)}</div></div>
              {ticket.resolvedAt&&<div className="di"><div className="dil">Resolved</div><div className="div2 mono" style={{color:"var(--grn)",fontSize:12}}>{fmt(ticket.resolvedAt)}</div></div>}
              {!isTech&&cl?.hasSLA&&<><div className="di"><div className="dil">SLA Response</div><div className="div2">{slaMeta[cl.sla]?.respH}h</div></div><div className="di"><div className="dil">SLA Resolution</div><div className="div2">{slaMeta[cl.sla]?.resH}h</div></div></>}
            </div>
            {(ticket.brand||ticket.model)&&<div className="dg3">
              {ticket.brand&&<div className="di"><div className="dil">Brand</div><div className="div2">{ticket.brand}</div></div>}
              {ticket.model&&<div className="di"><div className="dil">Model</div><div className="div2">{ticket.model}</div></div>}
              {ticket.serial&&<div className="di"><div className="dil">Serial</div><div className="div2 mono" style={{color:"var(--tx)",fontSize:12}}>{ticket.serial}</div></div>}
              {dev?.location&&<div className="di"><div className="dil">Location</div><div className="div2">{dev.location}</div></div>}
            </div>}
            {ticket.meterReading&&<div className="dg2">
              <div className="di"><div className="dil">Meter Reading</div><div className="div2">{Number(ticket.meterReading).toLocaleString()} pages</div></div>
              {ticket.distanceTravelled&&<div className="di"><div className="dil">Distance</div><div className="div2">{Number(ticket.distanceTravelled).toFixed(1)} km</div></div>}
            </div>}
            {(ticket.colourReading||ticket.monoReading||ticket.colourLargeReading||ticket.monoLargeReading)&&<div style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:9,padding:12}}>
              <div style={{fontWeight:600,fontSize:11,marginBottom:8,color:"var(--acc)"}}>📊 DETAILED METER READINGS</div>
              <div className="fr2">
                {ticket.colourReading&&<div className="di"><div className="dil">Colour</div><div className="div2">{Number(ticket.colourReading).toLocaleString()}</div></div>}
                {ticket.monoReading&&<div className="di"><div className="dil">Mono</div><div className="div2">{Number(ticket.monoReading).toLocaleString()}</div></div>}
              </div>
              <div className="fr2">
                {ticket.colourLargeReading&&<div className="di"><div className="dil">Colour Large</div><div className="div2">{Number(ticket.colourLargeReading).toLocaleString()}</div></div>}
                {ticket.monoLargeReading&&<div className="di"><div className="dil">Mono Large</div><div className="div2">{Number(ticket.monoLargeReading).toLocaleString()}</div></div>}
              </div>
            </div>}
            <div className="ddesc"><div className="dil" style={{marginBottom:6}}>Description</div><p>{ticket.description||"No description."}</p></div>
            {ticket.isComeback&&<div className="flag-box">🔁 Comeback — serial {ticket.serial||"—"} had a resolved ticket within {settings?.comebackDays||30} days.</div>}
            {isWS&&<div className="ws-box">🔧 Unit at workshop. Mark "Returned" when unit is back, then re-assign.</div>}
            {isEsc&&<div className="flag-box">🚨 Escalated to expert. Manager/controller to action.</div>}

            {/* Tech: Accept/Decline */}
            {canAct&&isAssigned&&!ddMode&&(
              <div className="ok-box" style={{display:"flex",gap:12,alignItems:"center"}}>
                <span style={{fontSize:22}}>📋</span>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>Call assigned to you</div><div style={{fontSize:12,color:"var(--mu2)",marginTop:2}}>Accept to begin work, or decline with a reason.</div></div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <button className="btn bgrn bsm" onClick={accept}>✅ Accept</button>
                  <button className="btn bd bsm" onClick={()=>setDdMode("decline")}>❌ Decline</button>
                </div>
              </div>
            )}
            {canAct&&ddMode==="decline"&&(
              <div className="dec-box">
                <div style={{fontWeight:600,fontSize:13,color:"var(--red)",marginBottom:8}}>❌ Reason for declining (required)</div>
                <textarea className="ta" placeholder="Provide your reason…" value={decReason} onChange={e=>setDecReason(e.target.value)} style={{marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}><button className="btn bd bsm" disabled={!decReason.trim()} onClick={decline}>Submit</button><button className="btn bg2 bsm" onClick={()=>setDdMode(null)}>Cancel</button></div>
              </div>
            )}
            {canAct&&isAccepted&&!ddMode&&<div className="info-box">✅ Accepted — use the Action button to update this call.</div>}

            {/* Tech: Action dropdown */}
            {canAct&&(isAccepted||st==="In Progress")&&!ddMode&&!isClosed&&(
              <div className="dacts">
                <div className="act-dd" ref={ddRef}>
                  <button className="btn bp bsm" style={{fontSize:14,padding:"10px 18px"}} onClick={()=>setDdOpen(p=>!p)}>⚡ Action ▾</button>
                  {ddOpen&&<div className="act-menu">
                    <button className="act-item" onClick={()=>{setDdMode("resolve");setDdOpen(false);}}>✅ Mark Resolved</button>
                    <div className="act-sep"/>
                    <button className="act-item" onClick={()=>{setDdMode("hold");setDdOpen(false);}}>⏸ On Hold — Parts Needed</button>
                    <button className="act-item" onClick={()=>{setDdMode("workshop");setDdOpen(false);}}>🔧 Send to Workshop</button>
                    <button className="act-item" onClick={()=>{setDdMode("escalate");setDdOpen(false);}}>🚨 Escalate to Expert</button>
                    <div className="act-sep"/>
                    <button className="act-item" onClick={()=>{setDdMode("note");setDdOpen(false);}}>💬 Add Note</button>
                  </div>}
                </div>
              </div>
            )}
            {ddMode==="resolve"&&!isClosed&&(
              <div style={{background:"var(--s2)",border:"1px solid var(--rim2)",borderRadius:10,padding:14,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontWeight:600,fontSize:13}}>✅ Mark Resolved - Add Meter & Distance</div>
                <textarea className="ta" placeholder="Describe how the issue was resolved…" value={note} onChange={e=>setNote(e.target.value)}/>
                <div className="fr2">
                  <Fld label="Distance Travelled (km)" hint="Distance driven for this call"><input className="inp" type="number" step="0.1" value={distanceTravelled} onChange={e=>setDistanceTravelled(e.target.value)} placeholder="e.g. 12.5"/></Fld>
                </div>
                <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:12}}>
                  <div style={{fontWeight:600,fontSize:12,marginBottom:10,color:"var(--acc)"}}>📊 Meter Readings</div>
                  <div className="fr2">
                    <Fld label="Colour" hint="Colour pages"><input className="inp" type="number" placeholder="e.g. 5000"/></Fld>
                    <Fld label="Mono" hint="B&W pages"><input className="inp" type="number" placeholder="e.g. 40000"/></Fld>
                  </div>
                  <div className="fr2">
                    <Fld label="Colour Large" hint="Large colour pages"><input className="inp" type="number" placeholder="e.g. 100"/></Fld>
                    <Fld label="Mono Large" hint="Large B&W pages"><input className="inp" type="number" placeholder="e.g. 500"/></Fld>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={submitAction}>Submit</button><button className="btn bg2 bsm" onClick={()=>{setDdMode(null);setNote("");setMeterReading("");setDistanceTravelled("");setColourReading("");setMonoReading("");setColourLargeReading("");setMonoLargeReading("");}}> Cancel</button></div>
              </div>
            )}
            {ddMode&&ddMode!=="resolve"&&ddMode!=="decline"&&!isClosed&&(
              <div style={{background:"var(--s2)",border:"1px solid var(--rim2)",borderRadius:10,padding:14,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontWeight:600,fontSize:13}}>{{hold:"⏸ On Hold — Parts Needed",workshop:"🔧 Send to Workshop",escalate:"🚨 Escalate to Expert",note:"💬 Add Note"}[ddMode]}</div>
                <textarea className="ta" placeholder={ddPlaceholders[ddMode]} value={note} onChange={e=>setNote(e.target.value)}/>
                {ddMode==="hold"&&<div style={{fontSize:11,color:"var(--mu2)"}}>💡 Go to the Parts tab after submitting to log required parts.</div>}
                <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={submitAction}>Submit</button><button className="btn bg2 bsm" onClick={()=>{setDdMode(null);setNote("");}}>Cancel</button></div>
              </div>
            )}

            {/* Controller actions */}
            {!isClosed&&isCtrl&&<>
              <div className="sect" style={{marginTop:4}}>Controller Actions<span/></div>
              <div className="dacts">
                {(isPH||isWS)&&<button className="btn bgrn bsm" onClick={markPartsArrived}>📬 {isWS?"Mark Returned":"Mark Parts Arrived"}</button>}
                {(isPA||isEsc||!ticket.techId||ticket.status==="Open")&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <select className="sel" style={{maxWidth:180,fontSize:13}} value={reassignId} onChange={e=>setReassignId(e.target.value)}><option value="">— Select Tech —</option>{techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
                  <button className="btn bgrn bsm" onClick={reassign}>🔄 {ticket.techId?"Re-assign":"Assign"}</button>
                </div>}
                {isRes&&!isClosed&&<button className="btn bp bsm" onClick={closeTicket}>🔒 Close Ticket</button>}
                {!isRes&&!isClosed&&<button className="btn bg2 bsm" disabled={!note.trim()} onClick={async()=>{if(!note.trim())return;await patchTicket(ticket.id,{},{action:"note",note},null);setNote("");}}>💬 Add Note</button>}
              </div>
              {!isRes&&!isClosed&&<textarea className="ta" placeholder="Controller note…" value={note} onChange={e=>setNote(e.target.value)} style={{marginTop:4}}/>}
            </>}
          </>}

          {tab==="history"&&<div className="tl">
            {(ticket.history||[]).slice().reverse().map(h=>{const actor=users.find(u=>u.id===h.actorId);return(
              <div key={h.id} className="tl-row">
                <div className="tl-ic">{HICONS[h.action]||"📌"}</div>
                <div><div className="tl-act">{actor?.name||"System"} <RolBdg r={actor?.role}/></div><div className="tl-note">{h.note}</div><div className="tl-ts">{fmt(h.ts)}</div></div>
              </div>
            );})}
          </div>}

          {tab==="parts"&&<>
            {(ticket.parts||[]).length===0&&<div className="empty"><div className="ei">🔧</div><div>No parts logged</div></div>}
            {(ticket.parts||[]).map(p=>(
              <div key={p.id} className="part-row">
                <div style={{flex:1}}>
                  <div style={{fontWeight:600}}>{p.name}</div>
                  <div style={{fontSize:11,color:"var(--mu2)",marginTop:2}}>P/N: {p.partNo||"—"} · Qty: {p.qty} · {p.unitCost?fmtR(p.unitCost):"No cost"} · <span style={{color:p.status==="Fitted"?"var(--grn)":"var(--amb)"}}>{p.status}</span></div>
                  {p.ordered&&<div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>Ordered: {fmtD(p.ordered)}{p.fitted?` · Fitted: ${fmtD(p.fitted)}`:""}</div>}
                  {p.pagesBefore&&<div style={{fontSize:11,color:"var(--mu2)",marginTop:2}}>Yield: <strong>{Number(p.pagesBefore).toLocaleString()}</strong> pages</div>}
                </div>
                {p.status!=="Fitted"&&canAct&&<button className="btn bgrn bxs" onClick={()=>fitPart(p.id)}>Fitted</button>}
                {p.status==="Fitted"&&<span className="bdg" style={{background:"rgba(46,204,138,.12)",color:"var(--grn)"}}>✓ Fitted</span>}
              </div>
            ))}
            {(isCtrl||canAct)&&!isClosed&&<>
              {!showPF&&<button className="btn bg2 bsm" onClick={()=>setShowPF(true)}>+ Add Part</button>}
              {showPF&&<div style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:9,padding:13,display:"flex",flexDirection:"column",gap:10}}>
                {earlyWarn&&<div className="flag-box">⚠️ <strong>Early replacement:</strong> {pf.name} at <strong>{earlyWarn.pct}%</strong> yield — service manual min: <strong>{earlyWarn.minPct}%</strong>. Manager will be notified.</div>}
                <div className="fr2">
                  <Fld label="Part Name *"><select className="sel" value={pf.name} onChange={e=>onPartName(e.target.value)}><option value="">— Select —</option>{CONSUMABLES.map(c=><option key={c}>{c}</option>)}<option value="Other / Custom">Other / Custom</option></select></Fld>
                  <Fld label="Part Number"><input className="inp" value={pf.partNo} onChange={e=>setPf(p=>({...p,partNo:e.target.value}))}/></Fld>
                </div>
                <div className="fr3">
                  <Fld label="Qty"><input className="inp" type="number" min={1} value={pf.qty} onChange={e=>setPf(p=>({...p,qty:+e.target.value}))}/></Fld>
                  <Fld label="Cost (R)"><input className="inp" type="number" step="0.01" value={pf.unitCost} onChange={e=>setPf(p=>({...p,unitCost:e.target.value}))}/></Fld>
                  <Fld label="Pages Before"><input className="inp" type="number" value={pf.pagesBefore} onChange={e=>setPf(p=>({...p,pagesBefore:e.target.value}))}/></Fld>
                </div>
                <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={addPart}>Save</button><button className="btn bg2 bsm" onClick={()=>{setShowPF(false);setEarlyWarn(null);}}>Cancel</button></div>
              </div>}
            </>}
          </>}

          {tab==="photos"&&<>
            <input ref={photoInputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={handlePhotoUpload}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:12,color:"var(--mu2)"}}>{photos.length} photo{photos.length!==1?"s":""} attached</div>
              {!isClosed&&<button className="btn bp bsm" onClick={()=>photoInputRef.current?.click()}>📷 Add Photos</button>}
            </div>
            {photos.length===0
              ?<div className="empty"><div className="ei">📷</div><div>No photos yet</div><div style={{fontSize:12,color:"var(--mu)",marginTop:6}}>Attach before/after photos, error screens, or damage documentation</div></div>
              :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
                {photos.map((ph,i)=>(
                  <div key={ph.id||i} style={{position:"relative",borderRadius:10,overflow:"hidden",border:"1px solid var(--rim)",background:"var(--s2)"}}>
                    <img src={ph.data} alt={`Photo ${i+1}`} style={{width:"100%",height:130,objectFit:"cover",display:"block"}}/>
                    <div style={{padding:"6px 8px",fontSize:10,color:"var(--mu)"}}>
                      {ph.timestamp?fmtD(ph.timestamp):"—"}
                    </div>
                    {!isClosed&&<button
                      style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,.6)",border:"none",borderRadius:5,color:"#fff",fontSize:12,padding:"2px 6px",cursor:"pointer"}}
                      onClick={async()=>{const np=photos.filter((_,j)=>j!==i);setPhotos(np);await patchTicket(ticket.id,{photos:np},{action:"note",note:"Photo removed"});}}
                    >✕</button>}
                  </div>
                ))}
              </div>}
          </>}
        </div>
      </div>
    </div>
  );
}

// ── NEW TICKET MODAL ──────────────────────────────────────────
function NewTicketModal({clients,devices,users,user,onClose,onSave,slaMeta}){
  const [f,setF]=useState({type:"IT",category:"Hardware",priority:"High",status:"Open",title:"",description:"",reporter:"",clientId:"",deviceId:"",techId:"",errorCode:"",brand:"",model:"",serial:""});
  const [busy,setBusy]=useState(false);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const cats=CATS[f.type]||CATS.IT; const pris=PRIS[f.type]||PRIS.IT;
  const cDevs=devices.filter(d=>d.clientId===f.clientId&&d.type===f.type);
  const techs=users.filter(u=>u.role===ROLES.TECHNICIAN&&u.active);
  const ok=f.title.trim()&&f.clientId;
  const selClient=clients.find(c=>c.id===f.clientId);
  const clientSLA=selClient?.sla||"None";
  function pickDev(id){const d=devices.find(x=>x.id===id);setF(p=>({...p,deviceId:id,brand:d?.brand||p.brand,model:d?.model||p.model,serial:d?.serial||p.serial}));}
  async function submit(){setBusy(true);await onSave({...f,createdBy:user.id,controllerId:user.id});setBusy(false);}
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mhdr"><div><div className="mhdr-t">📋 Log New Call</div></div><XBtn onClick={onClose}/></div>
        <div className="mbody">
          <div className="fr2">
            <Fld label="Type"><select className="sel" value={f.type} onChange={e=>setF(p=>({...p,type:e.target.value,category:(CATS[e.target.value]||CATS.IT)[0],priority:(PRIS[e.target.value]||PRIS.IT)[0]}))}>{TICKET_TYPES.map(t=><option key={t}>{t}</option>)}</select></Fld>
            <Fld label="Category"><select className="sel" value={f.category} onChange={e=>s("category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select></Fld>
          </div>
          <Fld label="Fault Description *"><input className="inp" value={f.title} onChange={e=>s("title",e.target.value)} placeholder="Brief description of the issue"/></Fld>
          <div className="fr2">
            <Fld label="Client *"><select className="sel" value={f.clientId} onChange={e=>setF(p=>({...p,clientId:e.target.value,deviceId:""}))}>
              <option value="">— Select Client —</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.walkIn?" (Walk-in)":""}</option>)}
            </select></Fld>
            <Fld label="Reporter"><input className="inp" value={f.reporter} onChange={e=>s("reporter",e.target.value)} placeholder="Contact person"/></Fld>
          </div>
          {f.clientId&&<div style={{background:"var(--s2)",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12}}>
            <div style={{fontWeight:600,marginBottom:4}}>Client SLA: {clientSLA==="None"?<span style={{color:"var(--mu)"}}>No SLA</span>:<><span style={{color:"var(--acc)"}}>★ {clientSLA}</span> {slaMeta[clientSLA]&&<span style={{color:"var(--mu)"}}> • Response: {slaMeta[clientSLA].respH}h • Resolution: {slaMeta[clientSLA].resH}h</span>}</> }</div>
          </div>}
          <div className="fr3">
            <Fld label="Priority"><select className="sel" value={f.priority} onChange={e=>s("priority",e.target.value)}>{pris.map(p=><option key={p}>{p}</option>)}</select></Fld>
            <Fld label="Status"><select className="sel" value={f.status} onChange={e=>s("status",e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></Fld>
            <Fld label="Assign Tech"><select className="sel" value={f.techId} onChange={e=>s("techId",e.target.value)}><option value="">— Unassigned —</option>{techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Fld>
          </div>
          {f.clientId&&cDevs.length>0&&<Fld label="Device"><select className="sel" value={f.deviceId} onChange={e=>pickDev(e.target.value)}><option value="">— No device —</option>{cDevs.map(d=><option key={d.id} value={d.id}>{d.brand} {d.model} ({d.serial})</option>)}</select></Fld>}
          {(f.type==="Copier"||f.type==="CCTV"||f.type==="PABX")&&<div className="fr3">
            <Fld label="Brand"><input className="inp" value={f.brand} onChange={e=>s("brand",e.target.value)}/></Fld>
            <Fld label="Model"><input className="inp" value={f.model} onChange={e=>s("model",e.target.value)}/></Fld>
            <Fld label="Error Code"><input className="inp" value={f.errorCode} onChange={e=>s("errorCode",e.target.value)}/></Fld>
          </div>}
          <Fld label="Description"><textarea className="ta" value={f.description} onChange={e=>s("description",e.target.value)} placeholder="Full fault description…"/></Fld>
        </div>
        <div className="mfoot"><button className="btn bg2" onClick={onClose}>Cancel</button><button className="btn bp" disabled={!ok||busy} onClick={submit}>{busy?"Saving…":"Log Call"}</button></div>
      </div>
    </div>
  );
}

// ── PARTS PAGE ────────────────────────────────────────────────
function PartsPage({parts,setParts,tickets,patchTicket,user,isCtrl,onPartDetails}){
  const [showAdd,setShowAdd]=useState(false);const [editId,setEditId]=useState(null);
  const [f,setF]=useState({name:"",partNo:"",category:"Toner",qty:0,minQty:1,unitCost:"",supplier:""});
  const [q,setQ]=useState("");
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const lowStock=parts.filter(p=>p.qty<=p.minQty);
  const activeParts=tickets.flatMap(t=>(t.parts||[]).map(p=>({...p,tid:t.id})));
  const filtered=parts.filter(p=>!q||p.name.toLowerCase().includes(q.toLowerCase())||p.partNo?.toLowerCase().includes(q.toLowerCase()));
  
  async function savePart(){
    if(!f.name.trim())return;
    const newList=editId?parts.map(x=>x.id===editId?{...x,...f}:x):[...parts,{...f,id:uid()}];
    for(const p of newList) await FS.set("parts",p.id,p);
    setF({name:"",partNo:"",category:"Toner",qty:0,minQty:1,unitCost:"",supplier:""});setShowAdd(false);setEditId(null);
  }
  function startEdit(p){setF({name:p.name,partNo:p.partNo,category:p.category,qty:p.qty,minQty:p.minQty,unitCost:p.unitCost,supplier:p.supplier});setEditId(p.id);setShowAdd(true);}
  
  return(
    <>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {[{n:parts.length,l:"SKUs",c:"var(--blue)"},{n:lowStock.length,l:"Low Stock",c:"var(--red)"},{n:activeParts.filter(p=>p.status==="Ordered").length,l:"On Order",c:"var(--amb)"}].map(s2=>(
          <div className="sc" key={s2.l} style={{flex:"none",minWidth:90}}><div className="sc-n" style={{color:s2.c,fontSize:18}}>{s2.n}</div><div className="sc-l">{s2.l}</div></div>
        ))}
        {isCtrl&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center"}}><button className="btn bp bsm" onClick={()=>{setShowAdd(true);setEditId(null);setF({name:"",partNo:"",category:"Toner",qty:0,minQty:1,unitCost:"",supplier:""});}}>+ Add Part</button></div>}
      </div>
      {lowStock.length>0&&<div className="flag-box" style={{marginBottom:10}}>⚠️ Low stock: {lowStock.map(p=>p.name).join(", ")}</div>}
      <div className="frow" style={{marginBottom:12}}>
        <div className="sw"><span className="sic">🔍</span><input className="sinp" placeholder="Search parts…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>
      {showAdd&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:14,marginBottom:12,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontWeight:700,fontSize:14}}>{editId?"Edit Part":"Add Part"}</div>
        <div className="fr2"><Fld label="Name *"><input className="inp" value={f.name} onChange={e=>s("name",e.target.value)}/></Fld><Fld label="Part No."><input className="inp" value={f.partNo} onChange={e=>s("partNo",e.target.value)}/></Fld></div>
        <div className="fr3"><Fld label="Category"><select className="sel" value={f.category} onChange={e=>s("category",e.target.value)}>{["Toner","Drum","Fuser","CCTV","PABX","Mechanical","Other"].map(c=><option key={c}>{c}</option>)}</select></Fld><Fld label="In Stock"><input className="inp" type="number" value={f.qty} onChange={e=>s("qty",+e.target.value)}/></Fld><Fld label="Min Qty"><input className="inp" type="number" value={f.minQty} onChange={e=>s("minQty",+e.target.value)}/></Fld></div>
        <div className="fr2"><Fld label="Unit Cost (R)"><input className="inp" type="number" step="0.01" value={f.unitCost} onChange={e=>s("unitCost",e.target.value)}/></Fld><Fld label="Supplier"><input className="inp" value={f.supplier} onChange={e=>s("supplier",e.target.value)}/></Fld></div>
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={savePart}>{editId?"Save":"Add"}</button><button className="btn bg2 bsm" onClick={()=>{setShowAdd(false);setEditId(null);}}>Cancel</button></div>
      </div>}
      <div className="sect">Inventory<span/></div>
      <div className="tw" style={{marginBottom:14}}>
        {filtered.length===0?<div className="empty"><div className="ei">📦</div><div>No parts</div></div>
          :<table><thead><tr><th>Name</th><th>P/N</th><th>Category</th><th>Stock</th><th>Min</th><th>Cost</th><th>Supplier</th><th></th></tr></thead>
          <tbody>{filtered.map(p=><tr key={p.id}>
            <td><div className="tt">{p.name}</div></td><td className="mono">{p.partNo||"—"}</td><td style={{fontSize:12,color:"var(--mu2)"}}>{p.category}</td>
            <td><span style={{fontFamily:"JetBrains Mono,monospace",fontWeight:800,fontSize:14,color:p.qty<=p.minQty?"var(--red)":"var(--grn)"}}>{p.qty}</span></td>
            <td style={{fontSize:12,color:"var(--mu)"}}>{p.minQty}</td><td style={{fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{p.unitCost?fmtR(p.unitCost):"—"}</td><td style={{fontSize:12,color:"var(--mu2)"}}>{p.supplier||"—"}</td>
            <td>{isCtrl&&<div style={{display:"flex",gap:4}}><button className="btn bg2 bxs" onClick={()=>startEdit(p)}>✏️</button><button className="btn bg2 bxs" onClick={async()=>await FS.set("parts",p.id,{...p,qty:p.qty+1})}>+1</button><button className="btn bd bxs" onClick={async()=>await FS.del("parts",p.id)}>✕</button></div>}</td>
          </tr>)}</tbody></table>}
      </div>
      <div className="sect">Parts on Tickets<span/></div>
      <div className="tw">
        {activeParts.length===0?<div className="empty"><div className="ei">🔧</div><div>No parts on tickets</div></div>
          :<table><thead><tr><th>Ticket</th><th>Part</th><th>Cost</th><th>Status</th><th>Ordered</th><th>Fitted</th><th></th></tr></thead>
          <tbody>{activeParts.map(p=><tr key={p.id}>
            <td className="mono" onClick={()=>onPartDetails(p)} style={{cursor:"pointer",textDecoration:"underline"}}>{p.tid}</td>
            <td onClick={()=>onPartDetails(p)} style={{cursor:"pointer",textDecoration:"underline"}}><div className="tt">{p.name}</div></td>
            <td style={{fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{p.unitCost?fmtR(p.unitCost):"—"}</td>
            <td><span className="bdg" style={{background:p.status==="Fitted"?"rgba(46,204,138,.12)":"rgba(251,146,60,.12)",color:p.status==="Fitted"?"var(--grn)":"var(--amb)"}}>{p.status}</span></td>
            <td className="mono">{p.ordered?fmtD(p.ordered):"—"}</td>
            <td className="mono">{p.fitted?fmtD(p.fitted):"—"}</td>
            <td>{isCtrl&&p.status==="Ordered"&&<button className="btn bgrn bxs" onClick={()=>onPartDetails(p)}>Details</button>}</td>
          </tr>)}</tbody></table>}
      </div>
    </>
  );
}

// ── YIELD PAGE ────────────────────────────────────────────────
function YieldPage({devices,clients,isCtrl,addDevEv,user}){
  const copiers=devices.filter(d=>d.type==="Copier");
  const [selId,setSelId]=useState(null);const [updM,setUpdM]=useState(null);const [np,setNp]=useState("");const [histM,setHistM]=useState(null);
  const sel=devices.find(d=>d.id===selId);
  async function savePages(){
    if(!np||!updM||!selId)return;
    const d=devices.find(x=>x.id===selId);if(!d)return;
    const newCons=(d.consumables||[]).map(c=>c.id===updM.id?{...c,currentPages:+np}:c);
    await FS.set("devices",selId,{consumables:newCons});
    await addDevEv(selId,{type:"meter_update",desc:`${updM.name} meter: ${Number(np).toLocaleString()} pages`,ts:nowISO()});
    setUpdM(null);setNp("");
  }
  async function addCons(){
    const name=prompt("Consumable name (e.g. Drum Unit, Toner (Black)):"); if(!name||!selId)return;
    const cap=CON_CAP[name]||10000;
    const d=devices.find(x=>x.id===selId);if(!d)return;
    const newCons=[...(d.consumables||[]),{id:uid(),name,currentPages:0,capacity:cap,installedDate:nowISO(),history:[]}];
    await FS.set("devices",selId,{consumables:newCons});
  }
  return(
    <>
      <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:12,height:"calc(100vh - 120px)"}}>
        <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:7}}>
          {copiers.length===0&&<div className="empty"><div className="ei">🖨️</div><div>No copiers added</div></div>}
          {copiers.map(d=>{const cl=clients.find(c=>c.id===d.clientId);const cons=d.consumables||[];const danger=cons.some(c=>c.currentPages/c.capacity>.85);return(
            <div key={d.id} className={`card ${selId===d.id?"sel":""}`} onClick={()=>setSelId(d.id)} style={{cursor:"pointer",borderLeft:danger?"3px solid var(--red)":undefined}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><div><div style={{fontWeight:700,fontSize:12}}>{d.brand} {d.model}</div><div style={{fontSize:10,color:"var(--mu)"}}>{cl?.name||"—"}</div></div>{danger&&<span>⚠️</span>}</div>
              {cons.slice(0,3).map(c=>{const pct=Math.min(c.currentPages/c.capacity,1);const col=pct>.9?"var(--red)":pct>.75?"var(--amb)":"var(--grn)";return(<div key={c.id} style={{marginBottom:3}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10}}><span style={{color:"var(--mu)"}}>{c.name}</span><span style={{color:col,fontFamily:"JetBrains Mono,monospace",fontWeight:700}}>{Math.round(pct*100)}%</span></div><div className="ybar"><div className="yfill" style={{width:`${pct*100}%`,background:col}}/></div></div>);})}
              {cons.length===0&&<div style={{fontSize:10,color:"var(--mu)"}}>No consumables</div>}
            </div>
          );})}
        </div>
        <div style={{overflowY:"auto"}}>
          {!sel?<div className="empty"><div className="ei">🖨️</div><div>Select a copier</div></div>:<>
            <div style={{marginBottom:12}}><div style={{fontSize:15,fontWeight:800}}>{sel.brand} {sel.model}</div><div style={{fontSize:12,color:"var(--mu2)",marginTop:2}}>{clients.find(c=>c.id===sel.clientId)?.name||"—"} · S/N: {sel.serial}</div>
              <div style={{display:"flex",gap:8,marginTop:9}}>{isCtrl&&<button className="btn bg2 bsm" onClick={addCons}>+ Add Consumable</button>}<button className="btn bg2 bsm" onClick={()=>setHistM(sel)}>📋 Device History</button></div>
            </div>
            {(sel.consumables||[]).length===0&&<div className="empty"><div className="ei">📊</div><div>Click "+ Add Consumable" to start</div></div>}
            {(sel.consumables||[]).map(c=>{
              const pct=Math.min(c.currentPages/c.capacity,1);const col=pct>.9?"var(--red)":pct>.75?"var(--amb)":"var(--grn)";
              const rem=c.capacity-c.currentPages;const age=Math.max(1,daysBetween(c.installedDate));const ppd=c.currentPages/age;const dl=ppd>0?Math.round(rem/ppd):null;
              const ew=checkEarly(c.name,c.currentPages,c.capacity);
              return(<div key={c.id} style={{background:"var(--s1)",border:`1px solid ${pct>.85?"rgba(240,80,96,.3)":"var(--rim)"}`,borderRadius:11,padding:"14px 16px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <div style={{fontWeight:700,fontSize:14}}>{c.name}</div>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}><span style={{fontFamily:"JetBrains Mono,monospace",fontWeight:800,fontSize:17,color:col}}>{Math.round(pct*100)}%</span>{isCtrl&&<button className="btn bg2 bxs" onClick={()=>{setUpdM(c);setNp(String(c.currentPages));}}>Update</button>}</div>
                </div>
                <div className="ybar" style={{height:7,margin:"5px 0 9px"}}><div className="yfill" style={{width:`${pct*100}%`,background:col}}/></div>
                <div className="dg3" style={{marginBottom:7}}>
                  {[{l:"Current",v:c.currentPages.toLocaleString()},{l:"Capacity",v:c.capacity.toLocaleString()},{l:"Remaining",v:rem.toLocaleString()},{l:"Installed",v:fmtD(c.installedDate)},{l:"Pg/Day",v:ppd.toFixed(0)},{l:"Days Left",v:dl!=null?dl+"d":"—"}].map(i=>(
                    <div key={i.l} className="di"><div className="dil">{i.l}</div><div className="div2" style={{fontFamily:"JetBrains Mono,monospace",fontSize:12,color:i.l==="Days Left"&&dl!=null&&dl<14?"var(--red)":"var(--tx)"}}>{i.v}</div></div>
                  ))}
                </div>
                {ew&&<div className="flag-box" style={{marginBottom:7}}>⚠️ Too soon for replacement — unit at {ew.pct}% yield. Service manual min: <strong>{ew.minPct}%</strong></div>}
                {(c.history||[]).length>0&&<div style={{marginTop:7}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--mu)",marginBottom:5}}>Replacement History</div>{(c.history||[]).map((h,i)=><div key={i} style={{fontSize:11,color:"var(--mu2)",padding:"4px 0",borderTop:"1px solid var(--rim)",display:"flex",justifyContent:"space-between"}}><span>Fitted {fmtD(h.fitted)}</span>{h.pagesBefore&&<span style={{color:"var(--mu)"}}>Yield: {Number(h.pagesBefore).toLocaleString()} pg</span>}</div>)}</div>}
              </div>);
            })}
          </>}
        </div>
      </div>
      {updM&&<div className="ov" onClick={e=>e.target===e.currentTarget&&setUpdM(null)}>
        <div className="modal sm"><div className="mhdr"><div className="mhdr-t">Update: {updM.name}</div><XBtn onClick={()=>setUpdM(null)}/></div>
          <div className="mbody"><Fld label="Current Page Count" hint="Read from machine meter"><input className="inp" type="number" value={np} onChange={e=>setNp(e.target.value)} autoFocus/></Fld>
            <div style={{fontSize:12,color:"var(--mu2)"}}>Capacity: {updM.capacity.toLocaleString()} · At {Math.round((+np||0)/updM.capacity*100)}% yield</div>
          </div>
          <div className="mfoot"><button className="btn bg2" onClick={()=>setUpdM(null)}>Cancel</button><button className="btn bp" onClick={savePages}>Update</button></div>
        </div>
      </div>}
      {histM&&<div className="ov" onClick={e=>e.target===e.currentTarget&&setHistM(null)}>
        <div className="modal"><div className="mhdr"><div><div className="mhdr-t">📋 {histM.brand} {histM.model} History</div><div className="mhdr-s">S/N: {histM.serial||"—"}</div></div><XBtn onClick={()=>setHistM(null)}/></div>
          <div className="mbody">{(histM.history||[]).length===0?<div className="empty"><div className="ei">📋</div><div>No history yet</div></div>
            :<div className="tl">{(histM.history||[]).map((h,i)=><div key={i} className="tl-row"><div className="tl-ic">{h.type==="part_fitted"?"⚙️":h.type==="part_ordered"?"📦":h.type==="ticket"?"🎫":h.type==="resolved"?"✅":h.type==="meter_update"?"📊":"➕"}</div><div><div className="tl-act">{h.desc}</div>{h.cost&&<div className="tl-note">Cost: {fmtR(h.cost)}</div>}{(h.colourReading||h.monoReading||h.colourLargeReading||h.monoLargeReading)&&<div style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:7,padding:"8px 10px",marginTop:6,fontSize:11}}>📊 <strong>Meter Readings:</strong> {h.colourReading&&`Colour: ${Number(h.colourReading).toLocaleString()}`}{h.colourReading&&h.monoReading?" · ":""}{h.monoReading&&`Mono: ${Number(h.monoReading).toLocaleString()}`}{(h.colourReading||h.monoReading)&&h.colourLargeReading?" · ":""}{h.colourLargeReading&&`Colour Large: ${Number(h.colourLargeReading).toLocaleString()}`}{(h.colourReading||h.monoReading||h.colourLargeReading)&&h.monoLargeReading?" · ":""}{h.monoLargeReading&&`Mono Large: ${Number(h.monoLargeReading).toLocaleString()}`}{h.distanceTravelled&&` · Distance: ${Number(h.distanceTravelled).toFixed(1)}km`}</div>}<div className="tl-ts">{fmt(h.ts)}</div></div></div>)}</div>}
          </div>
        </div>
      </div>}
    </>
  );
}

// ── CLIENTS PAGE ──────────────────────────────────────────────
function ClientsPage({clients,devices,tickets,isCtrl,slaMeta}){
  const [sel,setSel]=useState(null);const [showForm,setShowForm]=useState(false);const [editId,setEditId]=useState(null);
  const [q,setQ]=useState("");
  const [f,setF]=useState({name:"",contactName:"",email:"",phone:"",address:"",hasSLA:true,sla:"Silver",walkIn:false,vatNumber:""});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const filtered=clients.filter(c=>!q||c.name.toLowerCase().includes(q.toLowerCase())||c.contactName?.toLowerCase().includes(q.toLowerCase())||c.email?.toLowerCase().includes(q.toLowerCase()));
  
  async function save(){
    if(!f.name.trim())return;
    const id=editId||("cl"+uid());
    await FS.set("clients",id,{...f,id});
    setShowForm(false);setEditId(null);
  }
  function startEdit(c){setF({name:c.name,contactName:c.contactName||c.contact||"",email:c.email,phone:c.phone,address:c.address||"",hasSLA:c.hasSLA,sla:c.sla,walkIn:c.walkIn,vatNumber:c.vatNumber||""});setEditId(c.id);setShowForm(true);}
  
  return(
    <>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <div className="sw"><span className="sic">🔍</span><input className="sinp" placeholder="Search clients…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {isCtrl&&<><button className="btn bg2 bsm" onClick={()=>{setF({name:"",contactName:"",email:"",phone:"",address:"",hasSLA:false,sla:"None",walkIn:true,vatNumber:""});setEditId(null);setShowForm(true);}}>+ Walk-in</button>
        <button className="btn bp bsm" onClick={()=>{setF({name:"",contactName:"",email:"",phone:"",address:"",hasSLA:true,sla:"Silver",walkIn:false,vatNumber:""});setEditId(null);setShowForm(true);}}>+ Add Client</button></>}
      </div>
      {showForm&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:14,marginBottom:12,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontWeight:700,fontSize:14}}>{editId?"Edit Client":f.walkIn?"Walk-in Client":"Add Client"}</div>
        <div className="fr2"><Fld label="Company / Name *"><input className="inp" value={f.name} onChange={e=>s("name",e.target.value)}/></Fld><Fld label="Contact Name"><input className="inp" value={f.contactName} onChange={e=>s("contactName",e.target.value)} placeholder="Primary contact person"/></Fld></div>
        <div className="fr2"><Fld label="Email"><input className="inp" type="email" value={f.email} onChange={e=>s("email",e.target.value)}/></Fld><Fld label="Phone"><input className="inp" value={f.phone} onChange={e=>s("phone",e.target.value)}/></Fld></div>
        <Fld label="Address"><textarea className="ta" style={{minHeight:60}} value={f.address} onChange={e=>s("address",e.target.value)} placeholder={"Street address, Suburb, City, Province, Postal Code"}/></Fld>
        <div className="fr2"><Fld label="VAT Number (Optional)"><input className="inp" value={f.vatNumber} onChange={e=>s("vatNumber",e.target.value)} placeholder="e.g., 4812345678" maxLength="10"/></Fld></div>
        <div style={{display:"flex",gap:20}}><Tgl on={f.walkIn} onChange={v=>s("walkIn",v)} label="Walk-in"/><Tgl on={f.hasSLA} onChange={v=>s("hasSLA",v)} label="Has SLA"/></div>
        {f.hasSLA&&<><Fld label="SLA Tier"><select className="sel" value={f.sla} onChange={e=>s("sla",e.target.value)}><option>None</option>{SLA_TIERS.map(t=><option key={t}>{t}</option>)}</select></Fld>
        {f.sla!=="None"&&<div style={{background:"var(--s2)",borderRadius:8,padding:"9px 12px",fontSize:12}}><SlaBdg t={f.sla} sm={slaMeta}/> · Response: <strong>{slaMeta[f.sla]?.respH}h</strong> · Resolution: <strong>{slaMeta[f.sla]?.resH}h</strong></div>}</>}
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={save}>{editId?"Save":"Add"}</button><button className="btn bg2 bsm" onClick={()=>{setShowForm(false);setEditId(null);}}>Cancel</button></div>
      </div>}
      {filtered.length===0?<div className="empty"><div className="ei">🏢</div><div>No clients yet</div></div>
        :<div className="cg">{filtered.map(c=>{const cDevs=devices.filter(d=>d.clientId===c.id);const openT=tickets.filter(t=>t.clientId===c.id&&!["Closed"].includes(t.status)).length;return(
          <div key={c.id} className={`card ${sel===c.id?"sel":""}`} onClick={()=>setSel(sel===c.id?null:c.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:9}}>
              <div><div style={{fontWeight:700,fontSize:13}}>{c.name}{c.walkIn&&<span className="bdg" style={{background:"rgba(240,160,48,.13)",color:"var(--amb)",fontSize:9,padding:"1px 5px",marginLeft:5}}>Walk-in</span>}</div><div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>{c.contactName||c.contact||"—"}</div></div>
              {c.hasSLA&&c.sla!=="None"?<SlaBdg t={c.sla} sm={slaMeta}/>:<span className="bdg" style={{background:"var(--s3)",color:"var(--mu)"}}>No SLA</span>}
            </div>
            {c.email&&<div className="crow"><span className="crl">Email</span><span className="crv" style={{fontSize:11}}>{c.email}</span></div>}
            {c.phone&&<div className="crow"><span className="crl">Phone</span><span className="crv">{c.phone}</span></div>}
            {c.vatNumber&&<div className="crow"><span className="crl">VAT</span><span className="crv">{c.vatNumber}</span></div>}
            {c.address&&<div className="crow" style={{alignItems:"flex-start"}}><span className="crl">Address</span><span className="crv" style={{fontSize:11,whiteSpace:"pre-line",textAlign:"right",maxWidth:200}}>{c.address}</span></div>}
            <div className="crow"><span className="crl">Devices</span><span className="crv">{cDevs.length}</span></div>
            <div className="crow"><span className="crl">Active Tickets</span><span className="crv" style={{color:openT>0?"var(--amb)":"var(--grn)"}}>{openT}</span></div>
            {c.hasSLA&&c.sla!=="None"&&<div className="crow"><span className="crl">Resp / Res.</span><span className="crv">{slaMeta[c.sla]?.respH}h / {slaMeta[c.sla]?.resH}h</span></div>}
            {sel===c.id&&isCtrl&&<div className="cacts" onClick={e=>e.stopPropagation()}><button className="btn bg2 bxs" onClick={()=>startEdit(c)}>✏️ Edit</button><button className="btn bd bxs" style={{marginLeft:"auto"}} onClick={async()=>{await FS.del("clients",c.id);setSel(null);}}>Delete</button></div>}
          </div>
        );})}
        </div>}
    </>
  );
}

// ── DEVICES PAGE ──────────────────────────────────────────────
function DevicesPage({devices,clients,tickets,isCtrl,addDevEv}){
  const [tab,setTab]=useState("All");const [showForm,setShowForm]=useState(false);const [editId,setEditId]=useState(null);
  const [q,setQ]=useState("");
  const [f,setF]=useState({clientId:"",type:"Copier",brand:"",model:"",serial:"",location:"",sla:"Silver"});
  const [histM,setHistM]=useState(null); const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const list=tab==="All"?devices:devices.filter(d=>d.type===tab);
  const filtered=list.filter(d=>!q||d.brand.toLowerCase().includes(q.toLowerCase())||d.model.toLowerCase().includes(q.toLowerCase())||d.serial?.toLowerCase().includes(q.toLowerCase()));
  const openT=id=>tickets.filter(t=>t.deviceId===id&&!["Closed"].includes(t.status)).length;
  const selClient=clients.find(c=>c.id===f.clientId);

  function pickClient(id){
    const cl=clients.find(c=>c.id===id);
    setF(p=>({...p,clientId:id,sla:cl?.hasSLA&&cl?.sla&&cl?.sla!=="None"?cl.sla:p.sla}));
  }

  async function saveDev(){
    if(!f.clientId||!f.brand.trim()||!f.model.trim())return;
    const id=editId||("dv"+uid());
    await FS.set("devices",id,{...f,id,...(editId?{}:{consumables:[],history:[{type:"added",desc:"Device added",ts:nowISO()}]})});
    setShowForm(false);setEditId(null);
  }
  function startEdit(d){setF({clientId:d.clientId,type:d.type,brand:d.brand,model:d.model,serial:d.serial,location:d.location,sla:d.sla});setEditId(d.id);setShowForm(true);}
  
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div className="tabs" style={{marginBottom:0}}>{["All","IT","Copier","CCTV","PABX"].map(t=><button key={t} className={`tab ${tab===t?"on":""}`} onClick={()=>setTab(t)}>{t}</button>)}</div>
        <div className="sw"><span className="sic">🔍</span><input className="sinp" placeholder="Search devices…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {isCtrl&&<button className="btn bp bsm" onClick={()=>{setF({clientId:"",type:"Copier",brand:"",model:"",serial:"",location:"",sla:"Silver"});setEditId(null);setShowForm(true);}}>+ Add Device</button>}
      </div>
      {showForm&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:14,marginBottom:12,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontWeight:700,fontSize:14}}>{editId?"Edit Device":"Add Device"}</div>
        <div className="fr2">
          <Fld label="Client *">
            <select className="sel" value={f.clientId} onChange={e=>pickClient(e.target.value)}>
              <option value="">— Select —</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.walkIn?" (Walk-in)":""}</option>)}
            </select>
          </Fld>
          <Fld label="Type"><select className="sel" value={f.type} onChange={e=>s("type",e.target.value)}>{TICKET_TYPES.map(t=><option key={t}>{t}</option>)}</select></Fld>
        </div>
        {f.clientId&&<div style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:8,padding:"9px 13px",fontSize:12,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontWeight:600}}>Client SLA:</span>
          {selClient?.hasSLA&&selClient?.sla&&selClient?.sla!=="None"
            ?<><span style={{color:"var(--acc)",fontWeight:700}}>★ {selClient.sla}</span><span style={{color:"var(--mu2)"}}> · Response: {INIT_SLA[selClient.sla]?.respH||"—"}h · Resolution: {INIT_SLA[selClient.sla]?.resH||"—"}h</span></>
            :<span style={{color:"var(--mu)"}}>No SLA</span>}
          {selClient?.vatNumber&&<span style={{marginLeft:"auto",color:"var(--mu)",fontSize:11}}>VAT: {selClient.vatNumber}</span>}
        </div>}
        <div className="fr2"><Fld label="Brand *"><input className="inp" value={f.brand} onChange={e=>s("brand",e.target.value)}/></Fld><Fld label="Model *"><input className="inp" value={f.model} onChange={e=>s("model",e.target.value)}/></Fld></div>
        <div className="fr3">
          <Fld label="Serial"><input className="inp" value={f.serial} onChange={e=>s("serial",e.target.value)}/></Fld>
          <Fld label="Device SLA Override">
            <select className="sel" value={f.sla} onChange={e=>s("sla",e.target.value)}>
              <option value="None">None</option>
              {SLA_TIERS.map(t=><option key={t}>{t}</option>)}
            </select>
          </Fld>
          <Fld label="Location"><input className="inp" value={f.location} onChange={e=>s("location",e.target.value)}/></Fld>
        </div>
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={saveDev}>{editId?"Save":"Add"}</button><button className="btn bg2 bsm" onClick={()=>{setShowForm(false);setEditId(null);}}>Cancel</button></div>
      </div>}
      <div className="tw">
        {filtered.length===0?<div className="empty"><div className="ei">🖥️</div><div>No devices</div></div>
          :<table><thead><tr><th>Brand / Model</th><th>Type</th><th>Client</th><th>SLA</th><th>Location</th><th>Serial</th><th>Open</th><th></th></tr></thead>
          <tbody>{filtered.map(d=>{const cl=clients.find(c=>c.id===d.clientId);const ot=openT(d.id);return(<tr key={d.id}>
            <td><div className="tt">{d.brand} {d.model}</div></td><td><TypeBdg t={d.type}/></td>
            <td style={{fontSize:12}}>{cl?.name||"—"}</td>
            <td><SlaBdg t={d.sla} sm={INIT_SLA}/></td>
            <td style={{fontSize:12,color:"var(--mu2)"}}>{d.location||"—"}</td><td className="mono">{d.serial||"—"}</td>
            <td><span style={{color:ot>0?"var(--amb)":"var(--grn)",fontWeight:700}}>{ot}</span></td>
            <td><div style={{display:"flex",gap:4}}><button className="btn bg2 bxs" onClick={()=>setHistM(d)}>📋</button>{isCtrl&&<button className="btn bg2 bxs" onClick={()=>startEdit(d)}>✏️</button>}{isCtrl&&<button className="btn bd bxs" onClick={async()=>await FS.del("devices",d.id)}>✕</button>}</div></td>
          </tr>);})}
          </tbody></table>}
      </div>
      {histM&&<div className="ov" onClick={e=>e.target===e.currentTarget&&setHistM(null)}>
        <div className="modal"><div className="mhdr"><div><div className="mhdr-t">📋 {histM.brand} {histM.model}</div><div className="mhdr-s">S/N: {histM.serial||"—"}</div></div><XBtn onClick={()=>setHistM(null)}/></div>
          <div className="mbody">{(histM.history||[]).length===0?<div className="empty"><div className="ei">📋</div><div>No history</div></div>:<div className="tl">{(histM.history||[]).map((h,i)=><div key={i} className="tl-row"><div className="tl-ic">{h.type==="part_fitted"?"⚙️":h.type==="part_ordered"?"📦":h.type==="ticket"?"🎫":h.type==="resolved"?"✅":h.type==="meter_update"?"📊":"➕"}</div><div><div className="tl-act">{h.desc}</div>{h.cost&&<div className="tl-note">Cost: {fmtR(h.cost)}</div>}{(h.colourReading||h.monoReading||h.colourLargeReading||h.monoLargeReading)&&<div style={{background:"var(--s2)",border:"1px solid var(--rim)",borderRadius:7,padding:"8px 10px",marginTop:6,fontSize:11}}>📊 <strong>Meter Readings:</strong> {h.colourReading&&`Colour: ${Number(h.colourReading).toLocaleString()}`}{h.colourReading&&h.monoReading?" · ":""}{h.monoReading&&`Mono: ${Number(h.monoReading).toLocaleString()}`}{(h.colourReading||h.monoReading)&&h.colourLargeReading?" · ":""}{h.colourLargeReading&&`Colour Large: ${Number(h.colourLargeReading).toLocaleString()}`}{(h.colourReading||h.monoReading||h.colourLargeReading)&&h.monoLargeReading?" · ":""}{h.monoLargeReading&&`Mono Large: ${Number(h.monoLargeReading).toLocaleString()}`}{h.distanceTravelled&&` · Distance: ${Number(h.distanceTravelled).toFixed(1)}km`}</div>}<div className="tl-ts">{fmt(h.ts)}</div></div></div>)}</div>}
          </div>
        </div>
      </div>}
    </>
  );
}

// ── TEAM PAGE ─────────────────────────────────────────────────
function TeamPage({users,addUser,tickets}){
  const [showForm,setShowForm]=useState(false);const [editId,setEditId]=useState(null);
  const [f,setF]=useState({name:"",role:ROLES.TECHNICIAN,spec:"IT Support",email:"",phone:"",color:AV_COLS[0],tempPassword:""});
  const [busy,setBusy]=useState(false);const [err,setErr]=useState("");
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const nonMgr=users.filter(u=>u.role!==ROLES.MANAGER);
  async function save(){
    if(!f.name.trim()||!f.email.trim()){alert("Name and email are required.");return;}
    setBusy(true);setErr("");
    if(editId){
      const av=f.name.trim().split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
      await FS.set("users",editId,{...users.find(u=>u.id===editId),...f,avatar:av});
      setEditId(null);
    } else {
      if(!f.tempPassword||f.tempPassword.length<6){setErr("Password must be at least 6 characters.");setBusy(false);return;}
      const res=await addUser(f);
      if(!res.ok){setErr(res.error);setBusy(false);return;}
    }
    setShowForm(false);setF({name:"",role:ROLES.TECHNICIAN,spec:"IT Support",email:"",phone:"",color:AV_COLS[0],tempPassword:""});
    setBusy(false);
  }
  function startEdit(u){setF({name:u.name,role:u.role,spec:u.spec||"",email:u.email,phone:u.phone||"",color:u.color,tempPassword:""});setEditId(u.id);setShowForm(true);}
  const stats=u=>{const res=tickets.filter(t=>t.techId===u.id&&["Resolved","Closed"].includes(t.status));const opn=tickets.filter(t=>t.techId===u.id&&!["Closed"].includes(t.status)).length;const ftf=res.length?Math.round(res.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/res.length*100):null;return{res:res.length,opn,ftf};};
  return(
    <>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><button className="btn bp bsm" onClick={()=>{setF({name:"",role:ROLES.TECHNICIAN,spec:"IT Support",email:"",phone:"",color:AV_COLS[0],tempPassword:""});setEditId(null);setShowForm(true);}}>+ Add User</button></div>
      {showForm&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:14,marginBottom:12,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontWeight:700,fontSize:14}}>{editId?"Edit User":"Add User"}</div>
        {err&&<div className="err-box">{err}</div>}
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div className="av" style={{width:42,height:42,borderRadius:11,background:f.color,fontSize:14}}>{f.name.trim().split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||"?"}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{AV_COLS.map(c=><div key={c} onClick={()=>s("color",c)} style={{width:22,height:22,borderRadius:6,background:c,cursor:"pointer",border:`2px solid ${f.color===c?"#fff":"transparent"}`}}/>)}</div>
        </div>
        <div className="fr2"><Fld label="Full Name *"><input className="inp" value={f.name} onChange={e=>s("name",e.target.value)}/></Fld><Fld label="Role"><select className="sel" value={f.role} onChange={e=>s("role",e.target.value)}><option value={ROLES.TECHNICIAN}>Technician</option><option value={ROLES.CONTROLLER}>Controller</option></select></Fld></div>
        {f.role===ROLES.TECHNICIAN&&<Fld label="Specialisation"><select className="sel" value={f.spec} onChange={e=>s("spec",e.target.value)}>{TECH_SPECS.map(x=><option key={x}>{x}</option>)}</select></Fld>}
        <div className="fr2"><Fld label="Email *"><input className="inp" type="email" value={f.email} onChange={e=>s("email",e.target.value)} disabled={!!editId}/></Fld><Fld label="Phone"><input className="inp" value={f.phone} onChange={e=>s("phone",e.target.value)}/></Fld></div>
        {!editId&&<Fld label="Temporary Password *" hint="Min 6 chars. User will receive a password reset email."><input className="inp" type="password" value={f.tempPassword} onChange={e=>s("tempPassword",e.target.value)}/></Fld>}
        {!editId&&<div style={{fontSize:11,color:"var(--mu)",background:"var(--s2)",borderRadius:7,padding:"8px 10px"}}>🔐 A Firebase account will be created and a password reset email sent to the user automatically.</div>}
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={save} disabled={busy}>{busy?"Saving…":editId?"Save":"Add User"}</button><button className="btn bg2 bsm" onClick={()=>{setShowForm(false);setEditId(null);setErr("");}}>Cancel</button></div>
      </div>}
      {nonMgr.length===0?<div className="empty"><div className="ei">👷</div><div>No team members yet</div></div>
        :<div className="cg">{nonMgr.map(u=>{const{res,opn,ftf}=stats(u);return(
          <div key={u.id} className="card">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}><Av u={u} sz={38}/><div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{u.name}</div><div style={{marginTop:3}}><RolBdg r={u.role}/></div></div><span className="bdg" style={{background:u.active?"rgba(46,204,138,.12)":"rgba(107,114,128,.12)",color:u.active?"var(--grn)":"var(--mu)",fontSize:10}}>{u.active?"Active":"Inactive"}</span></div>
            {u.spec&&<div className="crow"><span className="crl">Spec</span><span className="crv">{u.spec}</span></div>}
            {u.email&&<div className="crow"><span className="crl">Email</span><span className="crv" style={{fontSize:11}}>{u.email}</span></div>}
            {u.phone&&<div className="crow"><span className="crl">Phone</span><span className="crv">{u.phone}</span></div>}
            <div className="crow"><span className="crl">Open Calls</span><span className="crv" style={{color:opn>0?"var(--amb)":"var(--grn)"}}>{opn}</span></div>
            <div className="crow"><span className="crl">Resolved</span><span className="crv">{res}</span></div>
            {ftf!=null&&<div className="crow"><span className="crl">FTF Rate</span><span className="crv" style={{color:"var(--acc)"}}>{ftf}%</span></div>}
            <div className="cacts">
              <button className="btn bg2 bxs" onClick={()=>startEdit(u)}>✏️ Edit</button>
              <button className="btn bg2 bxs" onClick={async()=>await FS.set("users",u.id,{...u,active:!u.active})}>{u.active?"Deactivate":"Activate"}</button>
              <button className="btn bd bxs" style={{marginLeft:"auto"}} onClick={async()=>await FS.del("users",u.id)}>Remove</button>
            </div>
          </div>
        );})}
        </div>}
    </>
  );
}

// ── PERFORMANCE PAGE ──────────────────────────────────────────
function PerformancePage({tickets,users,settings}){
  const techs=users.filter(u=>u.role===ROLES.TECHNICIAN);const days=settings?.comebackDays||30;
  const ranked=techs.map(u=>{
    const my=tickets.filter(t=>t.techId===u.id);
    const res=my.filter(t=>["Resolved","Closed"].includes(t.status));
    const opn=my.filter(t=>!["Closed"].includes(t.status)).length;
    const ftf=res.length?Math.round(res.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/res.length*100):0;
    const mttr=res.length?(res.reduce((s,t)=>s+daysBetween(t.createdAt,t.resolvedAt||nowISO()),0)/res.length).toFixed(1):"—";
    const cb=my.filter(t=>t.isComeback).length;const cbRate=my.length?Math.round(cb/Math.max(1,my.length)*100):0;
    const score=ftf-(cbRate*2)-(parseFloat(mttr)||0)*2;
    return{...u,opn,res:res.length,ftf,mttr,cb,cbRate,score};
  }).sort((a,b)=>b.score-a.score);
  return(
    <>
      <div style={{marginBottom:12,fontSize:12,color:"var(--mu2)",background:"var(--s2)",borderRadius:8,padding:"9px 12px"}}>🏆 Score = FTF% − (Comeback% × 2) − MTTR×2 &nbsp;·&nbsp; Comeback window: {days} days</div>
      {ranked.length===0&&<div className="empty"><div className="ei">👷</div><div>No technicians added yet</div></div>}
      {ranked.map((u,i)=>{const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":"";return(
        <div key={u.id} style={{background:"var(--s1)",border:`1px solid ${i===0?"rgba(245,197,24,.3)":"var(--rim)"}`,borderRadius:11,padding:"14px 16px",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <div style={{fontSize:20,width:28,textAlign:"center"}}>{medal||<span style={{fontSize:13,color:"var(--mu)",fontFamily:"JetBrains Mono,monospace"}}>#{i+1}</span>}</div>
            <Av u={u} sz={38}/><div style={{flex:1}}><div style={{fontSize:14,fontWeight:700}}>{u.name}</div><div style={{fontSize:11,color:"var(--mu2)",marginTop:1}}><RolBdg r={u.role}/>{u.spec&&` · ${u.spec}`}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:800,fontFamily:"JetBrains Mono,monospace",color:i===0?"var(--amb)":i===1?"#aaa":i===2?"#cd7f32":"var(--mu)"}}>{u.score.toFixed(0)}</div><div style={{fontSize:9,color:"var(--mu)"}}>SCORE</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:7,marginBottom:8}}>
            {[{l:"Open",v:u.opn,c:"var(--blue)"},{l:"Resolved",v:u.res,c:"var(--grn)"},{l:"FTF %",v:u.ftf+"%",c:u.ftf>=80?"var(--grn)":u.ftf>=50?"var(--amb)":"var(--red)"},{l:"MTTR",v:u.mttr+(u.mttr!=="—"?"d":""),c:"var(--mu2)"},{l:"Comebacks",v:u.cb,c:u.cb>0?"var(--red)":"var(--grn)"}].map(k=>(
              <div key={k.l} className="di"><div className="dil">{k.l}</div><div className="div2" style={{color:k.c,fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{k.v}</div></div>
            ))}
          </div>
          <div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--mu)",marginBottom:3}}><span>FTF Rate</span><span>{u.ftf}%</span></div><div className="kpi-bar"><div className="kpi-fill" style={{width:`${u.ftf}%`,background:u.ftf>=80?"var(--grn)":u.ftf>=50?"var(--amb)":"var(--red)"}}/></div></div>
          {u.cbRate>0&&<div style={{marginTop:7,fontSize:11,color:"var(--red)"}}>⚠ Comeback rate: {u.cbRate}% — {u.cb} job{u.cb!==1?"s":""} returned within {days} days</div>}
        </div>
      );})}
    </>
  );
}

// ── STATS PAGE ────────────────────────────────────────────────
function StatsPage({tickets,clients,users,slaMeta}){
  const res=tickets.filter(t=>["Resolved","Closed"].includes(t.status));
  const ftf=res.length?Math.round(res.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/res.length*100):0;
  const mttr=res.length?(res.reduce((s,t)=>s+daysBetween(t.createdAt,t.resolvedAt||nowISO()),0)/res.length).toFixed(1):"—";
  const breached=tickets.filter(t=>{const cl=clients.find(c=>c.id===t.clientId);if(!cl?.hasSLA||t.resolvedAt)return false;return parseFloat(hoursSince(t.createdAt))>(slaMeta[cl.sla]?.respH||24);});
  const cb=tickets.filter(t=>t.isComeback).length;
  const cost=tickets.reduce((s,t)=>s+((t.parts||[]).filter(p=>p.status==="Fitted").reduce((s2,p)=>s2+(+p.unitCost||0)*p.qty,0)),0);
  return(
    <>
      <div className="sg">
        {[{n:tickets.length,l:"Total",c:"var(--blue)"},{n:res.length,l:"Resolved",c:"var(--grn)"},{n:ftf+"%",l:"FTF",c:"var(--acc)"},{n:mttr+"d",l:"MTTR",c:"var(--amb)"},{n:breached.length,l:"SLA Breach",c:"var(--red)"},{n:cb,l:"Comebacks",c:"var(--red)"},{n:fmtR(cost),l:"Parts Cost",c:"var(--mu2)"}].map(s=>(
          <div className="sc" key={s.l}><div className="sc-n" style={{color:s.c,fontSize:s.l==="Parts Cost"?13:20}}>{s.n}</div><div className="sc-l">{s.l}</div></div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:13}}>
          <div className="sect" style={{marginBottom:10}}>By Type<span/></div>
          {["IT","Copier","CCTV","PABX"].map(t=>{const all=tickets.filter(x=>x.type===t);const r2=all.filter(x=>["Resolved","Closed"].includes(x.status));const c=TYPE_C[t];return(<div key={t} style={{marginBottom:9}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><TypeBdg t={t}/><span style={{fontFamily:"JetBrains Mono,monospace",fontWeight:800,color:c}}>{all.length}</span></div><div className="ybar"><div className="yfill" style={{width:all.length?`${r2.length/all.length*100}%`:"0%",background:c}}/></div><div style={{fontSize:10,color:"var(--mu)",marginTop:1}}>{all.filter(x=>["Open","Assigned","Accepted","In Progress"].includes(x.status)).length} active · {r2.length} resolved</div></div>);})}</div>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:10,padding:13}}>
          <div className="sect" style={{marginBottom:10}}>Tech KPIs<span/></div>
          {users.filter(u=>u.role===ROLES.TECHNICIAN).length===0&&<div style={{fontSize:12,color:"var(--mu)"}}>No technicians yet</div>}
          {users.filter(u=>u.role===ROLES.TECHNICIAN).map(u=>{const r2=tickets.filter(t=>t.techId===u.id&&["Resolved","Closed"].includes(t.status));const opn=tickets.filter(t=>t.techId===u.id&&!["Closed"].includes(t.status)).length;const ftf2=r2.length?Math.round(r2.filter(t=>t.resolvedAt&&daysBetween(t.createdAt,t.resolvedAt)===0).length/r2.length*100):0;const cb2=tickets.filter(t=>t.techId===u.id&&t.isComeback).length;return(<div key={u.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><Av u={u} sz={26}/><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{u.name}</div><div style={{fontSize:10,color:"var(--mu)",fontFamily:"JetBrains Mono,monospace"}}>{opn} open · {r2.length} res · FTF {r2.length?ftf2+"%":"—"} · CB {cb2}</div></div></div>);})}</div>
      </div>
      {breached.length>0&&<><div className="sect">SLA Breached<span/></div><div className="tw"><table><thead><tr><th>ID</th><th>Title</th><th>Client</th><th>SLA</th><th>Hours Open</th></tr></thead><tbody>{breached.map(t=>{const cl=clients.find(c=>c.id===t.clientId);return(<tr key={t.id}><td className="mono">{t.id}</td><td><div className="tt">{t.title}</div></td><td style={{fontSize:12}}>{cl?.name||"—"}</td><td><SlaBdg t={cl?.sla} sm={slaMeta}/></td><td><span style={{color:"var(--red)",fontFamily:"JetBrains Mono,monospace",fontWeight:700}}>{hoursSince(t.createdAt)}h</span></td></tr>);})}</tbody></table></div></>}
    </>
  );
}

// ── SETTINGS PAGE ─────────────────────────────────────────────
function SettingsPage({settings,saveSettings}){
  const [sla,setSla]=useState(settings.sla||INIT_SLA);
  const [cd,setCd]=useState(settings?.comebackDays||30);
  const [saved,setSaved]=useState(false);
  async function save(){await saveSettings({...settings,sla,comebackDays:+cd});setSaved(true);setTimeout(()=>setSaved(false),2500);}
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:560}}>
      <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:11,padding:"16px 18px"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🔁 Comeback Window</div>
        <div style={{fontSize:12,color:"var(--mu2)",marginBottom:10}}>Calls are flagged as a comeback if the same device serial had a resolved ticket within this many days.</div>
        <Fld label="Days" hint="Recommended: 14–60 days"><input className="inp" type="number" min={1} max={365} value={cd} onChange={e=>setCd(e.target.value)} style={{maxWidth:120}}/></Fld>
      </div>
      <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:11,padding:"16px 18px"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>⬡ SLA Response & Resolution Times</div>
        <div style={{fontSize:12,color:"var(--mu2)",marginBottom:12}}>Set target times per SLA tier. These affect breach calculations throughout the app.</div>
        {SLA_TIERS.map(tier=>{const m=sla[tier]||INIT_SLA[tier];return(
          <div key={tier} style={{marginBottom:12,padding:"12px 13px",background:"var(--s2)",border:`1px solid ${m.color}33`,borderRadius:9,borderLeft:`3px solid ${m.color}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}><SlaBdg t={tier} sm={sla}/><span style={{fontWeight:600,fontSize:13}}>{tier}</span></div>
            <div className="fr2">
              <Fld label="Response (hours)"><input className="inp" type="number" min={1} value={m.respH} onChange={e=>setSla(p=>({...p,[tier]:{...m,respH:+e.target.value}}))}/></Fld>
              <Fld label="Resolution (hours)"><input className="inp" type="number" min={1} value={m.resH} onChange={e=>setSla(p=>({...p,[tier]:{...m,resH:+e.target.value}}))}/></Fld>
            </div>
            <div style={{fontSize:11,color:"var(--mu)",marginTop:5}}>Response: {m.respH}h · Resolution: {m.resH}h ({(m.resH/24).toFixed(1)} days)</div>
          </div>
        );})}
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <button className="btn bp" onClick={save}>Save Settings</button>
        {saved&&<span style={{fontSize:12,color:"var(--grn)"}}>✓ Saved to Firebase</span>}
      </div>
    </div>
  );
}


// ── BILLING PAGE ──────────────────────────────────────────────

function BillingPage({invoices, setInvoices, tickets, clients, users, profile, isCtrl, isMgr}) {
  const [tab, setTab] = useState("invoices");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [paymentFilter, setPaymentFilter] = useState("All");
  
  const [f, setF] = useState({ticketId: "", clientId: "", lineItems: [], labourHours: 0, labourRate: 950, travelKm: 0, travelRate: 15, subtotal: 0, discount: 0, tax: 0, total: 0, status: "Draft", notes: "", dueDate: "", paymentTerms: 30, paidDate: "", deliveryDate: ""});
  const s = (k, v) => setF(p => ({...p, [k]: v}));
  const generateInvoiceNumber = () => {const now = new Date(); const yr = now.getFullYear(); const mo = String(now.getMonth() + 1).padStart(2, "0"); const seq = String(invoices.filter(i => i.number?.startsWith(`INV-${yr}-${mo}`)).length + 1).padStart(4, "0"); return `INV-${yr}-${mo}-${seq}`;};
  const calculateTotals = () => {let sub = 0; f.lineItems.forEach(li => { sub += (li.qty || 0) * (li.rate || 0); }); sub += (f.labourHours || 0) * (f.labourRate || 950); sub += (f.travelKm || 0) * (f.travelRate || 15); const disc = f.discount || 0; const subtotal = Math.max(0, sub - disc); const taxAmt = subtotal * 0.15; const total = subtotal + taxAmt; return { subtotal, discount: disc, tax: taxAmt, total };};
  const totals = calculateTotals();
  async function saveInvoice() {if (!f.clientId || (f.lineItems.length === 0 && f.labourHours === 0 && f.travelKm === 0)) {alert("Select client and add items"); return;} const invNum = editId ? invoices.find(i => i.id === editId)?.number : generateInvoiceNumber(); const invData = {...f, id: editId || uid(), number: invNum, createdBy: profile.id, createdAt: editId ? invoices.find(i => i.id === editId)?.createdAt : nowISO(), updatedAt: nowISO(), ...totals}; await FS.set("invoices", invData.id, invData); setShowForm(false); setEditId(null); resetForm();}
  const markAsPaid = async (invId) => {const inv = invoices.find(i => i.id === invId); if (inv) {await FS.set("invoices", invId, {...inv, status: "Paid", paidDate: nowISO()});}};
  const markAsDelivered = async (invId) => {const inv = invoices.find(i => i.id === invId); if (inv) {await FS.set("invoices", invId, {...inv, deliveryDate: nowISO()});}};
  const resetForm = () => setF({ticketId: "", clientId: "", lineItems: [], labourHours: 0, labourRate: 950, travelKm: 0, travelRate: 15, subtotal: 0, discount: 0, tax: 0, total: 0, status: "Draft", notes: "", dueDate: "", paymentTerms: 30, paidDate: "", deliveryDate: ""});
  const generateInvoicePDF = (inv) => {const client = clients.find(c => c.id === inv.clientId); const html = `<div style="font-family:'Segoe UI',Arial;padding:20px;background:#fff"><div style="border-left:5px solid #0044ff;padding:15px 20px;margin-bottom:30px;background:#f8f9ff"><div style="font-size:28px;font-weight:700;color:#0044ff">INVOICE</div><div style="color:#666;margin-top:5px">Professional Service Invoice</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px"><div><div style="font-weight:600;color:#333;margin-bottom:5px">FROM</div><div style="font-weight:700;font-size:16px">IntelliSupport</div><div style="color:#666;font-size:14px">Field Service Management</div></div><div style="text-align:right"><div style="font-weight:600;color:#333;margin-bottom:5px">INVOICE #</div><div style="font-weight:700;font-size:18px;color:#0044ff">${inv.number}</div><div style="color:#666;font-size:13px;margin-top:5px"><div>Date: ${fmtD(inv.createdAt)}</div><div>Due: ${fmtD(inv.dueDate||new Date(new Date(inv.createdAt).getTime()+inv.paymentTerms*86400000).toISOString())}</div></div></div></div><div style="background:#f5f7fa;padding:15px;border-radius:8px;margin-bottom:30px"><div style="font-weight:600;color:#333;margin-bottom:10px">BILL TO</div><div style="font-size:15px;font-weight:700">${client?.name}</div><div style="color:#666;font-size:14px;margin-top:5px"><div>${client?.contactName||"—"}</div><div>${client?.email||"—"}</div><div>${client?.phone||"—"}</div>${client?.vatNumber?`<div>VAT: ${client.vatNumber}</div>`:""}</div></div><table style="width:100%;border-collapse:collapse;margin-bottom:30px"><thead><tr style="background:#0044ff;color:white"><th style="text-align:left;padding:12px;font-weight:600">Description</th><th style="text-align:right;padding:12px;font-weight:600;width:70px">Qty</th><th style="text-align:right;padding:12px;font-weight:600;width:100px">Unit Price</th><th style="text-align:right;padding:12px;font-weight:600;width:100px">Amount</th></tr></thead><tbody>${inv.lineItems?.map(li => `<tr style="border-bottom:1px solid #eee"><td style="padding:12px">${li.description}</td><td style="text-align:right;padding:12px">${li.qty}</td><td style="text-align:right;padding:12px">R ${Number(li.rate||0).toFixed(2)}</td><td style="text-align:right;padding:12px;font-weight:600">R ${Number((li.qty||0)*(li.rate||0)).toFixed(2)}</td></tr>`).join("")||""}${inv.labourHours>0?`<tr style="border-bottom:1px solid #eee"><td style="padding:12px">Labour - Service Call</td><td style="text-align:right;padding:12px">${inv.labourHours}</td><td style="text-align:right;padding:12px">R ${Number(inv.labourRate||0).toFixed(2)}</td><td style="text-align:right;padding:12px;font-weight:600">R ${Number(inv.labourHours*inv.labourRate).toFixed(2)}</td></tr>`:""}${inv.travelKm>0?`<tr style="border-bottom:1px solid #eee"><td style="padding:12px">Travel Distance</td><td style="text-align:right;padding:12px">${inv.travelKm}</td><td style="text-align:right;padding:12px">R ${Number(inv.travelRate||0).toFixed(2)}</td><td style="text-align:right;padding:12px;font-weight:600">R ${Number(inv.travelKm*inv.travelRate).toFixed(2)}</td></tr>`:""}</tbody></table><div style="display:flex;justify-content:flex-end;margin-bottom:30px"><div style="width:320px"><div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:2px solid #0044ff;margin-bottom:10px"><span style="font-weight:600">Subtotal:</span><span>R ${Number(inv.subtotal||0).toFixed(2)}</span></div>${inv.discount>0?`<div style="display:flex;justify-content:space-between;padding:8px 0;color:#e74c3c"><span>Discount:</span><span>-R ${Number(inv.discount).toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span>Subtotal:</span><span>R ${Number(inv.subtotal-inv.discount).toFixed(2)}</span></div>`:""}<div style="display:flex;justify-content:space-between;padding:8px 0"><span>VAT (15%):</span><span>R ${Number(inv.tax||0).toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:700;color:#0044ff"><span>TOTAL DUE:</span><span>R ${Number(inv.total||0).toFixed(2)}</span></div></div></div></div>`; generatePDF(html, inv.number + ".pdf");};
  const generateDeliveryNotePDF = (inv) => {const client = clients.find(c => c.id === inv.clientId); const ticket = tickets.find(t => t.id === inv.ticketId); const html = `<div style="font-family:'Segoe UI',Arial;padding:20px;background:#fff"><div style="border-left:5px solid #2ecc8a;padding:15px 20px;margin-bottom:30px;background:#f0fdf4"><div style="font-size:28px;font-weight:700;color:#2ecc8a">DELIVERY NOTE</div><div style="color:#666;margin-top:5px">Parts & Materials Delivery</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px"><div style="background:#f5f7fa;padding:15px;border-radius:8px"><div style="font-weight:600;color:#333;margin-bottom:10px">DELIVERED TO</div><div style="font-size:15px;font-weight:700">${client?.name}</div><div style="color:#666;font-size:14px;margin-top:5px">${client?.contactName||"—"}<br/>${client?.address||"—"}</div></div><div style="background:#f5f7fa;padding:15px;border-radius:8px"><div style="font-weight:600;color:#333;margin-bottom:10px">DETAILS</div><div style="color:#666;font-size:14px"><div><strong>Invoice #:</strong> ${inv.number}</div><div><strong>Date:</strong> ${inv.deliveryDate?fmtD(inv.deliveryDate):fmtD(nowISO())}</div><div><strong>Status:</strong> <span style="background:#2ecc8a;color:white;padding:2px 8px;border-radius:4px;font-size:12px">${inv.deliveryDate?"✓ Delivered":"Pending"}</span></div></div></div></div>${ticket?`<div style="background:#e8f4f8;padding:15px;border-radius:8px;margin-bottom:30px"><div style="font-weight:600;color:#333;margin-bottom:10px">DEVICE INFORMATION</div><div style="color:#666;font-size:14px"><div><strong>${ticket.brand} ${ticket.model}</strong> | S/N: ${ticket.serial}</div><div style="margin-top:5px">Location: ${ticket.location||"—"}</div></div></div>`:""}<table style="width:100%;border-collapse:collapse;margin-bottom:30px"><thead><tr style="background:#2ecc8a;color:white"><th style="text-align:left;padding:12px;font-weight:600">Item Description</th><th style="text-align:center;padding:12px;font-weight:600;width:70px">Qty</th><th style="text-align:center;padding:12px;font-weight:600;width:50px">✓</th></tr></thead><tbody>${inv.lineItems?.map(li => `<tr style="border-bottom:1px solid #eee"><td style="padding:12px">${li.description}</td><td style="text-align:center;padding:12px">${li.qty}</td><td style="text-align:center;padding:12px">☐</td></tr>`).join("")||""}</tbody></table><div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:40px;padding-top:30px;border-top:2px solid #2ecc8a"><div><div style="font-weight:600;color:#333;margin-bottom:20px">Deliverer Signature</div><div style="border-bottom:2px solid #333;height:50px;margin-bottom:5px"></div><div style="color:#666;font-size:13px">Name & Signature</div></div><div><div style="font-weight:600;color:#333;margin-bottom:20px">Client Signature</div><div style="border-bottom:2px solid #333;height:50px;margin-bottom:5px"></div><div style="color:#666;font-size:13px">Name & Signature</div></div></div></div>`; generatePDF(html, inv.number + "_DeliveryNote.pdf");};
  const sendInvoiceEmail = async (inv) => {const client = clients.find(c => c.id === inv.clientId); if (!client?.email) { alert("No email on file"); return; } alert(`Email would be sent to: ${client.email}\n\nSubject: Invoice ${inv.number} - IntelliSupport`);};
  const filtered = invoices.filter(i => {const matchTerm = !searchTerm || i.number?.includes(searchTerm) || clients.find(c => c.id === i.clientId)?.name.toLowerCase().includes(searchTerm.toLowerCase()); const matchStatus = filterStatus === "All" || i.status === filterStatus; const matchPayment = paymentFilter === "All" || (paymentFilter === "Paid" && i.status === "Paid") || (paymentFilter === "Unpaid" && i.status !== "Paid"); return matchTerm && matchStatus && matchPayment;});
  return (<><div className="tabs" style={{marginBottom: 12}}><button className={`tab ${tab === "invoices" ? "on" : ""}`} onClick={() => setTab("invoices")}>📄 Invoices</button><button className={`tab ${tab === "reports" ? "on" : ""}`} onClick={() => setTab("reports")}>📊 Reports</button></div>{tab === "invoices" && (<><div className="sg" style={{marginBottom: 12}}>{[{n: invoices.length, l: "Total", c: "var(--blue)"},{n: invoices.filter(i => i.status === "Draft").length, l: "Draft", c: "var(--mu)"},{n: invoices.filter(i => i.status === "Sent").length, l: "Sent", c: "var(--amb)"},{n: invoices.filter(i => i.status === "Paid").length, l: "Paid", c: "var(--grn)"},{n: "R " + Number(invoices.filter(i => i.status === "Paid").reduce((s, i) => s + i.total, 0)).toFixed(0), l: "Revenue", c: "var(--acc)"}].map(s => (<div className="sc" key={s.l}><div className="sc-n" style={{color: s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>))}</div><div className="frow" style={{marginBottom: 12, gap: 10}}><div className="sw"><span className="sic">🔍</span><input className="sinp" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div><select className="fsl" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option>All Status</option><option>Draft</option><option>Sent</option><option>Paid</option></select><select className="fsl" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}><option>All Payments</option><option>Paid</option><option>Unpaid</option></select>{isCtrl && <button className="btn bp bsm" onClick={() => {setShowForm(true); setEditId(null); resetForm();}}>+ Invoice</button>}</div>{showForm && (<div style={{background: "var(--s1)", border: "1px solid var(--rim)", borderRadius: 10, padding: 14, marginBottom: 12}}><div style={{fontWeight: 700, fontSize: 14, marginBottom: 12}}>Create Invoice</div><div className="fr2" style={{marginBottom: 10}}><div className="fi"><label>Client *</label><select className="sel" value={f.clientId} onChange={e => s("clientId", e.target.value)}><option value="">— Select —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="fi"><label>Ticket</label><select className="sel" value={f.ticketId} onChange={e => s("ticketId", e.target.value)}><option value="">— None —</option>{tickets.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}</select></div></div><div style={{background: "var(--s2)", borderRadius: 9, padding: 12, marginBottom: 10}}><div style={{fontWeight: 600, fontSize: 12, marginBottom: 8}}>Items</div>{f.lineItems.map((li, i) => (<div key={i} className="fr3" style={{marginBottom: 8, gap: 8}}><input className="inp" placeholder="Description" value={li.description || ""} onChange={e => {const nli = [...f.lineItems]; nli[i].description = e.target.value; s("lineItems", nli);}}/><input className="inp" type="number" placeholder="Qty" value={li.qty || ""} onChange={e => {const nli = [...f.lineItems]; nli[i].qty = +e.target.value; s("lineItems", nli);}}/><input className="inp" type="number" placeholder="Rate" value={li.rate || ""} onChange={e => {const nli = [...f.lineItems]; nli[i].rate = +e.target.value; s("lineItems", nli);}}/></div>))}<button className="btn bg2 bxs" onClick={() => s("lineItems", [...f.lineItems, {description: "", qty: 1, rate: 0}])}>+ Item</button></div><div className="fr3" style={{marginBottom: 10}}><div className="fi"><label>Labour Hours</label><input className="inp" type="number" step="0.5" value={f.labourHours} onChange={e => s("labourHours", +e.target.value)}/></div><div className="fi"><label>Rate/Hr</label><input className="inp" type="number" value={f.labourRate} onChange={e => s("labourRate", +e.target.value)}/></div><div className="fi" style={{marginTop: "auto"}}><label style={{color: "var(--mu)"}}>= R {Number(f.labourHours * f.labourRate).toFixed(2)}</label></div></div><div className="fr3" style={{marginBottom: 10}}><div className="fi"><label>Travel (km)</label><input className="inp" type="number" step="0.1" value={f.travelKm} onChange={e => s("travelKm", +e.target.value)}/></div><div className="fi"><label>Rate/km</label><input className="inp" type="number" value={f.travelRate} onChange={e => s("travelRate", +e.target.value)}/></div><div className="fi" style={{marginTop: "auto"}}><label style={{color: "var(--mu)"}}>= R {Number(f.travelKm * f.travelRate).toFixed(2)}</label></div></div><div className="fi" style={{marginBottom: 10}}><label>Discount</label><input className="inp" type="number" value={f.discount} onChange={e => s("discount", +e.target.value)}/></div><div style={{background: "var(--s2)", borderRadius: 9, padding: 12, marginBottom: 10, fontSize: 12}}><div style={{display: "flex", justifyContent: "space-between", marginBottom: 5}}><span>Subtotal:</span><strong>R {Number(totals.subtotal).toFixed(2)}</strong></div><div style={{display: "flex", justifyContent: "space-between", marginBottom: 5}}><span>Tax (15%):</span><strong>R {Number(totals.tax).toFixed(2)}</strong></div><div style={{display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: "bold", color: "var(--acc)", paddingTop: 8, borderTop: "1px solid var(--rim)"}}><span>TOTAL:</span><strong>R {Number(totals.total).toFixed(2)}</strong></div></div><div style={{display: "flex", gap: 8}}><button className="btn bp bsm" onClick={saveInvoice}>Save</button><button className="btn bg2 bsm" onClick={() => {setShowForm(false); resetForm();}}>Cancel</button></div></div>)}{filtered.length === 0 ? (<div className="empty"><div className="ei">📄</div><div>No invoices</div></div>) : (<div className="cg">{filtered.map(inv => {const cl = clients.find(c => c.id === inv.clientId); return (<div key={inv.id} className="card"><div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10}}><div><div style={{fontWeight: 700, fontSize: 14}}>{inv.number}</div><div style={{fontSize: 11, color: "var(--mu)", marginTop: 2}}>{cl?.name}</div></div><div style={{display: "flex", gap: 5}}><span className="bdg" style={{background: inv.status === "Paid" ? "rgba(46,204,138,.15)" : inv.status === "Sent" ? "rgba(240,160,48,.15)" : "rgba(107,114,128,.15)", color: inv.status === "Paid" ? "var(--grn)" : inv.status === "Sent" ? "var(--amb)" : "var(--mu)", fontSize: 10}}>{inv.status}</span>{inv.deliveryDate && <span className="bdg" style={{background: "rgba(46,204,138,.15)", color: "var(--grn)", fontSize: 10}}>✓ Delivered</span>}</div></div><div className="crow"><span className="crl">Amount</span><span className="crv">R {Number(inv.total || 0).toFixed(2)}</span></div><div className="crow"><span className="crl">Date</span><span className="crv">{fmtD(inv.createdAt)}</span></div>{inv.paidDate && <div className="crow"><span className="crl">Paid</span><span className="crv" style={{color: "var(--grn)"}}>{fmtD(inv.paidDate)}</span></div>}<div className="cacts" style={{marginTop: 8}}><button className="btn bg2 bxs" onClick={() => generateInvoicePDF(inv)}>📄 PDF</button><button className="btn bg2 bxs" onClick={() => generateDeliveryNotePDF(inv)}>📦 Note</button><button className="btn bg2 bxs" onClick={() => sendInvoiceEmail(inv)}>✉️ Email</button>{inv.status !== "Paid" && <button className="btn bg2 bxs" onClick={() => markAsPaid(inv.id)}>✓ Paid</button>}{!inv.deliveryDate && <button className="btn bg2 bxs" onClick={() => markAsDelivered(inv.id)}>✓ Delivered</button>}</div></div>);})}</div>)}</>)}{tab === "reports" && (<><div className="sg" style={{marginBottom: 16}}>{[{title: "Revenue", value: "R " + Number(invoices.reduce((s, i) => s + i.total, 0)).toFixed(0), icon: "💰"},{title: "Outstanding", value: "R " + Number(invoices.filter(i => i.status !== "Paid").reduce((s, i) => s + i.total, 0)).toFixed(0), icon: "⏳"},{title: "Avg Invoice", value: "R " + Number(invoices.length > 0 ? invoices.reduce((s, i) => s + i.total, 0) / invoices.length : 0).toFixed(0), icon: "📊"},{title: "Overdue", value: invoices.filter(i => i.status !== "Paid" && new Date(i.dueDate || new Date(i.createdAt).getTime() + i.paymentTerms * 86400000) < new Date()).length, icon: "🚨"}].map((s, i) => (<div className="sc" key={i}><div style={{fontSize: 20, marginBottom: 5}}>{s.icon}</div><div className="sc-n">{s.value}</div><div className="sc-l">{s.title}</div></div>))}</div><div className="sect">By Client<span/></div><div className="tw"><table><thead><tr><th>Client</th><th>Invoices</th><th>Total</th><th>Paid</th></tr></thead><tbody>{clients.map(c => {const cinv = invoices.filter(i => i.clientId === c.id); const paid = cinv.filter(i => i.status === "Paid").reduce((s, i) => s + i.total, 0); return (<tr key={c.id}><td>{c.name}</td><td>{cinv.length}</td><td>R {Number(cinv.reduce((s, i) => s + i.total, 0)).toFixed(2)}</td><td style={{color: "var(--grn)"}}>R {Number(paid).toFixed(2)}</td></tr>);})}</tbody></table></div></>)}</> );
}

// ── ANALYTICS PAGE ────────────────────────────────────────────
function AnalyticsPage({invoices, tickets, clients, devices, parts, users}) {
  const [tab, setTab] = useState("payments");
  const [revRange, setRevRange] = useState("monthly");

  const pay = getPaymentAnalytics(invoices);
  const trends = getRevenueTrends(invoices);
  const costData = getCostAnalysis(tickets, clients, devices, parts);
  const techData = getTechnicianMetrics(tickets, users);
  const partsCost = getPartsInventoryCost(parts);
  const profitData = getProfitabilityPerService(tickets, invoices);

  const trendData = Object.entries(trends[revRange] || {}).sort(([a],[b])=>a.localeCompare(b)).slice(-12);
  const maxTrend = Math.max(...trendData.map(([,v])=>v), 1);

  const Bar = ({val, max, color="var(--acc)"}) => (
    <div style={{flex:1, background:"var(--s2)", borderRadius:4, height:8, overflow:"hidden"}}>
      <div style={{width:`${Math.max(2,(val/max)*100)}%`, height:"100%", background:color, borderRadius:4, transition:"width .4s"}}/>
    </div>
  );

  const KPI = ({icon, label, value, sub, color="var(--acc)"}) => (
    <div className="sc" style={{textAlign:"left", padding:"14px 16px"}}>
      <div style={{fontSize:22, marginBottom:4}}>{icon}</div>
      <div style={{fontSize:20, fontWeight:700, color}}>{value}</div>
      <div style={{fontSize:11, color:"var(--mu2)", marginTop:2}}>{label}</div>
      {sub&&<div style={{fontSize:10, color:"var(--mu)", marginTop:2}}>{sub}</div>}
    </div>
  );

  return (
    <>
      <div className="tabs" style={{marginBottom:12}}>
        {[["payments","💳 Payments"],["revenue","📈 Revenue Trends"],["clients","🏢 Cost by Client"],["technicians","👷 Technicians"],["parts","🔧 Inventory"],["profitability","💹 Profitability"]].map(([id,label])=>(
          <button key={id} className={`tab ${tab===id?"on":""}`} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      {tab==="payments"&&<>
        <div className="sg" style={{marginBottom:16}}>
          <KPI icon="💰" label="Total Invoiced" value={`R ${Number(pay.total).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`} color="var(--acc)"/>
          <KPI icon="✅" label="Total Collected" value={`R ${Number(pay.paid).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`} color="var(--grn)"/>
          <KPI icon="⏳" label="Outstanding" value={`R ${Number(pay.unpaid).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`} color="var(--amb)"/>
          <KPI icon="📄" label="Avg Invoice" value={`R ${Number(pay.avg).toFixed(2)}`} sub={`${pay.count} invoices total`} color="var(--blue)"/>
        </div>
        <div className="sect">Payment Summary<span/></div>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:16,marginBottom:12}}>
          {[
            {label:"Collection Rate",val:pay.total>0?((pay.paid/pay.total)*100).toFixed(1):0,suffix:"%",color:"var(--grn)"},
            {label:"Outstanding Rate",val:pay.total>0?((pay.unpaid/pay.total)*100).toFixed(1):0,suffix:"%",color:"var(--amb)"},
          ].map(r=>(
            <div key={r.label} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}>
                <span>{r.label}</span><strong style={{color:r.color}}>{r.val}{r.suffix}</strong>
              </div>
              <Bar val={Number(r.val)} max={100} color={r.color}/>
            </div>
          ))}
        </div>
        <div className="sect">Invoices by Status<span/></div>
        <div className="tw"><table>
          <thead><tr><th>Status</th><th>Count</th><th>Total Value</th><th>% of Revenue</th></tr></thead>
          <tbody>
            {["Draft","Sent","Paid"].map(st=>{
              const sinv=invoices.filter(i=>i.status===st);
              const stotal=sinv.reduce((s,i)=>s+i.total,0);
              return(<tr key={st}><td><span className="bdg" style={{background:st==="Paid"?"rgba(46,204,138,.15)":st==="Sent"?"rgba(240,160,48,.15)":"rgba(107,114,128,.15)",color:st==="Paid"?"var(--grn)":st==="Sent"?"var(--amb)":"var(--mu)"}}>{st}</span></td>
                <td>{sinv.length}</td>
                <td>R {Number(stotal).toFixed(2)}</td>
                <td>{pay.total>0?((stotal/pay.total)*100).toFixed(1):0}%</td>
              </tr>);
            })}
          </tbody>
        </table></div>
      </>}

      {tab==="revenue"&&<>
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
          <span style={{fontSize:13,color:"var(--mu2)"}}>View by:</span>
          {["weekly","monthly","yearly"].map(r=>(
            <button key={r} className={`tab ${revRange===r?"on":""}`} onClick={()=>setRevRange(r)} style={{fontSize:12,padding:"4px 12px"}}>{r.charAt(0).toUpperCase()+r.slice(1)}</button>
          ))}
        </div>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Revenue Trend — {revRange.charAt(0).toUpperCase()+revRange.slice(1)}</div>
          {trendData.length===0
            ?<div className="empty"><div className="ei">📈</div><div>No revenue data yet</div></div>
            :<div style={{display:"flex",flexDirection:"column",gap:10}}>
              {trendData.map(([period, val])=>(
                <div key={period} style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:90,fontSize:11,color:"var(--mu2)",textAlign:"right",flexShrink:0}}>{period}</div>
                  <Bar val={val} max={maxTrend} color="var(--acc)"/>
                  <div style={{width:100,fontSize:12,fontWeight:600,textAlign:"right",flexShrink:0}}>R {Number(val).toFixed(0)}</div>
                </div>
              ))}
            </div>}
        </div>
        <div className="sg" style={{marginBottom:12}}>
          <KPI icon="📅" label="This Month" value={`R ${Number(Object.entries(trends.monthly||{}).sort(([a],[b])=>b.localeCompare(a))[0]?.[1]||0).toFixed(0)}`} color="var(--acc)"/>
          <KPI icon="📆" label="This Year" value={`R ${Number(Object.entries(trends.yearly||{}).sort(([a],[b])=>b-a)[0]?.[1]||0).toFixed(0)}`} color="var(--grn)"/>
          <KPI icon="📊" label="Periods Tracked" value={trendData.length} color="var(--blue)"/>
        </div>
      </>}

      {tab==="clients"&&<>
        <div className="sect">Cost Analysis by Client<span/></div>
        {costData.length===0
          ?<div className="empty"><div className="ei">🏢</div><div>No cost data yet</div></div>
          :<><div className="tw"><table>
            <thead><tr><th>Client</th><th>Tickets</th><th>Labour Cost</th><th>Total Cost</th><th>Avg / Ticket</th></tr></thead>
            <tbody>{costData.sort((a,b)=>b.cost-a.cost).map((c,i)=>(
              <tr key={i}>
                <td style={{fontWeight:600}}>{c.client}</td>
                <td>{c.tickets}</td>
                <td>R {Number(c.labour).toFixed(2)}</td>
                <td style={{fontWeight:700,color:"var(--acc)"}}>R {Number(c.cost).toFixed(2)}</td>
                <td>R {c.tickets>0?Number(c.cost/c.tickets).toFixed(2):"—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:16,marginTop:12}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Cost Distribution</div>
            {costData.sort((a,b)=>b.cost-a.cost).slice(0,8).map((c,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{width:130,fontSize:12,color:"var(--mu2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.client}</div>
                <Bar val={c.cost} max={Math.max(...costData.map(x=>x.cost),1)} color="var(--blue)"/>
                <div style={{width:90,fontSize:12,fontWeight:600,textAlign:"right"}}>R {Number(c.cost).toFixed(0)}</div>
              </div>
            ))}
          </div></>}
      </>}

      {tab==="technicians"&&<>
        <div className="sect">Technician Productivity<span/></div>
        {techData.length===0
          ?<div className="empty"><div className="ei">👷</div><div>No technician data yet</div></div>
          :<><div className="sg" style={{marginBottom:12}}>
            <KPI icon="👷" label="Active Techs" value={techData.length} color="var(--acc)"/>
            <KPI icon="✅" label="Total Completed" value={techData.reduce((s,t)=>s+t.completed,0)} color="var(--grn)"/>
            <KPI icon="🔄" label="In Progress" value={techData.reduce((s,t)=>s+t.inProgress,0)} color="var(--amb)"/>
            <KPI icon="⏱️" label="Avg Hours/Job" value={`${techData.reduce((s,t)=>s+Number(t.avgTime||0),0)&&(techData.reduce((s,t)=>s+Number(t.avgTime||0),0)/techData.filter(t=>t.completed>0).length||1).toFixed(1)}h`} color="var(--blue)"/>
          </div>
          <div className="tw"><table>
            <thead><tr><th>Technician</th><th>Completed</th><th>In Progress</th><th>Total Hours</th><th>Avg Hrs/Job</th></tr></thead>
            <tbody>{techData.sort((a,b)=>b.completed-a.completed).map((t,i)=>(
              <tr key={i}>
                <td style={{fontWeight:600}}>{t.name}</td>
                <td><span style={{color:"var(--grn)",fontWeight:700}}>{t.completed}</span></td>
                <td><span style={{color:"var(--amb)"}}>{t.inProgress}</span></td>
                <td>{Number(t.totalHours).toFixed(1)}h</td>
                <td>{t.avgTime||"—"}h</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:16,marginTop:12}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Completion Rate by Technician</div>
            {techData.sort((a,b)=>b.completed-a.completed).map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{width:120,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                <Bar val={t.completed} max={Math.max(...techData.map(x=>x.completed),1)} color="var(--grn)"/>
                <div style={{width:50,fontSize:12,fontWeight:600,textAlign:"right"}}>{t.completed}</div>
              </div>
            ))}
          </div></>}
      </>}

      {tab==="parts"&&<>
        <div className="sg" style={{marginBottom:12}}>
          <KPI icon="📦" label="Total SKUs" value={parts.length} color="var(--acc)"/>
          <KPI icon="💰" label="Inventory Value" value={`R ${Number(partsCost).toFixed(2)}`} color="var(--grn)"/>
          <KPI icon="⚠️" label="Low Stock Items" value={parts.filter(p=>p.qty<=p.minQty).length} color="var(--red)"/>
          <KPI icon="📋" label="Avg Stock Value" value={`R ${parts.length>0?Number(partsCost/parts.length).toFixed(2):"0.00"}`} color="var(--blue)"/>
        </div>
        <div className="sect">Parts Inventory Cost Breakdown<span/></div>
        {parts.length===0
          ?<div className="empty"><div className="ei">🔧</div><div>No parts in inventory</div></div>
          :<><div className="tw"><table>
            <thead><tr><th>Part Name</th><th>P/N</th><th>In Stock</th><th>Unit Cost</th><th>Total Value</th><th>Status</th></tr></thead>
            <tbody>{parts.sort((a,b)=>((b.cost||50)*(b.stock||b.qty||0))-((a.cost||50)*(a.stock||a.qty||0))).map(p=>{
              const stockQty=p.stock||p.qty||0;
              const totalVal=(p.cost||50)*stockQty;
              const isLow=stockQty<=(p.minQty||1);
              return(<tr key={p.id}>
                <td style={{fontWeight:600}}>{p.name}</td>
                <td className="mono" style={{fontSize:11}}>{p.partNo||"—"}</td>
                <td><span style={{color:isLow?"var(--red)":"var(--grn)",fontWeight:700}}>{stockQty}</span>{isLow&&<span style={{fontSize:10,color:"var(--red)",marginLeft:4}}>LOW</span>}</td>
                <td>R {Number(p.cost||50).toFixed(2)}</td>
                <td style={{fontWeight:700}}>R {Number(totalVal).toFixed(2)}</td>
                <td><span className="bdg" style={{background:isLow?"rgba(240,80,96,.12)":"rgba(46,204,138,.12)",color:isLow?"var(--red)":"var(--grn)",fontSize:10}}>{isLow?"Low Stock":"OK"}</span></td>
              </tr>);
            })}</tbody>
          </table></div></>}
      </>}

      {tab==="profitability"&&<>
        <div className="sect">Profitability by Service Type<span/></div>
        {profitData.length===0
          ?<div className="empty"><div className="ei">💹</div><div>No service data yet — link invoices to tickets to track profitability</div></div>
          :<><div className="sg" style={{marginBottom:12}}>
            <KPI icon="💹" label="Total Revenue" value={`R ${Number(profitData.reduce((s,p)=>s+p.revenue,0)).toFixed(0)}`} color="var(--acc)"/>
            <KPI icon="💸" label="Total Cost" value={`R ${Number(profitData.reduce((s,p)=>s+p.cost,0)).toFixed(0)}`} color="var(--red)"/>
            <KPI icon="✅" label="Gross Profit" value={`R ${Number(profitData.reduce((s,p)=>s+p.profit,0)).toFixed(0)}`} color="var(--grn)"/>
            <KPI icon="📊" label="Avg Margin" value={`${profitData.length>0?(profitData.reduce((s,p)=>s+Number(p.margin),0)/profitData.length).toFixed(1):0}%`} color="var(--blue)"/>
          </div>
          <div className="tw"><table>
            <thead><tr><th>Service Type</th><th>Tickets</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
            <tbody>{profitData.sort((a,b)=>b.profit-a.profit).map((p,i)=>(
              <tr key={i}>
                <td style={{fontWeight:600}}>{p.type}</td>
                <td>{p.tickets}</td>
                <td>R {Number(p.revenue).toFixed(2)}</td>
                <td>R {Number(p.cost).toFixed(2)}</td>
                <td style={{fontWeight:700,color:p.profit>=0?"var(--grn)":"var(--red)"}}>R {Number(p.profit).toFixed(2)}</td>
                <td><span className="bdg" style={{background:Number(p.margin)>=20?"rgba(46,204,138,.15)":Number(p.margin)>=0?"rgba(240,160,48,.15)":"rgba(240,80,96,.15)",color:Number(p.margin)>=20?"var(--grn)":Number(p.margin)>=0?"var(--amb)":"var(--red)"}}>{p.margin}%</span></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:16,marginTop:12}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Profit by Service Type</div>
            {profitData.sort((a,b)=>b.profit-a.profit).map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{width:130,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.type}</div>
                <Bar val={Math.max(0,p.profit)} max={Math.max(...profitData.map(x=>x.profit),1)} color={p.profit>=0?"var(--grn)":"var(--red)"}/>
                <div style={{width:100,fontSize:12,fontWeight:600,textAlign:"right",color:p.profit>=0?"var(--grn)":"var(--red)"}}>R {Number(p.profit).toFixed(0)}</div>
              </div>
            ))}
          </div></>}
      </>}
    </>
  );
}

// ── CLIENT PORTAL OVERVIEW ────────────────────────────────────
function ClientPortalPage({clients,tickets,devices,invoices,users}){
  const [selClient,setSelClient]=useState(null);
  const [tab,setTab]=useState("overview");
  const cl=clients.find(c=>c.id===selClient);
  const cTickets=tickets.filter(t=>t.clientId===selClient);
  const cDevices=devices.filter(d=>d.clientId===selClient);
  const cInvoices=invoices.filter(i=>i.clientId===selClient);
  const openT=cTickets.filter(t=>!["Closed","Resolved"].includes(t.status));
  const closedT=cTickets.filter(t=>["Closed","Resolved"].includes(t.status));
  const outstanding=cInvoices.filter(i=>i.status!=="Paid").reduce((s,i)=>s+i.total,0);
  const paid=cInvoices.filter(i=>i.status==="Paid").reduce((s,i)=>s+i.total,0);

  const STATUS_COLOR={Open:"var(--amb)",Assigned:"var(--blue)",Accepted:"var(--blue)","In Progress":"var(--blue)","Parts Pending":"var(--red)","Parts Arrived":"var(--grn)",Workshop:"var(--mu)",Resolved:"var(--grn)",Closed:"var(--mu)",Escalated:"var(--red)"};

  if(!selClient) return(
    <>
      <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:"14px 16px",marginBottom:14,fontSize:13,color:"var(--mu2)"}}>
        📋 Select a client to view their portal — a read-only snapshot of everything related to that client including tickets, devices, invoices, and activity history.
      </div>
      <div style={{marginBottom:12,fontSize:13,color:"var(--mu2)"}}>{clients.length} clients</div>
      <div className="cg">
        {clients.map(c=>{
          const ct=tickets.filter(t=>t.clientId===c.id);
          const ci=invoices.filter(i=>i.clientId===c.id);
          const owed=ci.filter(i=>i.status!=="Paid").reduce((s,i)=>s+i.total,0);
          return(
            <div key={c.id} className="card" style={{cursor:"pointer"}} onClick={()=>setSelClient(c.id)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{c.name}</div>
                  <div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>{c.contactName||"—"}</div>
                </div>
                {c.hasSLA&&c.sla&&c.sla!=="None"?<span className="bdg" style={{background:"rgba(0,194,255,.12)",color:"var(--acc)",fontSize:10}}>★ {c.sla}</span>:<span className="bdg" style={{background:"var(--s3)",color:"var(--mu)",fontSize:10}}>No SLA</span>}
              </div>
              <div className="crow"><span className="crl">Open tickets</span><span className="crv" style={{color:ct.filter(t=>!["Closed","Resolved"].includes(t.status)).length>0?"var(--amb)":"var(--grn)"}}>{ct.filter(t=>!["Closed","Resolved"].includes(t.status)).length}</span></div>
              <div className="crow"><span className="crl">Total tickets</span><span className="crv">{ct.length}</span></div>
              <div className="crow"><span className="crl">Outstanding</span><span className="crv" style={{color:owed>0?"var(--red)":"var(--grn)"}}>{owed>0?`R ${owed.toFixed(2)}`:"Clear"}</span></div>
              <div className="crow"><span className="crl">Devices</span><span className="crv">{devices.filter(d=>d.clientId===c.id).length}</span></div>
            </div>
          );
        })}
      </div>
    </>
  );

  return(
    <>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <button className="btn bg2 bsm" onClick={()=>setSelClient(null)}>← All Clients</button>
        <div style={{fontWeight:700,fontSize:16}}>{cl?.name}</div>
        {cl?.hasSLA&&cl?.sla&&cl?.sla!=="None"?<span className="bdg" style={{background:"rgba(0,194,255,.12)",color:"var(--acc)"}}>★ {cl.sla}</span>:<span className="bdg" style={{background:"var(--s3)",color:"var(--mu)"}}>No SLA</span>}
        {cl?.walkIn&&<span className="bdg" style={{background:"rgba(240,160,48,.12)",color:"var(--amb)"}}>Walk-in</span>}
      </div>

      <div className="sg" style={{marginBottom:14}}>
        {[
          {n:openT.length,l:"Open Tickets",c:"var(--amb)"},
          {n:closedT.length,l:"Resolved",c:"var(--grn)"},
          {n:cDevices.length,l:"Devices",c:"var(--blue)"},
          {n:`R ${outstanding.toFixed(0)}`,l:"Outstanding",c:"var(--red)"},
          {n:`R ${paid.toFixed(0)}`,l:"Paid",c:"var(--grn)"},
        ].map(s=><div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>)}
      </div>

      <div className="tabs" style={{marginBottom:12}}>
        {[["overview","Overview"],["tickets","Tickets"],["devices","Devices"],["invoices","Invoices"],["info","Contact Info"]].map(([id,lbl])=>(
          <button key={id} className={`tab ${tab===id?"on":""}`} onClick={()=>setTab(id)}>{lbl}</button>
        ))}
      </div>

      {tab==="overview"&&<>
        <div className="sect">Recent Activity<span/></div>
        {cTickets.slice(0,5).map(t=>(
          <div key={t.id} style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:"10px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,fontSize:13}}>{t.id}</div><div style={{fontSize:11,color:"var(--mu2)",marginTop:2}}>{t.title}</div></div>
            <span className="bdg" style={{background:"rgba(0,194,255,.08)",color:STATUS_COLOR[t.status]||"var(--mu)",fontSize:10}}>{t.status}</span>
          </div>
        ))}
        {cTickets.length===0&&<div className="empty"><div className="ei">🎫</div><div>No tickets yet</div></div>}
      </>}

      {tab==="tickets"&&<>
        {[{label:"Open",list:openT},{label:"Resolved / Closed",list:closedT}].map(({label,list})=>(
          <div key={label} style={{marginBottom:16}}>
            <div className="sect">{label} ({list.length})<span/></div>
            {list.length===0?<div style={{fontSize:12,color:"var(--mu)",padding:"8px 0"}}>None</div>:list.map(t=>(
              <div key={t.id} style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:"10px 14px",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
                  <div style={{fontWeight:600,fontSize:13}}>{t.id}</div>
                  <span className="bdg" style={{color:STATUS_COLOR[t.status]||"var(--mu)",background:"rgba(0,194,255,.08)",fontSize:10}}>{t.status}</span>
                </div>
                <div style={{fontSize:12,color:"var(--mu2)",marginBottom:4}}>{t.title}</div>
                <div style={{fontSize:11,color:"var(--mu)"}}>{fmtD(t.createdAt)} · {t.priority} priority · {t.type}</div>
              </div>
            ))}
          </div>
        ))}
      </>}

      {tab==="devices"&&<>
        {cDevices.length===0?<div className="empty"><div className="ei">🖥️</div><div>No devices registered</div></div>:cDevices.map(d=>(
          <div key={d.id} style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
              <div style={{fontWeight:700,fontSize:13}}>{d.brand} {d.model}</div>
              <span className="bdg" style={{background:"var(--s3)",color:"var(--mu2)",fontSize:10}}>{d.type}</span>
            </div>
            <div className="crow"><span className="crl">Serial</span><span className="crv mono">{d.serial||"—"}</span></div>
            <div className="crow"><span className="crl">Location</span><span className="crv">{d.location||"—"}</span></div>
            <div className="crow"><span className="crl">SLA</span><span className="crv">{d.sla&&d.sla!=="None"?`★ ${d.sla}`:"None"}</span></div>
            <div className="crow"><span className="crl">Open tickets</span><span className="crv" style={{color:tickets.filter(t=>t.deviceId===d.id&&!["Closed","Resolved"].includes(t.status)).length>0?"var(--amb)":"var(--grn)"}}>{tickets.filter(t=>t.deviceId===d.id&&!["Closed","Resolved"].includes(t.status)).length}</span></div>
          </div>
        ))}
      </>}

      {tab==="invoices"&&<>
        {cInvoices.length===0?<div className="empty"><div className="ei">📄</div><div>No invoices</div></div>:cInvoices.map(inv=>(
          <div key={inv.id} style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
              <div style={{fontWeight:700,fontSize:13}}>{inv.number}</div>
              <span className="bdg" style={{background:inv.status==="Paid"?"rgba(46,204,138,.12)":inv.status==="Sent"?"rgba(240,160,48,.12)":"rgba(107,114,128,.12)",color:inv.status==="Paid"?"var(--grn)":inv.status==="Sent"?"var(--amb)":"var(--mu)",fontSize:10}}>{inv.status}</span>
            </div>
            <div className="crow"><span className="crl">Amount</span><span className="crv" style={{fontWeight:700}}>R {Number(inv.total||0).toFixed(2)}</span></div>
            <div className="crow"><span className="crl">Date</span><span className="crv">{fmtD(inv.createdAt)}</span></div>
            {inv.paidDate&&<div className="crow"><span className="crl">Paid on</span><span className="crv" style={{color:"var(--grn)"}}>{fmtD(inv.paidDate)}</span></div>}
          </div>
        ))}
      </>}

      {tab==="info"&&<>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:"16px 18px"}}>
          {[
            {l:"Company",v:cl?.name},
            {l:"Contact person",v:cl?.contactName},
            {l:"Email",v:cl?.email},
            {l:"Phone",v:cl?.phone},
            {l:"VAT number",v:cl?.vatNumber||"—"},
            {l:"Address",v:cl?.address||"—"},
            {l:"Walk-in",v:cl?.walkIn?"Yes":"No"},
            {l:"SLA tier",v:cl?.hasSLA&&cl?.sla&&cl?.sla!=="None"?cl.sla:"No SLA"},
          ].map(({l,v})=>v&&<div key={l} className="crow" style={{padding:"8px 0",borderBottom:"1px solid var(--rim)"}}><span className="crl">{l}</span><span className="crv" style={{textAlign:"right",maxWidth:200}}>{v}</span></div>)}
        </div>
      </>}
    </>
  );
}

// ── SLA CONTRACTS ─────────────────────────────────────────────
function SLAContractsPage({clients,slaMeta,profile,isCtrl,contracts}){
  const [showForm,setShowForm]=useState(false);
  const [f,setF]=useState({clientId:"",tier:"Silver",startDate:"",endDate:"",responseH:"",resolutionH:"",monthlyFee:"",notes:"",status:"Active"});
  const sf=(k,v)=>setF(p=>({...p,[k]:v}));
  const selClient=clients.find(c=>c.id===f.clientId);

  function pickTier(tier){
    const meta=slaMeta[tier]||{};
    setF(p=>({...p,tier,responseH:meta.respH||"",resolutionH:meta.resH||""}));
  }

  async function saveContract(){
    if(!f.clientId||!f.startDate||!f.endDate){alert("Client, start date and end date are required.");return;}
    const id="CTR"+uid().toUpperCase();
    await FS.set("contracts",id,{...f,id,createdBy:profile.id,createdAt:nowISO()});
    setShowForm(false);setF({clientId:"",tier:"Silver",startDate:"",endDate:"",responseH:"",resolutionH:"",monthlyFee:"",notes:"",status:"Active"});
  }

  const today=new Date();
  const expiringSoon=contracts.filter(c=>{const end=new Date(c.endDate);const diff=(end-today)/(1000*60*60*24);return diff>0&&diff<=30;});
  const expired=contracts.filter(c=>new Date(c.endDate)<today&&c.status==="Active");
  const active=contracts.filter(c=>c.status==="Active"&&new Date(c.endDate)>=today);

  const statusColor={Active:"var(--grn)",Expired:"var(--red)",Cancelled:"var(--mu)",Pending:"var(--amb)"};
  const pdf=(con)=>{
    const cl=clients.find(c=>c.id===con.clientId);
    const html=`<div style="font-family:'Segoe UI',Arial;padding:30px;max-width:800px;margin:0 auto"><div style="border-left:5px solid #7c3aed;padding:15px 20px;margin-bottom:30px;background:#f5f3ff"><div style="font-size:26px;font-weight:700;color:#7c3aed">SERVICE LEVEL AGREEMENT</div><div style="color:#666;margin-top:5px">Formal service contract</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px"><div style="background:#f9f9f9;padding:15px;border-radius:8px"><div style="font-weight:600;color:#333;margin-bottom:8px">SERVICE PROVIDER</div><div style="font-weight:700;font-size:15px">IntelliSupport</div><div style="color:#666;font-size:13px">Field Service Management</div></div><div style="background:#f9f9f9;padding:15px;border-radius:8px"><div style="font-weight:600;color:#333;margin-bottom:8px">CLIENT</div><div style="font-weight:700;font-size:15px">${cl?.name}</div><div style="color:#666;font-size:13px">${cl?.contactName||""}<br/>${cl?.email||""}</div></div></div><div style="background:#f0ebff;padding:15px;border-radius:8px;margin-bottom:20px"><div style="font-weight:600;margin-bottom:10px;color:#5b21b6">CONTRACT DETAILS</div><table style="width:100%;font-size:13px"><tr><td style="padding:5px 0;color:#666">SLA Tier:</td><td style="font-weight:600">${con.tier}</td></tr><tr><td style="padding:5px 0;color:#666">Start Date:</td><td>${fmtD(con.startDate)}</td></tr><tr><td style="padding:5px 0;color:#666">End Date:</td><td>${fmtD(con.endDate)}</td></tr><tr><td style="padding:5px 0;color:#666">Monthly Fee:</td><td style="font-weight:700;color:#5b21b6">${con.monthlyFee?`R ${con.monthlyFee}`:"As quoted"}</td></tr></table></div><div style="background:#f9f9f9;padding:15px;border-radius:8px;margin-bottom:20px"><div style="font-weight:600;margin-bottom:10px;color:#333">SERVICE COMMITMENTS</div><table style="width:100%;font-size:13px"><tr><td style="padding:6px 0;color:#666">Response time:</td><td style="font-weight:600">${con.responseH} hours</td></tr><tr><td style="padding:6px 0;color:#666">Resolution time:</td><td style="font-weight:600">${con.resolutionH} hours</td></tr><tr><td style="padding:6px 0;color:#666">Priority:</td><td>${con.tier} tier priority</td></tr></table></div>${con.notes?`<div style="background:#fffbec;border:1px solid #f5d547;border-radius:8px;padding:12px;margin-bottom:20px"><div style="font-weight:600;margin-bottom:5px">Notes</div><div style="font-size:13px;color:#666">${con.notes}</div></div>`:""}<div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:30px;padding-top:20px;border-top:2px solid #7c3aed"><div><div style="font-weight:600;margin-bottom:20px">Service Provider</div><div style="border-bottom:1px solid #333;height:40px"></div><div style="font-size:12px;color:#666;margin-top:5px">Signature & Date</div></div><div><div style="font-weight:600;margin-bottom:20px">Client</div><div style="border-bottom:1px solid #333;height:40px"></div><div style="font-size:12px;color:#666;margin-top:5px">Signature & Date</div></div></div></div>`;
    generatePDF(html,`SLA_${cl?.name}_${con.tier}.pdf`);
  };

  return(
    <>
      {expiringSoon.length>0&&<div style={{background:"rgba(240,160,48,.12)",border:"1px solid var(--amb)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13}}>⚠️ <strong>{expiringSoon.length}</strong> contract{expiringSoon.length!==1?"s":""} expiring within 30 days — review and renew.</div>}
      {expired.length>0&&<div style={{background:"rgba(240,80,96,.10)",border:"1px solid var(--red)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13}}>🚨 <strong>{expired.length}</strong> contract{expired.length!==1?"s":""} have expired — update status or renew.</div>}

      <div className="sg" style={{marginBottom:14}}>
        {[{n:contracts.length,l:"Total",c:"var(--blue)"},{n:active.length,l:"Active",c:"var(--grn)"},{n:expiringSoon.length,l:"Expiring Soon",c:"var(--amb)"},{n:expired.length,l:"Expired",c:"var(--red)"},{n:`R ${contracts.filter(c=>c.status==="Active").reduce((s,c)=>s+Number(c.monthlyFee||0),0).toFixed(0)}`,l:"Monthly Revenue",c:"var(--acc)"}].map(s=>(
          <div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>
        ))}
      </div>

      {isCtrl&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button className="btn bp bsm" onClick={()=>setShowForm(v=>!v)}>+ New Contract</button>
      </div>}

      {showForm&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:11,padding:16,marginBottom:14,display:"flex",flexDirection:"column",gap:11}}>
        <div style={{fontWeight:700,fontSize:14}}>New SLA Contract</div>
        <div className="fr2">
          <Fld label="Client *"><select className="sel" value={f.clientId} onChange={e=>sf("clientId",e.target.value)}><option value="">— Select —</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Fld>
          <Fld label="SLA Tier"><select className="sel" value={f.tier} onChange={e=>pickTier(e.target.value)}><option value="None">None</option>{["Bronze","Silver","Gold","Platinum"].map(t=><option key={t}>{t}</option>)}</select></Fld>
        </div>
        {selClient&&<div style={{background:"var(--s2)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--mu2)"}}>Client current SLA: <strong style={{color:"var(--acc)"}}>{selClient.hasSLA&&selClient.sla&&selClient.sla!=="None"?selClient.sla:"No SLA"}</strong></div>}
        <div className="fr2">
          <Fld label="Start Date"><input className="inp" type="date" value={f.startDate} onChange={e=>sf("startDate",e.target.value)}/></Fld>
          <Fld label="End Date"><input className="inp" type="date" value={f.endDate} onChange={e=>sf("endDate",e.target.value)}/></Fld>
        </div>
        <div className="fr3">
          <Fld label="Response (hrs)"><input className="inp" type="number" value={f.responseH} onChange={e=>sf("responseH",e.target.value)}/></Fld>
          <Fld label="Resolution (hrs)"><input className="inp" type="number" value={f.resolutionH} onChange={e=>sf("resolutionH",e.target.value)}/></Fld>
          <Fld label="Monthly Fee (R)"><input className="inp" type="number" value={f.monthlyFee} onChange={e=>sf("monthlyFee",e.target.value)} placeholder="0.00"/></Fld>
        </div>
        <Fld label="Notes"><textarea className="ta" value={f.notes} onChange={e=>sf("notes",e.target.value)} placeholder="Special terms, exclusions, inclusions…" style={{minHeight:60}}/></Fld>
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={saveContract}>Save Contract</button><button className="btn bg2 bsm" onClick={()=>setShowForm(false)}>Cancel</button></div>
      </div>}

      {contracts.length===0?<div className="empty"><div className="ei">📋</div><div>No contracts yet</div><div style={{fontSize:12,color:"var(--mu)",marginTop:6}}>Create your first SLA contract to formalise client relationships</div></div>
        :<div className="cg">{contracts.map(con=>{const cl=clients.find(c=>c.id===con.clientId);const daysLeft=Math.ceil((new Date(con.endDate)-today)/(1000*60*60*24));return(
          <div key={con.id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{cl?.name||"Unknown client"}</div><div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>★ {con.tier} · {fmtD(con.startDate)} – {fmtD(con.endDate)}</div></div>
              <span className="bdg" style={{background:`rgba(0,0,0,.06)`,color:statusColor[con.status]||"var(--mu)",fontSize:10}}>{con.status}</span>
            </div>
            {con.monthlyFee&&<div className="crow"><span className="crl">Monthly fee</span><span className="crv" style={{fontWeight:700,color:"var(--acc)"}}>R {Number(con.monthlyFee).toFixed(2)}</span></div>}
            <div className="crow"><span className="crl">Response / Resolution</span><span className="crv">{con.responseH}h / {con.resolutionH}h</span></div>
            <div className="crow"><span className="crl">Days remaining</span><span className="crv" style={{color:daysLeft<0?"var(--red)":daysLeft<=30?"var(--amb)":"var(--grn)"}}>{daysLeft<0?"Expired":`${daysLeft} days`}</span></div>
            {con.notes&&<div style={{fontSize:11,color:"var(--mu2)",marginTop:6,borderTop:"1px solid var(--rim)",paddingTop:6}}>{con.notes}</div>}
            <div className="cacts" style={{marginTop:8}}>
              <button className="btn bg2 bxs" onClick={()=>pdf(con)}>📄 PDF</button>
              {isCtrl&&<button className="btn bg2 bxs" onClick={async()=>{await FS.set("contracts",con.id,{...con,status:"Cancelled"});}}>Cancel</button>}
              {isCtrl&&<button className="btn bp bxs" onClick={async()=>{await FS.set("contracts",con.id,{...con,status:"Active"});}}>Renew</button>}
            </div>
          </div>
        );})}
        </div>}
    </>
  );
}

// ── PURCHASE ORDERS ───────────────────────────────────────────
function PurchaseOrdersPage({parts,profile,isCtrl,purchaseOrders}){
  const [showForm,setShowForm]=useState(false);
  const [f,setF]=useState({partId:"",partName:"",supplier:"",qty:1,unitCost:"",notes:"",status:"Pending",expectedDate:""});
  const sf=(k,v)=>setF(p=>({...p,[k]:v}));
  const lowStock=parts.filter(p=>(p.qty||0)<=(p.minQty||1));

  function pickPart(id){const p=parts.find(x=>x.id===id);if(p)setF(prev=>({...prev,partId:id,partName:p.name,supplier:p.supplier||"",unitCost:p.unitCost||""}));}

  async function savePO(){
    if(!f.partName||!f.qty){alert("Part and quantity are required.");return;}
    const poNum=`PO${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}${String(purchaseOrders.length+1).padStart(4,"0")}`;
    const id="PO"+uid().toUpperCase();
    const totalCost=Number(f.qty)*Number(f.unitCost||0);
    await FS.set("purchase_orders",id,{...f,id,poNumber:poNum,totalCost,createdBy:profile.id,createdAt:nowISO()});
    setShowForm(false);setF({partId:"",partName:"",supplier:"",qty:1,unitCost:"",notes:"",status:"Pending",expectedDate:""});
  }

  const statusColor={Pending:"var(--amb)",Sent:"var(--blue)",Confirmed:"var(--blue)",Received:"var(--grn)",Cancelled:"var(--mu)"};

  const pdf=(po)=>{
    const part=parts.find(p=>p.id===po.partId);
    const html=`<div style="font-family:'Segoe UI',Arial;padding:30px;max-width:800px;margin:0 auto"><div style="border-left:5px solid #d97706;padding:15px 20px;margin-bottom:30px;background:#fffbeb"><div style="font-size:26px;font-weight:700;color:#d97706">PURCHASE ORDER</div><div style="color:#666;margin-top:5px">${po.poNumber}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px"><div style="background:#f9f9f9;padding:15px;border-radius:8px"><div style="font-weight:600;margin-bottom:8px">FROM (Buyer)</div><div style="font-weight:700;font-size:15px">IntelliSupport</div><div style="font-size:13px;color:#666">Field Service Management</div></div><div style="background:#f9f9f9;padding:15px;border-radius:8px"><div style="font-weight:600;margin-bottom:8px">TO (Supplier)</div><div style="font-weight:700;font-size:15px">${po.supplier||"—"}</div></div></div><div style="background:#fff8ed;padding:15px;border-radius:8px;margin-bottom:20px"><div style="font-weight:600;margin-bottom:10px;color:#92400e">ORDER DETAILS</div><table style="width:100%;font-size:13px"><tr><td style="padding:5px 0;color:#666">PO Number:</td><td style="font-weight:600">${po.poNumber}</td></tr><tr><td style="padding:5px 0;color:#666">Date:</td><td>${fmtD(po.createdAt)}</td></tr><tr><td style="padding:5px 0;color:#666">Expected Delivery:</td><td>${po.expectedDate?fmtD(po.expectedDate):"TBD"}</td></tr><tr><td style="padding:5px 0;color:#666">Status:</td><td>${po.status}</td></tr></table></div><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr style="background:#d97706;color:white"><th style="text-align:left;padding:10px">Item</th><th style="text-align:center;padding:10px;width:80px">Qty</th><th style="text-align:right;padding:10px;width:100px">Unit Cost</th><th style="text-align:right;padding:10px;width:100px">Total</th></tr></thead><tbody><tr style="border-bottom:1px solid #eee"><td style="padding:10px">${po.partName}${part?.partNo?` (${part.partNo})`:"" }</td><td style="text-align:center;padding:10px">${po.qty}</td><td style="text-align:right;padding:10px">R ${Number(po.unitCost||0).toFixed(2)}</td><td style="text-align:right;padding:10px;font-weight:700">R ${Number(po.totalCost||0).toFixed(2)}</td></tr></tbody></table>${po.notes?`<div style="background:#fffbec;border:1px solid #f5d547;border-radius:8px;padding:12px;margin-bottom:20px"><strong>Notes:</strong> ${po.notes}</div>`:""}<div style="text-align:center;padding-top:20px;border-top:2px solid #d97706;color:#999;font-size:12px">Generated: ${fmt(nowISO())}</div></div>`;
    generatePDF(html,`${po.poNumber}.pdf`);
  };

  return(
    <>
      {lowStock.length>0&&<div style={{background:"rgba(240,160,48,.10)",border:"1px solid var(--amb)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13}}>
        ⚠️ <strong>{lowStock.length}</strong> part{lowStock.length!==1?"s":""} are low on stock:&nbsp;
        {lowStock.slice(0,3).map(p=>p.name).join(", ")}{lowStock.length>3?` +${lowStock.length-3} more`:""}.&nbsp;
        <button className="btn bg2 bxs" style={{marginLeft:4}} onClick={()=>{if(lowStock[0])pickPart(lowStock[0].id);setShowForm(true);}}>Order Now</button>
      </div>}

      <div className="sg" style={{marginBottom:14}}>
        {[
          {n:purchaseOrders.length,l:"Total POs",c:"var(--blue)"},
          {n:purchaseOrders.filter(p=>p.status==="Pending").length,l:"Pending",c:"var(--amb)"},
          {n:purchaseOrders.filter(p=>p.status==="Received").length,l:"Received",c:"var(--grn)"},
          {n:`R ${purchaseOrders.reduce((s,p)=>s+Number(p.totalCost||0),0).toFixed(0)}`,l:"Total Ordered",c:"var(--acc)"},
        ].map(s=><div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>)}
      </div>

      {isCtrl&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button className="btn bp bsm" onClick={()=>setShowForm(v=>!v)}>+ New Purchase Order</button>
      </div>}

      {showForm&&<div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:11,padding:16,marginBottom:14,display:"flex",flexDirection:"column",gap:11}}>
        <div style={{fontWeight:700,fontSize:14}}>New Purchase Order</div>
        <div className="fr2">
          <Fld label="Part *">
            <select className="sel" value={f.partId} onChange={e=>pickPart(e.target.value)}>
              <option value="">— Select Part —</option>
              {parts.map(p=><option key={p.id} value={p.id}>{p.name}{p.qty!=null?` (Stock: ${p.qty})`:""}  {(p.qty||0)<=(p.minQty||1)?" ⚠️ LOW":""}</option>)}
            </select>
          </Fld>
          <Fld label="Supplier"><input className="inp" value={f.supplier} onChange={e=>sf("supplier",e.target.value)} placeholder="Supplier name"/></Fld>
        </div>
        <div className="fr3">
          <Fld label="Qty *"><input className="inp" type="number" min="1" value={f.qty} onChange={e=>sf("qty",e.target.value)}/></Fld>
          <Fld label="Unit Cost (R)"><input className="inp" type="number" step="0.01" value={f.unitCost} onChange={e=>sf("unitCost",e.target.value)}/></Fld>
          <Fld label="Expected Delivery"><input className="inp" type="date" value={f.expectedDate} onChange={e=>sf("expectedDate",e.target.value)}/></Fld>
        </div>
        {f.qty&&f.unitCost&&<div style={{background:"var(--s2)",borderRadius:8,padding:"8px 12px",fontSize:13}}>Total: <strong style={{color:"var(--acc)"}}>R {(Number(f.qty)*Number(f.unitCost)).toFixed(2)}</strong></div>}
        <Fld label="Notes"><textarea className="ta" value={f.notes} onChange={e=>sf("notes",e.target.value)} placeholder="Delivery instructions, special requirements…" style={{minHeight:50}}/></Fld>
        <div style={{display:"flex",gap:8}}><button className="btn bp bsm" onClick={savePO}>Save PO</button><button className="btn bg2 bsm" onClick={()=>setShowForm(false)}>Cancel</button></div>
      </div>}

      {purchaseOrders.length===0?<div className="empty"><div className="ei">📦</div><div>No purchase orders yet</div><div style={{fontSize:12,color:"var(--mu)",marginTop:6}}>Create purchase orders when parts need restocking</div></div>
        :<div className="cg">{purchaseOrders.map(po=>(
          <div key={po.id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
              <div><div style={{fontWeight:700,fontSize:13}}>{po.poNumber}</div><div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>{po.partName}</div></div>
              <span className="bdg" style={{color:statusColor[po.status]||"var(--mu)",background:"rgba(0,0,0,.06)",fontSize:10}}>{po.status}</span>
            </div>
            <div className="crow"><span className="crl">Supplier</span><span className="crv">{po.supplier||"—"}</span></div>
            <div className="crow"><span className="crl">Qty</span><span className="crv">{po.qty}</span></div>
            <div className="crow"><span className="crl">Total cost</span><span className="crv" style={{fontWeight:700}}>R {Number(po.totalCost||0).toFixed(2)}</span></div>
            <div className="crow"><span className="crl">Expected</span><span className="crv">{po.expectedDate?fmtD(po.expectedDate):"—"}</span></div>
            {po.notes&&<div style={{fontSize:11,color:"var(--mu2)",marginTop:6,borderTop:"1px solid var(--rim)",paddingTop:6}}>{po.notes}</div>}
            <div className="cacts" style={{marginTop:8}}>
              <button className="btn bg2 bxs" onClick={()=>pdf(po)}>📄 PDF</button>
              {po.status!=="Received"&&isCtrl&&<button className="btn bgrn bxs" onClick={async()=>await FS.set("purchase_orders",po.id,{...po,status:"Received",receivedAt:nowISO()})}>✓ Received</button>}
              {po.status==="Pending"&&isCtrl&&<button className="btn bg2 bxs" onClick={async()=>await FS.set("purchase_orders",po.id,{...po,status:"Sent"})}>Mark Sent</button>}
            </div>
          </div>
        ))}</div>}
    </>
  );
}

// ── DEVICE HEALTH SCORECARDS ──────────────────────────────────
function DeviceHealthPage({devices,tickets,clients,parts}){
  const [sel,setSel]=useState(null);
  const [filterClient,setFilterClient]=useState("");

  function scoreDevice(d){
    const devTickets=tickets.filter(t=>t.deviceId===d.id);
    const last90=new Date(Date.now()-90*24*60*60*1000);
    const recentTickets=devTickets.filter(t=>new Date(t.createdAt)>last90);
    const resolved=devTickets.filter(t=>["Resolved","Closed"].includes(t.status));
    const comebacks=devTickets.filter(t=>t.isComeback);
    const lastResolved=devTickets.filter(t=>t.resolvedAt).sort((a,b)=>b.resolvedAt.localeCompare(a.resolvedAt))[0];
    const daysSinceLast=lastResolved?Math.floor((Date.now()-new Date(lastResolved.resolvedAt))/(1000*60*60*24)):null;

    // Score: start at 100, deduct for issues
    let score=100;
    score-=Math.min(recentTickets.length*8,40);   // frequent breakdowns
    score-=Math.min(comebacks.length*12,24);       // comebacks are serious
    if(daysSinceLast!==null&&daysSinceLast<14) score-=10; // recently broken
    score=Math.max(0,Math.min(100,score));

    const grade=score>=80?"Good":score>=60?"Fair":score>=40?"Poor":"Critical";
    const gradeColor=score>=80?"var(--grn)":score>=60?"var(--amb)":score>=40?"#f97316":"var(--red)";

    return{score,grade,gradeColor,totalTickets:devTickets.length,recentTickets:recentTickets.length,resolved:resolved.length,comebacks:comebacks.length,daysSinceLast,lastResolved};
  }

  const scored=devices.map(d=>({...d,health:scoreDevice(d)}));
  const filtered=scored.filter(d=>!filterClient||d.clientId===filterClient);
  const critical=scored.filter(d=>d.health.grade==="Critical");
  const poor=scored.filter(d=>d.health.grade==="Poor");

  const selDev=sel?scored.find(d=>d.id===sel):null;
  const selDevTickets=sel?tickets.filter(t=>t.deviceId===sel).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];

  const ScoreRing=({score,color})=>(
    <div style={{width:64,height:64,borderRadius:"50%",border:`4px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:"var(--s2)"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:16,fontWeight:700,color,lineHeight:1}}>{score}</div>
        <div style={{fontSize:8,color:"var(--mu)",marginTop:1}}>/ 100</div>
      </div>
    </div>
  );

  return(
    <>
      {critical.length>0&&<div style={{background:"rgba(240,80,96,.10)",border:"1px solid var(--red)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13}}>🚨 <strong>{critical.length}</strong> device{critical.length!==1?"s":""} in critical health — {critical.map(d=>d.brand+" "+d.model).slice(0,3).join(", ")}{critical.length>3?` +${critical.length-3} more`:""}.</div>}
      {poor.length>0&&<div style={{background:"rgba(249,115,22,.10)",border:"1px solid #f97316",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13}}>⚠️ <strong>{poor.length}</strong> device{poor.length!==1?"s":""} in poor health — consider proactive maintenance.</div>}

      <div className="sg" style={{marginBottom:14}}>
        {[
          {n:devices.length,l:"Total Devices",c:"var(--blue)"},
          {n:scored.filter(d=>d.health.grade==="Good").length,l:"Good",c:"var(--grn)"},
          {n:scored.filter(d=>d.health.grade==="Fair").length,l:"Fair",c:"var(--amb)"},
          {n:scored.filter(d=>d.health.grade==="Poor").length,l:"Poor",c:"#f97316"},
          {n:critical.length,l:"Critical",c:"var(--red)"},
        ].map(s=><div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>)}
      </div>

      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <select className="fsl" value={filterClient} onChange={e=>setFilterClient(e.target.value)}>
          <option value="">All Clients</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {sel&&<button className="btn bg2 bsm" onClick={()=>setSel(null)}>← All Devices</button>}
      </div>

      {!sel&&<div className="cg">
        {filtered.sort((a,b)=>a.health.score-b.health.score).map(d=>{
          const cl=clients.find(c=>c.id===d.clientId);
          return(
            <div key={d.id} className="card" style={{cursor:"pointer"}} onClick={()=>setSel(d.id)}>
              <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
                <ScoreRing score={d.health.score} color={d.health.gradeColor}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.brand} {d.model}</div>
                  <div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>{cl?.name||"—"}</div>
                  <span className="bdg" style={{background:`rgba(0,0,0,.06)`,color:d.health.gradeColor,fontSize:10,marginTop:4,display:"inline-block"}}>{d.health.grade}</span>
                </div>
              </div>
              <div className="crow"><span className="crl">Tickets (90 days)</span><span className="crv" style={{color:d.health.recentTickets>3?"var(--red)":d.health.recentTickets>1?"var(--amb)":"var(--grn)"}}>{d.health.recentTickets}</span></div>
              <div className="crow"><span className="crl">Comebacks</span><span className="crv" style={{color:d.health.comebacks>0?"var(--red)":"var(--grn)"}}>{d.health.comebacks}</span></div>
              {d.health.daysSinceLast!==null&&<div className="crow"><span className="crl">Last resolved</span><span className="crv">{d.health.daysSinceLast}d ago</span></div>}
              <div className="crow"><span className="crl">Serial</span><span className="crv mono" style={{fontSize:11}}>{d.serial||"—"}</span></div>
            </div>
          );
        })}
        {filtered.length===0&&<div className="empty"><div className="ei">❤️</div><div>No devices to display</div></div>}
      </div>}

      {selDev&&<>
        <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:16,background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:"14px 16px"}}>
          <ScoreRing score={selDev.health.score} color={selDev.health.gradeColor}/>
          <div>
            <div style={{fontWeight:700,fontSize:16}}>{selDev.brand} {selDev.model}</div>
            <div style={{fontSize:12,color:"var(--mu2)",marginTop:2}}>S/N: {selDev.serial||"—"} · {clients.find(c=>c.id===selDev.clientId)?.name||"—"}</div>
            <span className="bdg" style={{background:`rgba(0,0,0,.06)`,color:selDev.health.gradeColor,marginTop:6,display:"inline-block"}}>{selDev.health.grade} Health</span>
          </div>
        </div>
        <div className="sg" style={{marginBottom:14}}>
          {[
            {n:selDev.health.totalTickets,l:"Total Tickets",c:"var(--blue)"},
            {n:selDev.health.recentTickets,l:"Last 90 days",c:selDev.health.recentTickets>3?"var(--red)":"var(--amb)"},
            {n:selDev.health.resolved,l:"Resolved",c:"var(--grn)"},
            {n:selDev.health.comebacks,l:"Comebacks",c:selDev.health.comebacks>0?"var(--red)":"var(--grn)"},
          ].map(s=><div className="sc" key={s.l}><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>)}
        </div>
        <div style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>Health Breakdown</div>
          {[
            {label:"Breakdown frequency",note:selDev.health.recentTickets>3?"High — "+selDev.health.recentTickets+" tickets in 90 days":selDev.health.recentTickets>1?"Moderate":"Good"},
            {label:"Comeback rate",note:selDev.health.comebacks>0?`${selDev.health.comebacks} repeat visit${selDev.health.comebacks!==1?"s":""}  — investigate root cause`:"None detected"},
            {label:"Time since last repair",note:selDev.health.daysSinceLast===null?"No resolved tickets yet":selDev.health.daysSinceLast<14?"Recently repaired ("+selDev.health.daysSinceLast+" days ago)":selDev.health.daysSinceLast+" days ago"},
            {label:"Recommendation",note:selDev.health.grade==="Good"?"No action needed — continue monitoring":selDev.health.grade==="Fair"?"Schedule preventive maintenance soon":selDev.health.grade==="Poor"?"Urgent maintenance required — consider replacement review":"⚠️ Device may be approaching end-of-life — discuss replacement with client"},
          ].map(({label,note})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--rim)",fontSize:12}}>
              <span style={{color:"var(--mu2)",flexShrink:0,marginRight:12}}>{label}</span>
              <span style={{textAlign:"right"}}>{note}</span>
            </div>
          ))}
        </div>
        <div className="sect">Ticket History<span/></div>
        {selDevTickets.length===0?<div className="empty"><div className="ei">🎫</div><div>No tickets</div></div>:selDevTickets.slice(0,10).map(t=>(
          <div key={t.id} style={{background:"var(--s1)",border:"1px solid var(--rim)",borderRadius:9,padding:"10px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
              <div><div style={{fontWeight:600,fontSize:12}}>{t.id}</div><div style={{fontSize:11,color:"var(--mu2)",marginTop:2}}>{t.title}</div></div>
              <span className="bdg" style={{fontSize:9,background:"rgba(0,0,0,.06)",color:["Resolved","Closed"].includes(t.status)?"var(--grn)":"var(--amb)"}}>{t.status}</span>
            </div>
            <div style={{fontSize:10,color:"var(--mu)",marginTop:5}}>{fmtD(t.createdAt)}{t.isComeback?" · 🔁 Comeback":""}</div>
          </div>
        ))}
      </>}
    </>
  );
}

function generatePDF(content, filename) {
  const printWindow = window.open('', '', 'height=600,width=800');
  printWindow.document.write('<html><head><title>' + filename + '</title><style>body{margin:0;font-family:Arial,sans-serif;background:white}</style></head><body>');
  printWindow.document.write(content);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 250);
}

export default App;