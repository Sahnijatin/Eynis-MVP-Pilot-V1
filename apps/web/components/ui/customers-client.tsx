"use client";

import { useState } from "react";
import { AlertCircle, TrendingUp, X, CheckCircle, Star, Plane } from "lucide-react";
import type { IndustryTerminology } from "../../lib/industry-config";
import { ClientDetailPanel, type ClientDetailData } from "./client-detail-panel";
import { ImportExportButtons } from "./import-export-buttons";

// ─────────────────────────────────────────────────────────────────────────────
// MANUFACTURING — B2B Client Intelligence
// ─────────────────────────────────────────────────────────────────────────────

const MFG_CLIENTS_INIT = [
  { name: "Marriott Hotels India",  type: "Corporate",         ltv: "₹1.84 Cr", lastOrder: "12 May 2025", orders: 14, status: "active",     segment: "key" },
  { name: "Patel Architects LLP",   type: "Architect/Channel", ltv: "₹68.4L",   lastOrder: "22 May 2025", orders: 9,  status: "active",     segment: "channel" },
  { name: "Kapoor Developers",      type: "Real Estate",       ltv: "₹92.0L",   lastOrder: "8 Apr 2025",  orders: 7,  status: "dormant_60", segment: "at-risk" },
  { name: "The Leela Group",        type: "Hospitality",       ltv: "₹2.1 Cr",  lastOrder: "3 Jun 2024",  orders: 22, status: "dormant_90", segment: "dormant" },
  { name: "Sharma Retail Chains",   type: "Retail",            ltv: "₹34.2L",   lastOrder: "18 May 2025", orders: 5,  status: "active",     segment: "growth" },
  { name: "ITC Hotels",             type: "Hospitality",       ltv: "₹1.1 Cr",  lastOrder: "26 May 2025", orders: 11, status: "active",     segment: "key" },
  { name: "Tata Housing Ltd.",      type: "Real Estate",       ltv: "₹58.0L",   lastOrder: "15 Mar 2025", orders: 8,  status: "dormant_60", segment: "at-risk" },
];

