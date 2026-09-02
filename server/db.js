// db.js - SQLite schema + connection + first-run seeding
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const dbPath = path.join(__dirname, "data.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT DEFAULT 'McTimothy Associates',
  company_logo TEXT,
  address TEXT,
  phone TEXT,
  profile_pic TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  staff_id TEXT,
  phone TEXT,
  address TEXT,
  profile_pic TEXT,
  status TEXT DEFAULT 'offline', -- offline | active | busy
  active_chat_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT NOT NULL,
  course TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER NOT NULL REFERENCES visitors(id),
  advisor_id INTEGER REFERENCES advisors(id),
  status TEXT DEFAULT 'bot', -- bot | waiting | ringing | active | closed
  queue_requested_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  sender_type TEXT NOT NULL, -- client | bot | advisor | system
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaint_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id),
  advisor_id INTEGER REFERENCES advisors(id),
  visitor_id INTEGER REFERENCES visitors(id),
  issue TEXT NOT NULL,
  resolution TEXT,
  flagged INTEGER DEFAULT 0,
  flag_reason TEXT,
  flag_status TEXT DEFAULT 'open', -- open | resolved  (only relevant if flagged=1)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'General',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brochures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  price TEXT,
  pdf_link TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER REFERENCES visitors(id),
  company_name TEXT,
  training_topic TEXT,
  staff_count TEXT,
  preferred_date TEXT,
  status TEXT DEFAULT 'new', -- new | in_progress | sent | closed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quick_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Quick Question',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appraisals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  admin_id INTEGER REFERENCES admins(id),
  type TEXT NOT NULL, -- appraisal | warning
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER REFERENCES visitors(id),
  chat_id INTEGER REFERENCES chats(id),
  kind TEXT NOT NULL, -- receipt | calendar
  link TEXT NOT NULL,
  sent_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- first run seed ---
function seedIfEmpty() {
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins").get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync(process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!", 10);
    db.prepare(
      `INSERT INTO admins (name, email, password_hash, company_name) VALUES (?, ?, ?, ?)`
    ).run(
      process.env.SEED_ADMIN_NAME || "Kate McTimothy",
      process.env.SEED_ADMIN_EMAIL || "admin@mctimothyassociates.com",
      hash,
      process.env.SEED_ADMIN_COMPANY || "McTimothy Associates"
    );
    console.log(
      `Seeded first admin login -> ${process.env.SEED_ADMIN_EMAIL || "admin@mctimothyassociates.com"} / ${process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!"}`
    );
  }

  const faqCount = db.prepare("SELECT COUNT(*) AS c FROM faqs").get().c;
  if (faqCount === 0) {
    const faqs = [
      ["General & Sales", "What does McTimothy Associates do?", "We are a Training and Consulting firm. We help organizations build better leaders, HR systems, and transgenerational businesses through corporate training, consulting, and advisory services."],
      ["General & Sales", "What trainings do you offer?", "We run trainings in 4 key areas: Leadership & Management; HR & Compliance (PENCOM, ITF, Data Protection); Customer Service & Sales; and Project Management & Operations."],
      ["General & Sales", "Do you do in-house training for companies?", "Yes, we do. We design in-house training tailored to your company's goals. We've worked with banks, oil & gas companies, and SMEs across Nigeria."],
      ["General & Sales", "What is your pricing?", "Pricing depends on whether it's an open class or in-house training, the number of participants, and location. Open classes start from ₦75,000 per person, and in-house training starts from ₦1.5M."],
      ["General & Sales", "Where are you located?", "Our office is in Lagos, Nigeria, and we deliver training across Nigeria and virtually."],
      ["Course Specific", "When is your next Leadership Training?", "We run Leadership cohorts quarterly. Ask us and we'll confirm the next available date for you."],
      ["Course Specific", "Do you give certificates?", "Yes, all participants receive a McTimothy Associates Certificate of Participation, and some programs also carry CPD points."],
      ["Course Specific", "Are your trainings virtual or physical?", "We offer both: physical training in Lagos and live virtual sessions via Zoom."],
      ["Course Specific", "Do you train individuals or only companies?", "Both. We have open classes for individual professionals and customized training for companies."],
      ["Consulting & HR", "Do you help with HR setup?", "Yes, we help companies with HR Policies, HR Audit, Performance Management, and Compliance."],
      ["Consulting & HR", "What is Transgenerational Business?", "It's building a business that outlives the founder. We help family businesses with Succession Planning, Governance, and Structure, including our 'Time-out with Kate' sessions."],
      ["Proposal & Booking", "Can I get a proposal for my company?", "Yes, please share your company name, training topic, number of staff, and preferred date, and our team will send a proposal within 24 hours."],
      ["Proposal & Booking", "How do I register for a course?", "Share your name, email, phone number, and the course name, and we'll register you or send you the payment link."],
      ["Proposal & Booking", "Do you offer installment payment?", "For corporate clients, yes. For individuals, full payment secures a seat. An advisor can walk you through the options."],
      ["Customer Service", "I paid but didn't get confirmation", "We're sorry about that. Please share your payment proof and email so we can escalate this to our accounts team."],
      ["Customer Service", "Can I get a refund?", "Refunds are available up to 7 days before the training date. After that, we can transfer your seat to the next cohort."],
      ["Customer Service", "Do you offer post-training support?", "Yes, all corporate clients get 30 days of post-training support and templates."],
      ["Closing & Escalation", "Do you have past client testimonials?", "Yes, we've worked with companies in Banking, FMCG, and Tech, and can share case studies and testimonials."],
      ["Closing & Escalation", "How can I partner with McTimothy Associates?", "We work with facilitators, venues, and corporate partners. Share your name and company and our partnerships team will reach out."],
    ];
    const stmt = db.prepare(`INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)`);
    const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(...r)));
    tx(faqs);
  }

  const brochureCount = db.prepare("SELECT COUNT(*) AS c FROM brochures").get().c;
  if (brochureCount === 0) {
    db.prepare(
      `INSERT INTO brochures (title, description, price, pdf_link) VALUES (?, ?, ?, ?)`
    ).run(
      "McTimothy Associates - Company Profile & Course Catalog",
      "Full overview of our Leadership, HR & Compliance, Customer Service, and Project Management programs.",
      "From ₦75,000 per person (open class) / From ₦1.5M (in-house)",
      ""
    );
  }
}

module.exports = { db, seedIfEmpty };
