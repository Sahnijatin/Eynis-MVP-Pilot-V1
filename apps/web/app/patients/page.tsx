"use client";

import { useState } from "react";
import { Users, AlertCircle, Clock } from "lucide-react";
import { ClientDetailPanel } from "../../components/ui/client-detail-panel";
import type { ClientDetailData } from "../../components/ui/client-detail-panel";
import { ImportExportButtons } from "../../components/ui/import-export-buttons";
import { TableEmpty } from "../../components/ds";

type PatientStatus = "active" | "overdue" | "due" | "lost_follow_up";

interface Patient {
  name: string; age: number; condition: string; lastVisit: string;
  nextAppt: string; visits: number; status: PatientStatus;
}

const PATIENTS: Patient[] = [
  { name: "Rahul Sharma", age: 42, condition: "Hypertension", lastVisit: "26 May 2025", nextAppt: "9 Jun 2025", visits: 8, status: "active" },
  { name: "Priya Mehta", age: 34, condition: "Thyroid (Follow-up)", lastVisit: "26 May 2025", nextAppt: "23 Jun 2025", visits: 5, status: "active" },
  { name: "Arun Kumar", age: 58, condition: "Cardiac Monitoring", lastVisit: "14 Apr 2025", nextAppt: "26 May 2025", visits: 14, status: "overdue" },
  { name: "Sunita Gupta", age: 29, condition: "Pregnancy (28wk)", lastVisit: "22 May 2025", nextAppt: "5 Jun 2025", visits: 6, status: "active" },
  { name: "Vikram Joshi", age: 51, condition: "Annual Check-up", lastVisit: "2 Feb 2025", nextAppt: "26 May 2025", visits: 3, status: "due" },
  { name: "Amit Kumar", age: 38, condition: "Diabetes Management", lastVisit: "10 Mar 2025", nextAppt: "—", visits: 11, status: "lost_follow_up" }
];