const MFG_CLIENT_DETAILS: Record<string, ClientDetailData> = {
  "Marriott Hotels India": {
    contact: { person: "Rajesh Mehta", role: "Procurement Director", phone: "+91 98765 43210", email: "rajesh.mehta@marriott.in", address: "Marriott HQ, Aerocity, New Delhi - 110037", extras: [{ label: "GST", value: "07AABCM1234F1Z5" }, { label: "Payment Terms", value: "Net 45 days" }, { label: "Credit Limit", value: "₹50L" }] },
    history: [
      { id: "ORD-2841", title: "Teak Lobby Benches × 24", subtitle: "Custom finish, brass hardware", amount: "₹18.4L", date: "12 May 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2734", title: "Conference Tables × 6", subtitle: "Mahogany, executive grade", amount: "₹14.2L", date: "8 Mar 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2652", title: "Reception Desk Unit", subtitle: "Custom 3.8m wide", amount: "₹9.8L", date: "12 Jan 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "Prefers teak and mahogany. Always requires brass hardware. Rajesh prefers WhatsApp updates.",
  },
  "Patel Architects LLP": {
    contact: { person: "Ankit Patel", role: "Principal Architect", phone: "+91 99887 76655", email: "ankit@patelarchitects.com", address: "Bandra West, Mumbai - 400050", extras: [{ label: "GST", value: "27AAAFP1234B1ZA" }, { label: "Payment Terms", value: "Net 30 days" }] },
    history: [
      { id: "ORD-2812", title: "Modular Workstations × 40", subtitle: "Open-plan fit-out", amount: "₹22.8L", date: "22 May 2025", status: "In Production", statusColor: "#d97706", statusBg: "#fef3c7" },
      { id: "ORD-2711", title: "Executive Boardroom Set", subtitle: "10-seater, walnut finish", amount: "₹9.4L", date: "14 Feb 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "Channel partner — 3–4 referrals/quarter. Needs 3D renders before sign-off.",
  },
  "Kapoor Developers": {
    contact: { person: "Sunita Kapoor", role: "VP - Projects", phone: "+91 98112 34567", email: "sunita@kapoordevelopers.com", address: "Sector 18, Gurugram - 122001", extras: [{ label: "Payment Terms", value: "Net 60 days" }] },
    history: [
      { id: "ORD-2789", title: "Villa Bedroom Furniture × 12 units", amount: "₹31.2L", date: "8 Apr 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2640", title: "Lobby Seating — Prestige Tower", amount: "₹18.8L", date: "5 Dec 2024", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "At risk — last order 60d ago. Phase 3 starts Q4. Send re-engagement offer.",
  },
  "The Leela Group": {
    contact: { person: "Priya Nair", role: "Corporate Procurement", phone: "+91 80123 45678", email: "procurement@theleela.com", address: "The Leela Palace, Bengaluru - 560008", extras: [{ label: "GST", value: "29AABCT1234C1ZB" }, { label: "Contract", value: "Annual rate card" }] },
    history: [
      { id: "ORD-2422", title: "Spa Furniture Package", amount: "₹44.6L", date: "3 Jun 2024", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2318", title: "Presidential Suite Fit-out", amount: "₹62.1L", date: "8 Jan 2024", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "Dormant 90d+ — historically highest-value account. Escalate to senior sales.",
  },
  "Sharma Retail Chains": {
    contact: { person: "Deepak Sharma", role: "Store Development Head", phone: "+91 95556 78901", email: "deepak@sharmaretail.com", address: "Connaught Place, New Delhi - 110001", extras: [{ label: "Outlets", value: "14 stores across NCR" }] },
    history: [
      { id: "ORD-2831", title: "Retail Display Units × 60", amount: "₹14.8L", date: "18 May 2025", status: "In Transit", statusColor: "#d97706", statusBg: "#fef3c7" },
      { id: "ORD-2770", title: "Cash Counter Modules × 14", amount: "₹8.4L", date: "2 Mar 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "Growth account — expanding to 6 new stores in Q3.",
  },
  "ITC Hotels": {
    contact: { person: "Manish Agarwal", role: "VP Procurement", phone: "+91 33456 78901", email: "manish.agarwal@itchotels.in", address: "37 J.L. Nehru Road, Kolkata - 700071", extras: [{ label: "Contract Value", value: "₹3Cr+ annually" }, { label: "Payment Terms", value: "Net 45 days" }] },
    history: [
      { id: "ORD-2848", title: "Banquet Hall Chairs × 500", amount: "₹28.5L", date: "26 May 2025", status: "In Production", statusColor: "#d97706", statusBg: "#fef3c7" },
      { id: "ORD-2801", title: "Restaurant Seating Revamp", amount: "₹19.2L", date: "10 Apr 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2744", title: "Guest Room Furniture Package", amount: "₹38.7L", date: "15 Jan 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "Key account — priority handling. Manish expects weekly status updates.",
  },
  "Tata Housing Ltd.": {
    contact: { person: "Ravi Krishnan", role: "Head of Projects", phone: "+91 22345 67890", email: "ravi.k@tatahousing.com", address: "Bombay House, Homi Mody St, Mumbai - 400001", extras: [{ label: "Payment Terms", value: "Net 60 days" }] },
    history: [
      { id: "ORD-2698", title: "Apartment Kitchen Modules × 80", amount: "₹26.4L", date: "15 Mar 2025", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "ORD-2601", title: "Common Area Furniture", amount: "₹12.8L", date: "4 Nov 2024", status: "Delivered", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Orders", notes: "At risk — next project starts Q4. Reach out before competitor quotes.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// F&B — Loyalty / Diner Database
// ─────────────────────────────────────────────────────────────────────────────

const FNB_CLIENTS_INIT = [
  { name: "Anjali Mehta",   tier: "VIP Platinum", spend: "₹1.84L", visits: 48, lastVisit: "29 May 2025", avgBill: "₹3,833", status: "active",  segment: "vip" },
  { name: "Rahul Shah",     tier: "Gold",         spend: "₹98.4K", visits: 32, lastVisit: "24 May 2025", avgBill: "₹3,075", status: "active",  segment: "regular" },
  { name: "Priya Nair",     tier: "VIP Platinum", spend: "₹2.12L", visits: 52, lastVisit: "28 May 2025", avgBill: "₹4,077", status: "active",  segment: "vip" },
  { name: "Kiran Rao",      tier: "Silver",       spend: "₹42.0K", visits: 14, lastVisit: "14 Mar 2025", avgBill: "₹3,000", status: "dormant", segment: "occasional" },
  { name: "Sanjay Gupta",   tier: "Gold",         spend: "₹76.3K", visits: 28, lastVisit: "20 May 2025", avgBill: "₹2,725", status: "active",  segment: "regular" },
  { name: "Neha Verma",     tier: "New Member",   spend: "₹12.6K", visits: 4,  lastVisit: "22 May 2025", avgBill: "₹3,150", status: "active",  segment: "new" },
  { name: "Deepak Joshi",   tier: "Silver",       spend: "₹38.8K", visits: 11, lastVisit: "28 Jan 2025", avgBill: "₹3,527", status: "dormant", segment: "occasional" },
];

const FNB_CLIENT_DETAILS: Record<string, ClientDetailData> = {
  "Anjali Mehta": {
    contact: { person: "Anjali Mehta", phone: "+91 98001 11223", email: "anjali.mehta@gmail.com", extras: [{ label: "Loyalty Points", value: "4,820 pts" }, { label: "Birthday", value: "14 Aug" }, { label: "Dietary", value: "No pork, gluten-sensitive" }, { label: "Preferred Table", value: "Corner booth (Table 12)" }] },
    history: [
      { id: "VIS-0412", title: "Dinner — Table 12", subtitle: "Wagyu Tenderloin, Truffle Risotto, Negroni × 2", amount: "₹8,400", date: "29 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0388", title: "Dinner — Table 12", subtitle: "Lobster Thermidor, Burrata, Champagne", amount: "₹9,200", date: "10 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0371", title: "Birthday Dinner (party of 6)", subtitle: "Chef's tasting menu × 6, cake arranged", amount: "₹32,400", date: "14 Apr 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0352", title: "Lunch — Table 8", subtitle: "Pasta, Tiramisu, Sparkling water", amount: "₹3,800", date: "22 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "VIP Platinum. Prefers corner table away from kitchen. Loves truffle dishes. Always orders Negroni. Send personalized offer for truffle season menu.",
  },
  "Rahul Shah": {
    contact: { person: "Rahul Shah", phone: "+91 99334 45566", email: "rahul.shah@outlook.com", extras: [{ label: "Loyalty Points", value: "2,340 pts" }, { label: "Dietary", value: "Vegetarian" }, { label: "Preferred Time", value: "Weekday evenings" }] },
    history: [
      { id: "VIS-0409", title: "Dinner — Table 6", subtitle: "Mushroom Risotto, Panna Cotta, Red wine", amount: "₹4,200", date: "24 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0392", title: "Dinner — Table 4", subtitle: "Pasta Primavera, Tiramisu, Cocktail", amount: "₹3,800", date: "12 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "Gold member. Strict vegetarian. Usually brings spouse on weekday evenings. Loyal for 2 years.",
  },
  "Priya Nair": {
    contact: { person: "Priya Nair", phone: "+91 80111 22334", email: "priya.nair@gmail.com", extras: [{ label: "Loyalty Points", value: "5,910 pts" }, { label: "Birthday", value: "3 Dec" }, { label: "Preferred Seat", value: "Window seat, non-smoking" }] },
    history: [
      { id: "VIS-0411", title: "Dinner — Table 2 (window)", subtitle: "Salmon Gravlax, Duck Confit, Dessert platter", amount: "₹7,800", date: "28 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0399", title: "Business Lunch — Table 2", subtitle: "Set menu × 3, still water, espresso", amount: "₹6,300", date: "18 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "Top spender. Often brings corporate guests for business lunches. Invite to exclusive wine pairing dinners.",
  },
  "Kiran Rao": {
    contact: { person: "Kiran Rao", phone: "+91 91223 34455", email: "kiran.rao@yahoo.com", extras: [{ label: "Loyalty Points", value: "820 pts" }, { label: "Dietary", value: "No seafood" }] },
    history: [
      { id: "VIS-0334", title: "Dinner — Table 9", subtitle: "Lamb Rack, Chocolate Fondant, Beer", amount: "₹4,800", date: "14 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0298", title: "Weekend Brunch", subtitle: "Eggs Benedict, Mimosa", amount: "₹2,200", date: "12 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "Occasional visitor — last visit 75d ago. Send re-engagement offer (20% off next visit).",
  },
  "Sanjay Gupta": {
    contact: { person: "Sanjay Gupta", phone: "+91 97889 00112", email: "sanjay.g@hotmail.com", extras: [{ label: "Loyalty Points", value: "1,920 pts" }, { label: "Preferred", value: "Sports table near bar" }] },
    history: [
      { id: "VIS-0407", title: "Dinner — Bar Area", subtitle: "Burger, Wings, 4 beers", amount: "₹3,200", date: "20 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0390", title: "Dinner with friends (4)", subtitle: "Sharing platters, cocktails × 6", amount: "₹8,400", date: "5 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "Regular with friend groups. High group-spend events. Send offer for group dining experiences.",
  },
  "Neha Verma": {
    contact: { person: "Neha Verma", phone: "+91 96001 33445", email: "neha.verma@gmail.com", extras: [{ label: "Loyalty Points", value: "310 pts" }, { label: "Joined", value: "Apr 2025" }] },
    history: [
      { id: "VIS-0408", title: "Dinner — Table 5", subtitle: "Pasta, Wine, Crème brûlée", amount: "₹3,400", date: "22 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0380", title: "Weekend Lunch", subtitle: "Pizza, Salad, Mocktail", amount: "₹2,100", date: "2 May 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "New member with strong visit frequency. Nurture with loyalty incentives to elevate to Gold.",
  },
  "Deepak Joshi": {
    contact: { person: "Deepak Joshi", phone: "+91 94556 67788", email: "djoshi@rediffmail.com", extras: [{ label: "Loyalty Points", value: "640 pts" }] },
    history: [
      { id: "VIS-0310", title: "Dinner — Table 3", subtitle: "Chicken Tikka, Naan, Whisky", amount: "₹4,200", date: "28 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "VIS-0279", title: "Dinner", subtitle: "Steak, Red wine", amount: "₹3,800", date: "10 Nov 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Visits", notes: "Dormant 120d+. High avg bill when active. Send win-back WhatsApp offer.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRAVEL — Client / Booking Database
// ─────────────────────────────────────────────────────────────────────────────

const TRAVEL_CLIENTS_INIT = [
  { name: "Mehta Corp",          type: "Corporate",  revenue: "₹14.2L", bookings: 12, lastBooking: "22 May 2025", status: "active",  segment: "key" },
  { name: "ABC Technologies",    type: "Corporate",  revenue: "₹9.8L",  bookings: 8,  lastBooking: "18 May 2025", status: "active",  segment: "key" },
  { name: "Arora Family",        type: "Leisure",    revenue: "₹3.4L",  bookings: 4,  lastBooking: "6 Apr 2025",  status: "active",  segment: "leisure" },
  { name: "IT Company Offsite",  type: "Group",      revenue: "₹8.6L",  bookings: 3,  lastBooking: "10 Mar 2025", status: "pending", segment: "group" },
  { name: "Sharma & Associates", type: "Corporate",  revenue: "₹5.2L",  bookings: 6,  lastBooking: "2 Feb 2025",  status: "dormant", segment: "at-risk" },
  { name: "Kapoor Family",       type: "Leisure",    revenue: "₹2.1L",  bookings: 3,  lastBooking: "14 Jan 2025", status: "dormant", segment: "leisure" },
];

const TRAVEL_CLIENT_DETAILS: Record<string, ClientDetailData> = {
  "Mehta Corp": {
    contact: { person: "Vikram Mehta", role: "Travel Manager", phone: "+91 98765 11223", email: "vikram.mehta@mehtacorp.com", address: "Mehta Corp HQ, BKC, Mumbai - 400051", extras: [{ label: "GST", value: "27AABCM5678G1Z2" }, { label: "Travel Policy", value: "Business class for C-suite, Economy otherwise" }, { label: "Preferred Airline", value: "IndiGo / Air India" }] },
    history: [
      { id: "BKG-1039", title: "Singapore Tech Summit — 5 pax", subtitle: "SIN 3–7 Jun · 4N/5D · Business class", amount: "₹4.2L", date: "22 May 2025", status: "Confirmed", statusColor: "#1d4ed8", statusBg: "#dbeafe" },
      { id: "BKG-1028", title: "Dubai Sales Conference — 8 pax", subtitle: "DXB 12–15 Apr · 3N/4D", amount: "₹3.8L", date: "28 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "BKG-1014", title: "London HQ Visit — 3 pax", subtitle: "LHR 8–13 Feb · 5N/6D", amount: "₹5.6L", date: "20 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "Key corporate account. Vikram consolidates all travel. Negotiate annual rate card for 15+ trips/year.",
  },
  "ABC Technologies": {
    contact: { person: "Anita Singh", role: "Admin Head", phone: "+91 99001 55667", email: "anita@abctech.in", address: "ABC Tech Park, Whitefield, Bengaluru - 560066", extras: [{ label: "GST", value: "29AABCA9988H1Z6" }, { label: "Preferred Hotel Chain", value: "Marriott / Taj" }] },
    history: [
      { id: "BKG-1042", title: "Team Offsite — Goa — 12 pax", subtitle: "GOI 24–27 May · 3N/4D · Resort", amount: "₹2.9L", date: "18 May 2025", status: "Confirmed", statusColor: "#1d4ed8", statusBg: "#dbeafe" },
      { id: "BKG-1031", title: "US Client Visit — 2 pax", subtitle: "JFK 1–8 Apr · 7N/8D", amount: "₹4.1L", date: "12 Mar 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "Fast-growing tech company. Quarterly offsites and frequent US/Europe trips. High potential.",
  },
  "Arora Family": {
    contact: { person: "Suresh Arora", role: "Primary Contact", phone: "+91 98112 77889", email: "suresh.arora@gmail.com", address: "Sector 22, Gurugram - 122015", extras: [{ label: "Preferences", value: "Beach resorts, luxury hotels" }, { label: "Passport", value: "Valid until Mar 2030" }] },
    history: [
      { id: "BKG-1046", title: "Maldives Honeymoon — 2 pax", subtitle: "MLE 7–14 Jun · 7N/8D · Water villa", amount: "₹2.1L", date: "6 Apr 2025", status: "Upcoming", statusColor: "#7c3aed", statusBg: "#f5f3ff" },
      { id: "BKG-1018", title: "Bali Family Trip — 4 pax", subtitle: "DPS 26–31 Dec · 5N/6D", amount: "₹1.8L", date: "4 Nov 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "Leisure family traveller. Prefers luxury beach/island destinations. Upcoming Maldives trip departing 7 Jun.",
  },
  "IT Company Offsite": {
    contact: { person: "Rajat Sharma", role: "HR Manager", phone: "+91 95556 88990", email: "rajat@itcompany.com", address: "Cyber City, Gurugram - 122002", extras: [{ label: "Attendees", value: "45 employees" }, { label: "Budget", value: "₹12,000/person" }] },
    history: [
      { id: "BKG-1046", title: "Annual Company Offsite — 45 pax", subtitle: "Coorg 20–23 Jul · 3N/4D · Resort", amount: "₹8.6L", date: "10 Mar 2025", status: "Pending Payment", statusColor: "#d97706", statusBg: "#fef3c7" },
      { id: "BKG-0998", title: "Team Outing — 20 pax", subtitle: "Jaipur 15–17 Nov · 2N/3D", amount: "₹2.4L", date: "5 Oct 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "URGENT — 0% payment received for Jul offsite. Follow up immediately. Departs in 7 weeks.",
  },
  "Sharma & Associates": {
    contact: { person: "Pradeep Sharma", role: "Partner", phone: "+91 98334 56789", email: "pradeep@sharmalaw.com", address: "Parliament Street, New Delhi - 110001", extras: [{ label: "Typical Destination", value: "Mumbai, Delhi, Bengaluru" }] },
    history: [
      { id: "BKG-1021", title: "Mumbai — 2 pax", subtitle: "BOM 10–12 Feb · 2N/3D", amount: "₹88K", date: "2 Feb 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "BKG-0992", title: "Bengaluru — 1 pax", subtitle: "BLR 18–19 Dec · 1N/2D", amount: "₹42K", date: "5 Dec 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "Domestic travel only. Dormant 120d — send re-engagement with upcoming budget season offers.",
  },
  "Kapoor Family": {
    contact: { person: "Manoj Kapoor", role: "Primary Contact", phone: "+91 94444 23456", email: "manoj.kapoor@yahoo.com", address: "Juhu, Mumbai - 400049", extras: [{ label: "Preferences", value: "Hill stations, heritage hotels" }] },
    history: [
      { id: "BKG-1008", title: "Rajasthan Heritage Tour — 4 pax", subtitle: "Jaipur/Udaipur/Jodhpur · 7N/8D", amount: "₹1.4L", date: "14 Jan 2025", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "BKG-0974", title: "Shimla — 3 pax", subtitle: "SLV 5–8 Oct · 3N/4D", amount: "₹72K", date: "20 Sep 2024", status: "Completed", statusColor: "#059669", statusBg: "#d1fae5" },
    ],
    historyLabel: "Bookings", notes: "Leisure traveller. Interested in domestic heritage circuit. Dormant 5 months — send Kerela backwaters offer.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

interface MfgClient {
  name: string; type: string; ltv: string; lastOrder: string; orders: number; status: string; segment: string;
}
interface FnbClient {
  name: string; tier: string; spend: string; visits: number; lastVisit: string; avgBill: string; status: string; segment: string;
}
interface TravelClient {
  name: string; type: string; revenue: string; bookings: number; lastBooking: string; status: string; segment: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared badge/status helpers
// ─────────────────────────────────────────────────────────────────────────────

function MfgSegmentBadge({ segment }: { segment: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    key:      { label: "Key Account",     color: "#1d4ed8", bg: "#eff6ff" },
    channel:  { label: "Channel Partner", color: "#7c3aed", bg: "#f5f3ff" },
    growth:   { label: "Growth",          color: "#059669", bg: "#d1fae5" },
    "at-risk":{ label: "At Risk",         color: "#d97706", bg: "#fef3c7" },
    dormant:  { label: "Dormant",         color: "#dc2626", bg: "#fee2e2" },
  };
  const s = map[segment] ?? map.growth;
  return <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function FnbTierBadge({ tier }: { tier: string }) {
  const isPlatinum = tier.includes("Platinum");
  const isGold = tier === "Gold";
  const isNew = tier === "New Member";
  const color = isPlatinum ? "#7c3aed" : isGold ? "#d97706" : isNew ? "#059669" : "#64748b";
  const bg = isPlatinum ? "#f5f3ff" : isGold ? "#fef3c7" : isNew ? "#d1fae5" : "#f1f5f9";
  return <span className="badge text-xs flex items-center gap-1" style={{ background: bg, color }}>{isPlatinum && <Star className="w-2.5 h-2.5" />}{tier}</span>;
}

function TravelSegmentBadge({ segment }: { segment: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    key:     { label: "Key Account", color: "#1d4ed8", bg: "#eff6ff" },
    leisure: { label: "Leisure",     color: "#7c3aed", bg: "#f5f3ff" },
    group:   { label: "Group",       color: "#059669", bg: "#d1fae5" },
    "at-risk":{ label: "At Risk",    color: "#d97706", bg: "#fef3c7" },
  };
  const s = map[segment] ?? map.leisure;
  return <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function StatusDot({ status }: { status: string }) {
  if (status === "active") return <span className="flex items-center gap-1 text-xs text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Active</span>;
  if (status === "dormant_60" || status === "dormant") return <span className="flex items-center gap-1 text-xs text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Dormant</span>;
  if (status === "dormant_90") return <span className="flex items-center gap-1 text-xs text-red-600"><span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />90d+ dormant</span>;
  if (status === "pending") return <span className="flex items-center gap-1 text-xs text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse" />Pending</span>;
  return <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  terminology: IndustryTerminology;
  industry: string;
}

export function CustomersClient({ terminology, industry }: Props) {
  const isFnb    = industry === "fnb";
  const isTravel = industry === "travel";

  // State per industry (only one will be used at runtime)
  const [mfgClients, setMfgClients]     = useState<MfgClient[]>(MFG_CLIENTS_INIT);
  const [fnbClients]                     = useState<FnbClient[]>(FNB_CLIENTS_INIT);
  const [travelClients]                  = useState<TravelClient[]>(TRAVEL_CLIENTS_INIT);

  const [modalOpen, setModalOpen]        = useState(false);
  const [formName, setFormName]          = useState("");
  const [formSuccess, setFormSuccess]    = useState(false);
  const [selectedName, setSelectedName]  = useState<string | null>(null);

  function closeModal() { setModalOpen(false); setFormName(""); setFormSuccess(false); }

  // Build panel detail for selected name
  const detailsMap: Record<string, ClientDetailData> = isFnb
    ? FNB_CLIENT_DETAILS
    : isTravel
    ? TRAVEL_CLIENT_DETAILS
    : MFG_CLIENT_DETAILS;

  const selectedDetail = selectedName ? (detailsMap[selectedName] ?? { contact: {}, history: [], historyLabel: "History", notes: "" }) : null;

  // Panel config per industry
  const panelAccent = isFnb ? "#ea580c" : isTravel ? "#7c3aed" : "#1d4ed8";

  function getPanelKpis(name: string): Array<{ label: string; value: string }> {
    if (isFnb) {
      const c = fnbClients.find(c => c.name === name);
      if (!c) return [];
      return [
        { label: "Total Spend",  value: c.spend },
        { label: "Visits",       value: String(c.visits) },
        { label: "Avg. Bill",    value: c.avgBill },
        { label: "Loyalty Tier", value: c.tier },
      ];
    }
    if (isTravel) {
      const c = travelClients.find(c => c.name === name);
      if (!c) return [];
      return [
        { label: "Total Revenue", value: c.revenue },
        { label: "Bookings",      value: String(c.bookings) },
        { label: "Last Booking",  value: c.lastBooking },
        { label: "Segment",       value: c.segment === "key" ? "Key Account" : c.segment === "group" ? "Group" : "Leisure" },
      ];
    }
    // Manufacturing
    const c = mfgClients.find(c => c.name === name);
    if (!c) return [];
    return [
      { label: "Lifetime Value", value: c.ltv },
      { label: "Total Orders",   value: String(c.orders) },
      { label: "Last Order",     value: c.lastOrder },
      { label: "Segment",        value: c.segment === "key" ? "Key Account" : c.segment === "channel" ? "Channel Partner" : c.segment === "at-risk" ? "At Risk" : c.segment === "dormant" ? "Dormant" : "Growth" },
    ];
  }

  function getPanelSubtitle(name: string): string {
    if (isFnb) {
      const c = fnbClients.find(c => c.name === name);
      return c ? `${c.tier} · ${c.visits} visits` : "";
    }
    if (isTravel) {
      const c = travelClients.find(c => c.name === name);
      return c ? `${c.type} · ${c.bookings} bookings` : "";
    }
    const c = mfgClients.find(c => c.name === name);
    return c ? `${c.type} · ${c.segment}` : "";
  }

  // ── KPI summary counts ─────────────────────────────────────────────────────

  const kpi1 = isFnb
    ? { label: `Total ${terminology.entityPlural}`, value: fnbClients.length, sub: `${fnbClients.filter(c => c.segment === "vip").length} VIP members` }
    : isTravel
    ? { label: "Total Clients", value: travelClients.length, sub: `${travelClients.filter(c => c.status === "active").length} active` }
    : { label: `Total ${terminology.entityPlural}`, value: mfgClients.length, sub: "↑ 2 new this quarter" };

  const kpi2 = isFnb
    ? { label: "Active This Month", value: fnbClients.filter(c => c.status === "active").length, color: "#059669", sub: "Visited in last 30d" }
    : isTravel
    ? { label: "Active Bookings", value: travelClients.filter(c => ["active", "pending"].includes(c.status)).length, color: "#7c3aed", sub: "Confirmed / pending" }
    : { label: "Active (last 30d)", value: mfgClients.filter(c => c.status === "active").length, color: "#059669", sub: "Revenue generating" };

  const kpi3 = isFnb
    ? { label: "Avg. Spend/Visit", value: "₹3,485", color: "#ea580c", sub: "Across all members" }
    : isTravel
    ? { label: "Dormant / At Risk", value: travelClients.filter(c => c.status === "dormant").length, color: "#d97706", sub: "Need re-engagement" }
    : { label: "At Risk (60d)", value: mfgClients.filter(c => c.status === "dormant_60").length, color: "#d97706", sub: "Need re-engagement" };

  const kpi4 = isFnb
    ? { label: "Dormant Members", value: fnbClients.filter(c => c.status === "dormant").length, color: "#dc2626", sub: "Send win-back offer" }
    : isTravel
    ? { label: "Avg. Revenue/Client", value: "₹7.2L", color: "#059669", sub: "This financial year" }
    : { label: "Dormant (90d+)", value: mfgClients.filter(c => c.status === "dormant_90").length, color: "#dc2626", sub: "Re-activation needed" };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            {isFnb ? "Customer Loyalty" : isTravel ? "Client Database" : `${terminology.entityPlural} & Channel Intelligence`}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isFnb
              ? "Diner profiles · loyalty tiers · visit history · win-back"
              : isTravel
              ? "Corporate accounts · leisure clients · booking history"
              : "Corporate accounts · architect network · dormant recovery"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFnb ? (
            <ImportExportButtons<FnbClient>
              rows={fnbClients}
              columns={[
                { label: "Name", value: "name" },
                { label: "Tier", value: "tier" },
                { label: "Spend", value: "spend" },
                { label: "Visits", value: "visits" },
                { label: "Last Visit", value: "lastVisit" },
                { label: "Status", value: "status" },
              ]}
              fileBase="diners"
              accentColor={panelAccent}
            />
          ) : isTravel ? (
            <ImportExportButtons<TravelClient>
              rows={travelClients}
              columns={[
                { label: "Name", value: "name" },
                { label: "Type", value: "type" },
                { label: "Revenue", value: "revenue" },
                { label: "Bookings", value: "bookings" },
                { label: "Last Booking", value: "lastBooking" },
                { label: "Status", value: "status" },
              ]}
              fileBase="clients"
              accentColor={panelAccent}
            />
          ) : (
            <ImportExportButtons<MfgClient>
              rows={mfgClients}
              columns={[
                { label: "Name", value: "name" },
                { label: "Type", value: "type" },
                { label: "LTV", value: "ltv" },
                { label: "Orders", value: "orders" },
                { label: "Last Order", value: "lastOrder" },
                { label: "Status", value: "status" },
              ]}
              fileBase={terminology.entityPlural.toLowerCase()}
              accentColor={panelAccent}
              onImport={(parsed) => {
                const newOnes: MfgClient[] = parsed
                  .map(r => ({
                    name: r["Name"] ?? "",
                    type: r["Type"] ?? "Corporate",
                    ltv: r["LTV"] ?? "₹0",
                    lastOrder: r["Last Order"] ?? new Date().toLocaleDateString("en-GB"),
                    orders: Number(r["Orders"] ?? 0) || 0,
                    status: (r["Status"] ?? "active"),
                    segment: "growth",
                  }))
                  .filter(c => c.name);
                if (newOnes.length) setMfgClients(prev => [...newOnes, ...prev]);
                return { count: newOnes.length };
              }}
            />
          )}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: panelAccent }}
          >
            + Add {terminology.entity}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">{kpi1.label}</div>
          <div className="kpi-value mt-1.5">{kpi1.value}</div>
          <div className="kpi-delta up mt-1.5">{kpi1.sub}</div>
        </div>
        <div className="card">
          <div className="kpi-label">{kpi2.label}</div>
          <div className="kpi-value mt-1.5" style={{ color: kpi2.color }}>{kpi2.value}</div>
          <div className="kpi-delta up mt-1.5">{kpi2.sub}</div>
        </div>
        <div className="card">
          <div className="kpi-label">{kpi3.label}</div>
          <div className="kpi-value mt-1.5" style={{ color: kpi3.color }}>{kpi3.value}</div>
          <div className="kpi-delta down mt-1.5">{kpi3.sub}</div>
        </div>
        <div className="card">
          <div className="kpi-label">{kpi4.label}</div>
          <div className="kpi-value mt-1.5" style={{ color: kpi4.color }}>{kpi4.value}</div>
          <div className="kpi-delta down mt-1.5">{kpi4.sub}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <h3 className="card-title mb-4">
          {isFnb ? "Loyalty Members" : isTravel ? "Client Directory" : `${terminology.entityPlural} Directory`}
          <span className="text-xs font-normal text-slate-400 ml-2">Click a row to view full profile</span>
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {isFnb
                ? ["Customer", "Tier", "Total Spend", "Visits", "Last Visit", "Avg. Bill", "Status"].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))
                : isTravel
                ? ["Client", "Type", "Total Revenue", "Bookings", "Last Booking", "Segment", "Status"].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))
                : [terminology.entity, "Type", "Lifetime Value", "Last Order", "Orders", "Segment", "Status"].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))
              }
            </tr>
          </thead>
          <tbody>
            {isFnb
              ? fnbClients.map((c, i) => (
                  <tr key={i} onClick={() => setSelectedName(c.name)} className={`border-b border-slate-50 hover:bg-orange-50 transition-colors cursor-pointer ${c.status === "dormant" ? "bg-amber-50" : ""}`}>
                    <td className="py-2.5 px-2 font-semibold text-slate-800">{c.name}</td>
                    <td className="py-2.5 px-2"><FnbTierBadge tier={c.tier} /></td>
                    <td className="py-2.5 px-2 font-semibold text-slate-700">{c.spend}</td>
                    <td className="py-2.5 px-2 text-slate-600">{c.visits}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{c.lastVisit}</td>
                    <td className="py-2.5 px-2 text-slate-600">{c.avgBill}</td>
                    <td className="py-2.5 px-2"><StatusDot status={c.status} /></td>
                  </tr>
                ))
              : isTravel
              ? travelClients.map((c, i) => (
                  <tr key={i} onClick={() => setSelectedName(c.name)} className={`border-b border-slate-50 hover:bg-purple-50 transition-colors cursor-pointer ${c.status === "dormant" ? "bg-amber-50" : c.status === "pending" ? "bg-amber-50" : ""}`}>
                    <td className="py-2.5 px-2 font-semibold text-slate-800 flex items-center gap-1.5"><Plane className="w-3 h-3 text-purple-400" />{c.name}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{c.type}</td>
                    <td className="py-2.5 px-2 font-semibold text-slate-700">{c.revenue}</td>
                    <td className="py-2.5 px-2 text-slate-600">{c.bookings}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{c.lastBooking}</td>
                    <td className="py-2.5 px-2"><TravelSegmentBadge segment={c.segment} /></td>
                    <td className="py-2.5 px-2"><StatusDot status={c.status} /></td>
                  </tr>
                ))
              : mfgClients.map((c, i) => (
                  <tr key={i} onClick={() => setSelectedName(c.name)} className={`border-b border-slate-50 hover:bg-blue-50 transition-colors cursor-pointer ${c.status === "dormant_90" ? "bg-red-50" : c.status === "dormant_60" ? "bg-amber-50" : ""}`}>
                    <td className="py-2.5 px-2 font-semibold text-slate-800">{c.name}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{c.type}</td>
                    <td className="py-2.5 px-2 font-semibold text-slate-700">{c.ltv}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{c.lastOrder}</td>
                    <td className="py-2.5 px-2 text-slate-600">{c.orders}</td>
                    <td className="py-2.5 px-2"><MfgSegmentBadge segment={c.segment} /></td>
                    <td className="py-2.5 px-2"><StatusDot status={c.status} /></td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>

      {/* CRM Detail Panel */}
      {selectedName && selectedDetail && (
        <ClientDetailPanel
          key={selectedName}
          open={!!selectedName}
          onClose={() => setSelectedName(null)}
          name={selectedName}
          subtitle={getPanelSubtitle(selectedName)}
          kpis={getPanelKpis(selectedName)}
          detail={selectedDetail}
          accentColor={panelAccent}
        />
      )}

      {/* Add Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 text-base">Add {terminology.entity}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            {formSuccess ? (
              <div className="px-6 py-12 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <div className="font-semibold text-emerald-700 text-sm">{terminology.entity} added successfully</div>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{terminology.entity} Name <span className="text-red-500">*</span></label>
                  <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" placeholder={isFnb ? "e.g. Rahul Sharma" : isTravel ? "e.g. Oberoi Group" : "e.g. Oberoi Hotels Ltd."} value={formName} onChange={e => setFormName(e.target.value)} />
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={closeModal} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button
                    onClick={() => {
                      if (!formName.trim()) return;
                      if (!isFnb && !isTravel) setMfgClients(prev => [{ name: formName.trim(), type: "Corporate", ltv: "₹0", lastOrder: "—", orders: 0, status: "active", segment: "growth" }, ...prev]);
                      setFormSuccess(true);
                      setTimeout(closeModal, 1400);
                    }}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white hover:opacity-90"
                    style={{ background: panelAccent }}
                  >
                    Add {terminology.entity}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Re-engagement sidebar (manufacturing only) */}
      {!isFnb && !isTravel && (
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="col-span-2" />
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <h3 className="card-title mb-0">Re-engagement Needed</h3>
              </div>
              {mfgClients.filter(c => c.status !== "active").length === 0 ? (
                <div className="text-sm text-emerald-600 text-center py-4">All clients active</div>
              ) : mfgClients.filter(c => c.status !== "active").map((c, i) => (
                <div key={i} onClick={() => setSelectedName(c.name)} className={`p-2.5 mb-2 rounded-lg cursor-pointer ${c.status === "dormant_90" ? "bg-red-50 border border-red-100" : "bg-amber-50 border border-amber-100"}`}>
                  <div className={`text-xs font-semibold ${c.status === "dormant_90" ? "text-red-800" : "text-amber-800"}`}>{c.name}</div>
                  <div className={`text-xs mt-0.5 ${c.status === "dormant_90" ? "text-red-600" : "text-amber-600"}`}>LTV: {c.ltv} · Last: {c.lastOrder}</div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                <h3 className="card-title mb-0">Top by LTV</h3>
              </div>
              {mfgClients.filter(c => c.segment === "key").map((c, i) => (
                <div key={i} onClick={() => setSelectedName(c.name)} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 rounded px-1">
                  <div>
                    <div className="text-sm font-semibold text-slate-700">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.orders} orders</div>
                  </div>
                  <div className="text-sm font-bold text-slate-800">{c.ltv}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
