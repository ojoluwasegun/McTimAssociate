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
  chat_id INTEGER REFERENCES chats(id),
  company_name TEXT,
  training_topic TEXT,
  staff_count TEXT,
  preferred_date TEXT,
  status TEXT DEFAULT 'pending', -- pending | sent
  document_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quick_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Quick Question',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  faq_id INTEGER REFERENCES faqs(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Global shared branding (company name + logo), editable by admin AND advisor,
-- shown at top-left of the widget, advisor portal, and admin portal.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Canned/quick professional reply snippets advisors can drop into a chat with one click
CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Questions Tim (the bot) couldn't confidently answer, so admin/advisor can review them
-- and turn them straight into an FAQ (which auto-mirrors into Quick Answers).
CREATE TABLE IF NOT EXISTS unanswered_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER REFERENCES chats(id),
  visitor_id INTEGER REFERENCES visitors(id),
  question TEXT NOT NULL,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Advisor/admin-managed scheduling calendar(s). Either an uploaded .ics file or an
-- external booking link (Google Calendar / Calendly etc). The active one's link is what
-- gets offered to clients automatically when they ask to book/schedule a call.
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  link TEXT,
  file_url TEXT,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
-- picks one as "active" and it is used automatically as the proposal background.
CREATE TABLE IF NOT EXISTS proposal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
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

// --- lightweight migrations for databases created before these columns existed ---
function tryAlter(sql) {
  try {
    db.exec(sql);
  } catch (e) {
    // column/table already exists - ignore
  }
}
tryAlter("ALTER TABLE quick_answers ADD COLUMN faq_id INTEGER REFERENCES faqs(id)");
tryAlter("ALTER TABLE proposal_requests ADD COLUMN document_url TEXT");
tryAlter("ALTER TABLE proposal_requests ADD COLUMN chat_id INTEGER REFERENCES chats(id)");

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

  // Every FAQ should also exist as a Quick Answer (mirrored, linked by faq_id) so the
  // widget's quick-question buttons always stay in sync with the FAQ knowledge base.
  const unmirrored = db
    .prepare(
      `SELECT f.* FROM faqs f WHERE NOT EXISTS (SELECT 1 FROM quick_answers qa WHERE qa.faq_id = f.id)`
    )
    .all();
  if (unmirrored.length) {
    const stmt = db.prepare(
      "INSERT INTO quick_answers (category, question, answer, faq_id) VALUES (?, ?, ?, ?)"
    );
    const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(r.category, r.question, r.answer, r.id)));
    tx(unmirrored);
  }

  const settingsDefaults = {
    company_name: process.env.SEED_ADMIN_COMPANY || "McTimothy Associates",
    company_logo: "",
    fallback_email: "info@mctimothyassociates.com",
    fallback_phone: "(+234) 703 485 4045 / 07034854045",
  };
  const settingCount = db.prepare("SELECT COUNT(*) AS c FROM settings").get().c;
  if (settingCount === 0) {
    const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    const tx = db.transaction((entries) => entries.forEach(([k, v]) => stmt.run(k, v)));
    tx(Object.entries(settingsDefaults));
  }

  const quickReplyCount = db.prepare("SELECT COUNT(*) AS c FROM quick_replies").get().c;
  if (quickReplyCount === 0) {
    const replies = [
      ["Greeting", "Hi, thank you for reaching out to McTimothy Associates - my name is {advisor_name}, and I'll be assisting you today. How can I help?"],
      ["Follow-up", "Just checking in - were you able to review the information I sent? Happy to answer any further questions."],
      ["Professional close", "Thank you for chatting with McTimothy Associates today. If anything else comes up, please don't hesitate to reach out. Have a wonderful day!"],
    ];
    const stmt = db.prepare("INSERT INTO quick_replies (label, body) VALUES (?, ?)");
    const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(...r)));
    tx(replies);
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