const PATIENT_DETAILS: Record<string, ClientDetailData> = {
  "Rahul Sharma": {
    historyLabel: "Appointments",
    contact: {
      person: "Rahul Sharma",
      phone: "+91 98765 11001",
      email: "rahul.sharma@gmail.com",
      address: "A-42, Sector 15, Noida, UP 201301",
      extras: [
        { label: "Date of Birth", value: "14 Mar 1983 (42 yr)" },
        { label: "Blood Group", value: "B+" },
        { label: "Insurance", value: "Star Health — Policy SH-4829XX" },
        { label: "Emergency Contact", value: "Sunita Sharma (Wife) · +91 98765 11002" }
      ]
    },
    history: [
      { id: "APT-0142", title: "BP Monitoring + Medication Review", subtitle: "Dr. Patel · Rx: Telmisartan 40mg, Amlodipine 5mg", amount: undefined, date: "26 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0118", title: "Quarterly Check-up", subtitle: "Dr. Patel · Continue current medications", amount: undefined, date: "10 Feb 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0094", title: "BP Spike Follow-up", subtitle: "Dr. Patel · Dosage adjusted", amount: undefined, date: "5 Nov 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0071", title: "Initial Consultation", subtitle: "Dr. Patel · Hypertension diagnosed", amount: undefined, date: "3 Aug 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" }
    ],
    notes: "Patient is medication-compliant. Low-salt diet recommended. Avoid strenuous exercise until BP is stable. Follow up every 3 months. ECG due at next visit."
  },
  "Priya Mehta": {
    historyLabel: "Appointments",
    contact: {
      person: "Priya Mehta",
      phone: "+91 90210 44332",
      email: "priya.mehta@email.com",
      address: "B-12, Powai, Mumbai 400076",
      extras: [
        { label: "Date of Birth", value: "8 Jun 1991 (34 yr)" },
        { label: "Blood Group", value: "A+" },
        { label: "Insurance", value: "HDFC ERGO — Policy HE-92XXX" },
        { label: "Emergency Contact", value: "Rajan Mehta (Husband) · +91 90210 44333" }
      ]
    },
    history: [
      { id: "APT-0144", title: "Thyroid Function Test Review", subtitle: "Dr. Krishnan · TSH 4.2 — borderline", amount: undefined, date: "26 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0127", title: "Follow-up #2 — Levothyroxine", subtitle: "Dr. Krishnan · Dose increased to 75mcg", amount: undefined, date: "28 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0109", title: "Thyroid Diagnosis Visit", subtitle: "Dr. Krishnan · Hypothyroid confirmed", amount: undefined, date: "14 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" }
    ],
    notes: "Hypothyroidism — Levothyroxine 75mcg daily (morning, empty stomach). TFT every 6 weeks until stable. Patient reports fatigue reducing. No dietary iodine restriction required."
  },
  "Arun Kumar": {
    historyLabel: "Appointments",
    contact: {
      person: "Arun Kumar",
      phone: "+91 81234 56789",
      email: "arun.kumar@gmail.com",
      address: "D-7, Defence Colony, New Delhi 110024",
      extras: [
        { label: "Date of Birth", value: "22 Sep 1967 (58 yr)" },
        { label: "Blood Group", value: "O+" },
        { label: "Insurance", value: "New India Assurance — Policy NI-7812XX" },
        { label: "Emergency Contact", value: "Kavita Kumar (Wife) · +91 81234 56790" }
      ]
    },
    history: [
      { id: "APT-0140", title: "Cardiac Monitoring — Monthly", subtitle: "Dr. Rajan · ECG stable, BP: 138/88", amount: undefined, date: "14 Apr 2025", status: "Overdue", statusColor: "#dc2626", statusBg: "#fee2e2" },
      { id: "APT-0132", title: "Post-Angioplasty Follow-up", subtitle: "Dr. Rajan · Stent patent, medications continued", amount: undefined, date: "18 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0122", title: "Angioplasty + Stenting", subtitle: "Dr. Rajan · RCA stent placed, ICU 2 days", amount: undefined, date: "4 Feb 2025", status: "Procedure", statusColor: "#1d4ed8", statusBg: "#eff6ff" },
      { id: "APT-0118", title: "Emergency Admission — Chest Pain", subtitle: "Dr. Rajan · Admitted, NSTEMI confirmed", amount: undefined, date: "1 Feb 2025", status: "Emergency", statusColor: "#dc2626", statusBg: "#fee2e2" }
    ],
    notes: "HIGH PRIORITY — Post-NSTEMI, RCA stent (Feb 2025). Monthly cardiac follow-up is CRITICAL. Currently 6 weeks overdue. Call patient immediately. Medications: Aspirin 75mg, Clopidogrel 75mg, Atorvastatin 40mg, Bisoprolol 2.5mg."
  },
  "Sunita Gupta": {
    historyLabel: "Appointments",
    contact: {
      person: "Sunita Gupta",
      phone: "+91 97654 32100",
      email: "sunita.gupta@email.com",
      address: "E-9, Indiranagar, Bengaluru 560038",
      extras: [
        { label: "Date of Birth", value: "14 Nov 1996 (29 yr)" },
        { label: "Blood Group", value: "AB+" },
        { label: "Insurance", value: "Religare Health — Policy RE-3341XX" },
        { label: "Emergency Contact", value: "Rohit Gupta (Husband) · +91 97654 32101" }
      ]
    },
    history: [
      { id: "APT-0146", title: "Antenatal Visit — 28 Weeks", subtitle: "Dr. Sharma · Vitals stable, fundal height normal", amount: undefined, date: "22 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0138", title: "Anomaly Scan (Level 2)", subtitle: "Dr. Sharma · No anomalies detected", amount: undefined, date: "30 Apr 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0129", title: "Glucose Tolerance Test", subtitle: "Dr. Sharma · GDM ruled out", amount: undefined, date: "4 Apr 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0114", title: "First Trimester Scan", subtitle: "Dr. Sharma · EDD confirmed 28 Aug 2025", amount: undefined, date: "14 Feb 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" }
    ],
    notes: "EDD: 28 Aug 2025. Fortnightly visits until 36 weeks, then weekly. Iron + folic acid supplementation ongoing. No gestational complications so far. Birth plan discussion at 34-week visit."
  },
  "Vikram Joshi": {
    historyLabel: "Appointments",
    contact: {
      person: "Vikram Joshi",
      phone: "+91 99100 22341",
      email: "vikram.joshi@email.com",
      address: "F-14, Andheri West, Mumbai 400053",
      extras: [
        { label: "Date of Birth", value: "3 Mar 1974 (51 yr)" },
        { label: "Blood Group", value: "B-" },
        { label: "Insurance", value: "Bajaj Allianz — Policy BA-5502XX" },
        { label: "Emergency Contact", value: "Meena Joshi (Wife) · +91 99100 22342" }
      ]
    },
    history: [
      { id: "APT-0098", title: "Annual Health Check-up", subtitle: "Dr. Mehta · Lipid panel ordered", amount: undefined, date: "2 Feb 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0064", title: "Annual Health Check-up", subtitle: "Dr. Mehta · All parameters normal", amount: undefined, date: "5 Feb 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0038", title: "Annual Health Check-up", subtitle: "Dr. Mehta · Mild dyslipidemia noted", amount: undefined, date: "10 Feb 2023", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" }
    ],
    notes: "Annual check-up is DUE TODAY. Lipid results from Feb 2025 showed elevated LDL (160 mg/dL) — requires review and potential statin initiation. WhatsApp reminder sent. Call if no response by EOD."
  },
  "Amit Kumar": {
    historyLabel: "Appointments",
    contact: {
      person: "Amit Kumar",
      phone: "+91 98811 44900",
      email: "amit.kumar@email.com",
      address: "H-6, Vasant Kunj, New Delhi 110070",
      extras: [
        { label: "Date of Birth", value: "19 Jul 1987 (38 yr)" },
        { label: "Blood Group", value: "O-" },
        { label: "Insurance", value: "Max Bupa — Policy MB-7734XX" },
        { label: "Emergency Contact", value: "Pooja Kumar (Wife) · +91 98811 44901" }
      ]
    },
    history: [
      { id: "APT-0135", title: "HbA1c Review — 10 Mar 2025", subtitle: "Dr. Nair · HbA1c: 7.4%, Metformin 1000mg continued", amount: undefined, date: "10 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0124", title: "Diabetic Foot Exam", subtitle: "Dr. Nair · No neuropathy detected", amount: undefined, date: "15 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "APT-0115", title: "Quarterly HbA1c Check", subtitle: "Dr. Nair · HbA1c: 7.8%, diet counselling", amount: undefined, date: "20 Oct 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" }
    ],
    notes: "LOST TO FOLLOW-UP — No appointment since 10 Mar 2025 (3 months). Quarterly follow-up is essential for diabetes management. HbA1c target <7%. WhatsApp + SMS sent. No response. Medications: Metformin 1000mg BD, Glipizide 5mg OD."
  }
};

function getPatientDetail(name: string): ClientDetailData {
  return PATIENT_DETAILS[name] ?? {
    historyLabel: "Appointments",
    contact: { person: name, phone: "—", email: "—" },
    history: [],
    notes: ""
  };
}

const STATUS_MAP: Record<PatientStatus, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#059669", bg: "#d1fae5" },
  overdue: { label: "Overdue", color: "#dc2626", bg: "#fee2e2" },
  due: { label: "Due Today", color: "#d97706", bg: "#fef3c7" },
  lost_follow_up: { label: "Lost Follow-up", color: "#7c3aed", bg: "#f5f3ff" }
};

function StatusBadge({ status }: { status: PatientStatus }) {
  const s = STATUS_MAP[status];
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

const ACCENT = "#0891b2";

export default function PatientsPage() {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patients, setPatients] = useState<Patient[]>(PATIENTS);

  const atRisk = patients.filter(p => ["overdue", "lost_follow_up"].includes(p.status)).length;
  const dueToday = patients.filter(p => p.status === "due").length;
  const avgVisits = Math.round(patients.reduce((s, p) => s + p.visits, 0) / Math.max(patients.length, 1));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Patient Records</h1>
          <p className="text-sm text-slate-500 mt-0.5">Patient history · follow-up tracking · condition management</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={patients}
            columns={[
              { label: "Name", value: "name" },
              { label: "Age", value: "age" },
              { label: "Condition", value: "condition" },
              { label: "Last Visit", value: "lastVisit" },
              { label: "Next Appointment", value: "nextAppt" },
              { label: "Visits", value: "visits" },
              { label: "Status", value: "status" },
            ]}
            fileBase="patients"
            accentColor={ACCENT}
            onImport={(rows) => {
              const next: Patient[] = rows
                .map(r => ({
                  name: r["Name"] ?? "",
                  age: Number(r["Age"] ?? 0) || 0,
                  condition: r["Condition"] ?? "",
                  lastVisit: r["Last Visit"] ?? "",
                  nextAppt: r["Next Appointment"] ?? "",
                  visits: Number(r["Visits"] ?? 0) || 0,
                  status: ((["active", "overdue", "due", "lost_follow_up"] as PatientStatus[]).includes(r["Status"] as PatientStatus) ? r["Status"] : "active") as PatientStatus,
                }))
                .filter(p => p.name);
              if (next.length) setPatients(prev => [...next, ...prev]);
              return { count: next.length };
            }}
          />
          <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: ACCENT }}>+ Register Patient</button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Total Patients</div>
          <div className="kpi-value mt-1.5">{PATIENTS.length}</div>
          <div className="kpi-delta neutral mt-1.5">+2 new this week</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f43f5e" }}>
          <div className="kpi-label">Overdue / Lost</div>
          <div className="kpi-value mt-1.5" style={{ color: "#dc2626" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">Needs follow-up call</div>
        </div>
        <div className="card">
          <div className="kpi-label">Due Today</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{dueToday}</div>
          <div className="kpi-delta neutral mt-1.5">Remind via WhatsApp</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Visits / Patient</div>
          <div className="kpi-value mt-1.5">{avgVisits}</div>
          <div className="kpi-delta up mt-1.5">Strong retention</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-cyan-600" />
          <h3 className="card-title mb-0">Patient Directory</h3>
          <span className="text-xs text-slate-500 font-normal ml-1">— click a row to view full record</span>
        </div>
        <div className="table-wrap">
          <table className="data-table no-row-hover">
            <thead>
              <tr>
                {["Patient", "Age", "Condition", "Last Visit", "Next Appointment", "Visits", "Status"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map((p, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedPatient(p)}
                  className={`hover:bg-cyan-50 transition-colors cursor-pointer group ${p.status === "lost_follow_up" ? "bg-purple-50" : p.status === "overdue" ? "bg-red-50" : ""}`}
                >
                  <td>
                    <span className="font-semibold text-slate-800 group-hover:text-cyan-700 transition-colors">{p.name}</span>
                  </td>
                  <td className="text-slate-500">{p.age}</td>
                  <td className="text-slate-600 text-xs">{p.condition}</td>
                  <td className="text-xs text-slate-500">{p.lastVisit}</td>
                  <td className="text-xs font-medium text-slate-700">{p.nextAppt}</td>
                  <td className="text-slate-600">{p.visits}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
              {patients.length === 0 && (
                <TableEmpty colSpan={7} icon="🩺" title="No patients yet" description="Registered patients will appear here." />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attention banner for critical patients */}
      {patients.filter(p => p.status === "overdue" || p.status === "lost_follow_up").length > 0 && (
        <div className="mt-4 card border border-red-200" style={{ background: "#fff5f5" }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <h3 className="card-title mb-0 text-red-700">Immediate Follow-up Required</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {patients.filter(p => p.status === "overdue" || p.status === "lost_follow_up").map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPatient(p)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
                style={p.status === "overdue" ? { background: "#fee2e2", borderColor: "#fca5a5", color: "#dc2626" } : { background: "#f5f3ff", borderColor: "#c4b5fd", color: "#7c3aed" }}
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="font-semibold">{p.name}</span>
                <span className="text-xs opacity-75">— {p.condition}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CRM Detail Panel */}
      {selectedPatient && (
        <ClientDetailPanel
          open={true}
          onClose={() => setSelectedPatient(null)}
          name={selectedPatient.name}
          subtitle={`${selectedPatient.age} yr · ${selectedPatient.condition}`}
          kpis={[
            { label: "Total Visits", value: String(selectedPatient.visits) },
            { label: "Last Visit", value: selectedPatient.lastVisit },
            { label: "Next Appointment", value: selectedPatient.nextAppt },
            { label: "Status", value: STATUS_MAP[selectedPatient.status].label }
          ]}
          detail={getPatientDetail(selectedPatient.name)}
          accentColor={ACCENT}
          headerChildren={<StatusBadge status={selectedPatient.status} />}
        />
      )}
    </div>
  );
}
